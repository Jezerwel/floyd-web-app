import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CommandEnvelope,
  DeviceMessage,
  Schedule,
} from "@/protocol";
import type {
  ConnectOptions,
  FeederTransport,
  TransportSupport,
} from "@/transport/transport";
import type { StorageLike } from "@/storage/local-storage";
import { FeederStore } from "./feeder-store";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class FakeTransport implements FeederTransport {
  readonly kind = "bluetooth" as const;
  readonly support: TransportSupport = { available: true };
  readonly deviceName = "FloydFeeder-CAFE";
  readonly chipId = "CAFE";
  readonly commands: CommandEnvelope[] = [];
  readonly scheduleWrites: Schedule[][] = [];
  connectCalls: ConnectOptions[] = [];
  disconnectCalls = 0;
  connectImplementation: () => Promise<void> = async () => undefined;
  commandImplementation: (payload: CommandEnvelope) => Promise<void> = async () => undefined;
  private readonly messageListeners = new Set<(message: DeviceMessage) => void>();
  private readonly disconnectListeners = new Set<(reason: string | null) => void>();

  async connect(options: ConnectOptions = {}): Promise<void> {
    this.connectCalls.push(options);
    await this.connectImplementation();
  }

  async disconnect(): Promise<void> {
    this.disconnectCalls += 1;
  }

  onMessage(listener: (message: DeviceMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  onDisconnect(listener: (reason: string | null) => void): () => void {
    this.disconnectListeners.add(listener);
    return () => this.disconnectListeners.delete(listener);
  }

  async sendCommand(payload: CommandEnvelope): Promise<void> {
    this.commands.push(payload);
    await this.commandImplementation(payload);
  }

  async syncTime(): Promise<void> {}

  async readSchedules(): Promise<Schedule[]> {
    return [];
  }

  async writeSchedules(schedules: Schedule[]): Promise<void> {
    this.scheduleWrites.push(schedules);
  }

  emitMessage(message: DeviceMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }

  emitDisconnect(reason: string | null = null): void {
    for (const listener of this.disconnectListeners) listener(reason);
  }
}

const schedule: Schedule = {
  id: "morning",
  label: "Morning",
  time: "08:00",
  daysOfWeek: "1,2,3,4,5",
  augerSpeed: 768,
  impellerSpeed: 1023,
  preSpinMs: 1500,
  feedMs: 3000,
  postSpinMs: 1500,
  enabled: true,
};

const sensorMessage = (timestamp: number, overrides: Record<string, unknown> = {}): DeviceMessage => ({
  type: "sensor_data",
  timestamp,
  data: {
    temperature: 24.5,
    distance: 12.2,
    foodLevelPercentage: 76,
    temperatureSensorConnected: true,
    ultrasonicSensorConnected: true,
    motorState: "idle",
    ...overrides,
  },
});

afterEach(() => {
  vi.useRealTimers();
});

describe("FeederStore", () => {
  it("restores valid feed logs and ignores malformed storage", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      "floyd-feedlogs",
      JSON.stringify([
        {
          id: "saved",
          timestamp: "2026-08-27T10:00:00.000Z",
          augerSpeed: 768,
          impellerSpeed: 1023,
          feedMs: 3000,
          success: true,
        },
      ]),
    );
    const transport = new FakeTransport();
    expect(new FeederStore({ transport, storage }).getSnapshot().feedLogs).toHaveLength(1);

    storage.setItem("floyd-feedlogs", "not json");
    expect(new FeederStore({ transport, storage }).getSnapshot().feedLogs).toEqual([]);
  });

  it("connects, persists the chip id, and routes device messages", async () => {
    const storage = new MemoryStorage();
    const transport = new FakeTransport();
    const store = new FeederStore({ transport, storage, now: () => 1_700_000_000_000 });
    await store.startConnection();

    expect(store.getSnapshot()).toMatchObject({
      connectionState: "connected",
      isConnected: true,
      chipId: "CAFE",
    });
    expect(storage.getItem("floydChipId")).toBe("CAFE");

    transport.emitMessage(sensorMessage(42));
    transport.emitMessage({
      type: "status",
      timestamp: 43,
      data: { connected: true, wifiRssi: -55 },
    });
    transport.emitMessage({
      type: "schedules_list",
      timestamp: 44,
      data: [schedule],
    });
    transport.emitMessage({
      type: "control_response",
      timestamp: 45,
      data: {
        action: "feed_complete",
        augerSpeed: 768,
        impellerSpeed: 1023,
        feedMs: 3000,
        success: true,
      },
    });

    expect(store.getSnapshot().deviceData).toMatchObject({
      temperature: 24.5,
      wifiRssi: -55,
      esp32Connected: true,
    });
    expect(store.getSnapshot().schedules).toEqual([schedule]);
    expect(store.getSnapshot().sensorLogs).toHaveLength(1);
    expect(store.getSnapshot().feedLogs[0]).toMatchObject({ success: true, feedMs: 3000 });
    expect(storage.getItem("floyd-feedlogs")).toContain('"success":true');
  });

  it("caps sensor logs at fifty entries and clears them", async () => {
    const transport = new FakeTransport();
    const store = new FeederStore({ transport });
    await store.startConnection();
    for (let index = 0; index < 51; index += 1) {
      transport.emitMessage(sensorMessage(index));
    }
    expect(store.getSnapshot().sensorLogs).toHaveLength(50);
    expect(store.getSnapshot().sensorLogs[0].timestamp).toBe(50);
    store.clearSensorLogs();
    expect(store.getSnapshot().sensorLogs).toEqual([]);
  });

  it("wraps commands in the existing envelope and surfaces failures", async () => {
    const transport = new FakeTransport();
    const store = new FeederStore({ transport, now: () => 1234 });
    expect(await store.startFeed({
      augerSpeed: 768,
      impellerSpeed: 1023,
      preSpinMs: 1500,
      feedMs: 3000,
      postSpinMs: 1500,
    })).toBe(false);
    expect(store.getSnapshot().lastCommandError).toBe("Not connected to feeder.");

    await store.startConnection();
    expect(await store.startFeed({
      augerSpeed: 768,
      impellerSpeed: 1023,
      preSpinMs: 1500,
      feedMs: 3000,
      postSpinMs: 1500,
    })).toBe(true);
    expect(transport.commands[0]).toEqual({
      action: "start_feed",
      parameters: {
        augerSpeed: 768,
        impellerSpeed: 1023,
        preSpinMs: 1500,
        feedMs: 3000,
        postSpinMs: 1500,
      },
      timestamp: 1234,
    });

    transport.commandImplementation = async () => {
      throw new Error("command rejected");
    };
    expect(await store.stopFeed()).toBe(false);
    expect(store.getSnapshot().lastCommandError).toBe("command rejected");
  });

  it("syncs valid schedules and rejects invalid lists before transport writes", async () => {
    const transport = new FakeTransport();
    const store = new FeederStore({ transport });
    await store.startConnection();
    expect(await store.publishScheduleSync([schedule])).toBe(true);
    expect(transport.scheduleWrites).toEqual([[schedule]]);
    expect(await store.publishScheduleSync([{ ...schedule, time: "99:99" }])).toBe(false);
    expect(transport.scheduleWrites).toHaveLength(1);
  });

  it("stops reconnecting after three attempts and supports a fresh retry", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const store = new FeederStore({ transport, now: () => Date.now(), reconnectDelayMs: 1000 });
    await store.startConnection();
    transport.connectImplementation = async () => {
      throw new Error("still unavailable");
    };
    transport.emitDisconnect("link lost");
    expect(store.getSnapshot().connectionState).toBe("scanning");

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(transport.connectCalls).toHaveLength(4);
    expect(store.getSnapshot().connectionError).toMatchObject({ kind: "connection_lost" });

    transport.connectImplementation = async () => undefined;
    await store.retryConnection();
    expect(store.getSnapshot().connectionState).toBe("connected");
  });

  it("does not reconnect after a manual disconnect", async () => {
    vi.useFakeTimers();
    const transport = new FakeTransport();
    const store = new FeederStore({ transport, reconnectDelayMs: 1000 });
    await store.startConnection();
    transport.emitDisconnect("link lost");
    store.disconnectBle();
    await vi.advanceTimersByTimeAsync(4000);
    expect(transport.connectCalls).toHaveLength(1);
    expect(store.getSnapshot().connectionState).toBe("idle");
  });

});
