import { describe, expect, it } from "vitest";
import {
  FLOYD_BLE_COMMAND,
  FLOYD_BLE_RESPONSE,
  FLOYD_BLE_SCHEDULES,
  FLOYD_BLE_SERVICE,
  FLOYD_BLE_TIME,
  FLOYD_BLE_TELEMETRY,
  FLOYD_BLE_STATUS,
  FLOYD_BLE_FEEDLOG,
  encodeJson,
} from "@/protocol";
import type { Schedule } from "@/protocol";
import { TransportError } from "./errors";
import type {
  BluetoothApiLike,
  BluetoothCharacteristicLike,
  BluetoothDeviceLike,
  BluetoothRemoteGATTServerLike,
  BluetoothRequestDeviceOptions,
  BluetoothServiceLike,
} from "./transport";
import { WebBluetoothTransport } from "./web-bluetooth";

class FakeCharacteristic implements BluetoothCharacteristicLike {
  readonly uuid: string;
  readonly writes: Uint8Array[] = [];
  value: DataView | undefined;
  private readonly listeners = new Set<(event: Event) => void>();

  constructor(uuid: string, initialValue?: Uint8Array) {
    this.uuid = uuid;
    if (initialValue) this.value = new DataView(initialValue.buffer);
  }

  async startNotifications(): Promise<this> {
    return this;
  }

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.add(listener as (event: Event) => void);
  }

  removeEventListener(
    _type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.listeners.delete(listener as (event: Event) => void);
  }

  async writeValueWithResponse(value: BufferSource): Promise<void> {
    this.writes.push(
      value instanceof ArrayBuffer
        ? new Uint8Array(value)
        : new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    );
  }

  async readValue(): Promise<DataView> {
    if (!this.value) throw new Error("No characteristic value");
    return this.value;
  }

  emitJson(message: unknown): void {
    const bytes = encodeJson(message);
    this.value = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const event = { target: this } as unknown as Event;
    for (const listener of this.listeners) listener(event);
  }
}

class FakeService implements BluetoothServiceLike {
  private readonly characteristics = new Map<string, FakeCharacteristic>();

  constructor(uuids: readonly string[], scheduleValue?: Uint8Array) {
    for (const uuid of uuids) {
      this.characteristics.set(
        uuid,
        new FakeCharacteristic(uuid, uuid === FLOYD_BLE_SCHEDULES ? scheduleValue : undefined),
      );
    }
  }

  async getCharacteristic(uuid: string): Promise<FakeCharacteristic> {
    const characteristic = this.characteristics.get(uuid);
    if (!characteristic) throw new Error(`Missing characteristic ${uuid}`);
    return characteristic;
  }

  characteristic(uuid: string): FakeCharacteristic {
    const characteristic = this.characteristics.get(uuid);
    if (!characteristic) throw new Error(`Missing characteristic ${uuid}`);
    return characteristic;
  }
}

class FakeServer implements BluetoothRemoteGATTServerLike {
  readonly connected = true;
  constructor(private readonly service: FakeService) {}

  async getPrimaryService(uuid: string): Promise<FakeService> {
    expect(uuid).toBe(FLOYD_BLE_SERVICE);
    return this.service;
  }
}

class FakeDevice implements BluetoothDeviceLike {
  readonly name = "FloydFeeder-A1B2";
  readonly id = "device-1";
  readonly gatt: BluetoothRemoteGATTServerLike & { disconnect(): void };
  private readonly listeners = new Set<(event: Event) => void>();

  constructor(server: FakeServer) {
    this.gatt = {
      connected: true,
      getPrimaryService: server.getPrimaryService.bind(server),
      disconnect: () => {
        const event = { target: this } as unknown as Event;
        for (const listener of this.listeners) listener(event);
      },
    };
  }

  addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
    this.listeners.add(listener as (event: Event) => void);
  }

  removeEventListener(
    _type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.listeners.delete(listener as (event: Event) => void);
  }

  emitUnexpectedDisconnect(): void {
    const event = { target: this } as unknown as Event;
    for (const listener of this.listeners) listener(event);
  }
}

class FakeBluetooth implements BluetoothApiLike {
  requestOptions: BluetoothRequestDeviceOptions | undefined;
  constructor(private readonly device: FakeDevice) {}

  async requestDevice(options: BluetoothRequestDeviceOptions): Promise<FakeDevice> {
    this.requestOptions = options;
    return this.device;
  }
}

const allCharacteristicUuids = [
  FLOYD_BLE_COMMAND,
  FLOYD_BLE_RESPONSE,
  FLOYD_BLE_TELEMETRY,
  FLOYD_BLE_STATUS,
  FLOYD_BLE_SCHEDULES,
  FLOYD_BLE_TIME,
  FLOYD_BLE_FEEDLOG,
] as const;

const makeFixture = (scheduleValue?: Uint8Array) => {
  const service = new FakeService(allCharacteristicUuids, scheduleValue);
  const server = new FakeServer(service);
  const device = new FakeDevice(server);
  const bluetooth = new FakeBluetooth(device);
  const transport = new WebBluetoothTransport({ bluetooth, secureContext: true });
  return { service, device, bluetooth, transport };
};

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

describe("WebBluetoothTransport", () => {
  it("reports unsupported browsers before invoking the chooser", async () => {
    const transport = new WebBluetoothTransport({ bluetooth: undefined, secureContext: true });
    await expect(transport.connect()).rejects.toMatchObject({ code: "unsupported" });
  });

  it("reports insecure contexts before invoking the chooser", async () => {
    const fixture = makeFixture();
    await expect(
      new WebBluetoothTransport({ bluetooth: fixture.bluetooth, secureContext: false }).connect(),
    ).rejects.toMatchObject({ code: "insecure_context" });
    expect(fixture.bluetooth.requestOptions).toBeUndefined();
  });

  it("requests a Floyd device and wires every notify characteristic", async () => {
    const fixture = makeFixture();
    const messages: unknown[] = [];
    fixture.transport.onMessage((message) => messages.push(message));
    await fixture.transport.connect();

    expect(fixture.bluetooth.requestOptions?.filters).toEqual([
      { namePrefix: "FloydFeeder-", services: [FLOYD_BLE_SERVICE] },
    ]);
    fixture.service.characteristic(FLOYD_BLE_RESPONSE).emitJson({
      type: "control_response",
      data: { action: "ping" },
      timestamp: 7,
    });
    expect(messages).toEqual([
      { type: "control_response", data: { action: "ping" }, timestamp: 7 },
    ]);
    expect(fixture.transport.deviceName).toBe("FloydFeeder-A1B2");
    expect(fixture.transport.chipId).toBe("A1B2");
  });

  it("writes commands and little-endian time to their contract characteristics", async () => {
    const fixture = makeFixture();
    await fixture.transport.connect();
    await fixture.transport.sendCommand({ action: "ping", timestamp: 1234 });
    await fixture.transport.syncTime(0x12345678);

    expect(JSON.parse(new TextDecoder().decode(fixture.service.characteristic(FLOYD_BLE_COMMAND).writes[0]))).toEqual({
      action: "ping",
      timestamp: 1234,
    });
    expect([...fixture.service.characteristic(FLOYD_BLE_TIME).writes[0]]).toEqual([
      0x78,
      0x56,
      0x34,
      0x12,
    ]);
  });

  it("reads and writes schedule JSON with chunk framing", async () => {
    const initial = new TextEncoder().encode("[]");
    const fixture = makeFixture(initial);
    await fixture.transport.connect();
    expect(await fixture.transport.readSchedules()).toEqual([]);
    await fixture.transport.writeSchedules([schedule]);
    const writes = fixture.service.characteristic(FLOYD_BLE_SCHEDULES).writes;
    expect(writes.length).toBeGreaterThan(0);
    expect(new DataView(writes[0].buffer).getUint16(0, true)).toBe(0);
    expect(new DataView(writes[0].buffer).getUint16(2, true)).toBe(writes.length);
  });

  it("maps invalid schedule JSON and chooser cancellation to stable errors", async () => {
    const invalid = new TextEncoder().encode("not json");
    const fixture = makeFixture(invalid);
    await fixture.transport.connect();
    await expect(fixture.transport.readSchedules()).rejects.toMatchObject({
      code: "invalid_response",
    });

    const cancel = new Error("user cancelled");
    cancel.name = "NotFoundError";
    const bluetooth: BluetoothApiLike = {
      requestDevice: async () => {
        throw cancel;
      },
    };
    await expect(
      new WebBluetoothTransport({ bluetooth, secureContext: true }).connect(),
    ).rejects.toMatchObject({ code: "cancelled" });
  });

  it("emits only unexpected disconnects and cleans up manual disconnects", async () => {
    const fixture = makeFixture();
    const disconnects: Array<string | null> = [];
    fixture.transport.onDisconnect((reason) => disconnects.push(reason));
    await fixture.transport.connect();
    await fixture.transport.disconnect();
    fixture.device.emitUnexpectedDisconnect();
    expect(disconnects).toEqual([]);

    await fixture.transport.connect();
    fixture.device.emitUnexpectedDisconnect();
    expect(disconnects).toEqual([null]);
  });

  it("normalizes GATT failures as connection failures", async () => {
    const error = new Error("GATT unavailable");
    const bluetooth: BluetoothApiLike = {
      requestDevice: async () => {
        throw error;
      },
    };
    await expect(
      new WebBluetoothTransport({ bluetooth, secureContext: true }).connect(),
    ).rejects.toBeInstanceOf(TransportError);
    await expect(
      new WebBluetoothTransport({ bluetooth, secureContext: true }).connect(),
    ).rejects.toMatchObject({ code: "connection_failed" });
  });
});
