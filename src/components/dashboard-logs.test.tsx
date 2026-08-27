import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
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

describe("DashboardView", () => {
  it("shows valid sensor readings and suppresses out-of-range values", async () => {
    const transport = new DashboardTransport();
    const store = renderView(<DashboardView />, transport);
    await act(async () => {
      await store.startConnection();
    });
    act(() => {
      transport.emit({
        type: "sensor_data",
        timestamp: 1,
        data: {
          temperature: 24.5,
          foodLevelPercentage: 76,
          distance: 12.2,
          temperatureSensorConnected: true,
          ultrasonicSensorConnected: true,
          motorState: "idle",
        },
      });
    });
    expect(screen.getByText("24.5")).toBeInTheDocument();
    expect(screen.getByText("76%")).toBeInTheDocument();

    act(() => {
      transport.emit({
        type: "sensor_data",
        timestamp: 2,
        data: { temperature: 200, foodLevelPercentage: 120 },
      });
    });
    expect(screen.getAllByText("--").length).toBeGreaterThan(0);
    store.dispose();
  });
});

describe("LogsView", () => {
  it("renders sensor, alert, and feed sections and clears sensor logs", async () => {
    const transport = new DashboardTransport();
    const store = renderView(<LogsView />, transport);
    await act(async () => {
      await store.startConnection();
    });
    act(() => {
      transport.emit({
        type: "sensor_data",
        timestamp: 1,
        data: {
          temperature: 35,
          foodLevelPercentage: 5,
          distance: 12,
          temperatureSensorConnected: true,
          ultrasonicSensorConnected: true,
          motorState: "idle",
        },
      });
      transport.emit({
        type: "control_response",
        timestamp: 2,
        data: { action: "feed_complete", feedMs: 3000, success: true },
      });
    });
    expect(screen.getByText(/35\.0 °C/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Alerts" }));
    expect(screen.getAllByText(/critical food/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("tab", { name: "Feed history" }));
    expect(screen.getByRole("heading", { name: "Feed history" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Sensor data" }));
    fireEvent.click(screen.getByRole("button", { name: "Clear sensor logs" }));
    expect(screen.getByText(/no sensor data/i)).toBeInTheDocument();
    store.dispose();
  });
});
