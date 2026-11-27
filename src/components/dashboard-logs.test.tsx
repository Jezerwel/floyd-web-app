import { afterEach, describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { DeviceMessage, Schedule } from "@/protocol";
import type { FeederTransport, TransportSupport } from "@/transport/transport";
import { FeederStore } from "@/state/feeder-store";
import { FeederStoreProvider } from "@/state/feeder-context";
import { DashboardView } from "./DashboardView";
import { LogsView } from "./LogsView";

class DashboardTransport implements FeederTransport {
  readonly kind = "bluetooth" as const;
  readonly support: TransportSupport = { available: true };
  readonly deviceName = "FloydFeeder-DASH";
  readonly chipId = "DASH";
  private readonly messages = new Set<(message: DeviceMessage) => void>();
  private readonly disconnects = new Set<(reason: string | null) => void>();

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  onMessage(listener: (message: DeviceMessage) => void): () => void {
    this.messages.add(listener);
    return () => this.messages.delete(listener);
  }
  onDisconnect(listener: (reason: string | null) => void): () => void {
    this.disconnects.add(listener);
    return () => this.disconnects.delete(listener);
  }
  async sendCommand(): Promise<void> {}
  async syncTime(): Promise<void> {}
  async readSchedules(): Promise<Schedule[]> {
    return [];
  }
  async writeSchedules(): Promise<void> {}
  emit(message: DeviceMessage): void {
    for (const listener of this.messages) listener(message);
  }
}

function renderView(view: React.ReactNode, transport: DashboardTransport): FeederStore {
  const store = new FeederStore({ transport, now: () => 1234 });
  render(<FeederStoreProvider store={store}>{view}</FeederStoreProvider>);
  return store;
}

afterEach(() => {
  document.body.innerHTML = "";
});

// Exact telemetry JSON the Nano ESP32 sketch sends (firmware/FloydFeeder/FloydFeeder.ino).
const SKETCH_TELEMETRY = JSON.parse(
  '{"type":"sensor_data","data":{"motorState":"jam_clear","augerSpeed":768,"impellerSpeed":0,' +
    '"augerDirection":"reverse","impellerDirection":"brake","buttonAPressed":false,"buttonBPressed":true}}',
) as DeviceMessage;

describe("DashboardView", () => {
  it("shows motor direction, speed and button state from the sketch telemetry", async () => {
    const transport = new DashboardTransport();
    const store = renderView(<DashboardView />, transport);
    await act(async () => {
      await store.startConnection();
    });
    act(() => {
      transport.emit({ ...SKETCH_TELEMETRY, timestamp: 1 });
    });

    const auger = screen.getByRole("article", { name: "Auger motor" });
    expect(auger).toHaveTextContent("Reverse");
    expect(auger).toHaveTextContent("75%");
    const impeller = screen.getByRole("article", { name: "Impeller motor" });
    expect(impeller).toHaveTextContent("Brake");
    expect(impeller).toHaveTextContent("0%");
    expect(screen.getByRole("group", { name: "Button A (feed)" })).toHaveTextContent("Released");
    expect(screen.getByRole("group", { name: "Button B (clear jam)" })).toHaveTextContent("Pressed");
    expect(screen.getByText("Unclogging")).toBeInTheDocument();
    expect(screen.queryByText(/temperature/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/food remaining/i)).not.toBeInTheDocument();
    store.dispose();
  });

  it("ignores unknown direction values", async () => {
    const transport = new DashboardTransport();
    const store = renderView(<DashboardView />, transport);
    await act(async () => {
      await store.startConnection();
    });
    act(() => {
      transport.emit({ type: "sensor_data", timestamp: 1, data: { augerDirection: "sideways", augerSpeed: 5000 } });
    });
    const auger = screen.getByRole("article", { name: "Auger motor" });
    expect(auger).toHaveTextContent("--");
    store.dispose();
  });
});

describe("LogsView", () => {
  it("shows feed history from completion responses", async () => {
    const transport = new DashboardTransport();
    const store = renderView(<LogsView />, transport);
    await act(async () => {
      await store.startConnection();
    });
    expect(screen.getByText(/no feed history/i)).toBeInTheDocument();
    act(() => {
      transport.emit({
        type: "control_response",
        timestamp: 2,
        data: { action: "feed_complete", augerSpeed: 768, impellerSpeed: 1023, feedMs: 3000, success: true },
      });
    });
    expect(screen.getByRole("heading", { name: "Feed history" })).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("Auger 75%")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /sensor/i })).not.toBeInTheDocument();
    store.dispose();
  });
});
