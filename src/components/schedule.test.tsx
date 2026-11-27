import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { DeviceMessage, Schedule } from "@/protocol";
import type { FeederTransport, TransportSupport } from "@/transport/transport";
import { FeederStore } from "@/state/feeder-store";
import { FeederStoreProvider } from "@/state/feeder-context";
import { ScheduleView } from "./ScheduleView";

class ScheduleTransport implements FeederTransport {
  readonly kind = "bluetooth" as const;
  readonly support: TransportSupport = { available: true };
  readonly deviceName = "FloydFeeder-SCHEDULE";
  readonly chipId = "SCHEDULE";
  readonly scheduleWrites: Schedule[][] = [];
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
  async writeSchedules(schedules: Schedule[]): Promise<void> {
    this.scheduleWrites.push(schedules);
  }
}

function renderSchedule(transport: ScheduleTransport): FeederStore {
  const store = new FeederStore({ transport, now: () => 1234 });
  render(
    <FeederStoreProvider store={store}>
      <ScheduleView />
    </FeederStoreProvider>,
  );
  return store;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ScheduleView", () => {
  it("keeps the editor open and explains required fields", async () => {
    const transport = new ScheduleTransport();
    const store = renderSchedule(transport);
    await act(async () => {
      await store.startConnection();
    });
    fireEvent.click(screen.getByRole("button", { name: /add schedule/i }));
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Label is required.")).toBeInTheDocument();
    expect(screen.getByText("Select at least one day.")).toBeInTheDocument();
    expect(transport.scheduleWrites).toHaveLength(0);
    store.dispose();
  });

  it("writes a complete schedule after validating label, time, and weekdays", async () => {
    const transport = new ScheduleTransport();
    const store = renderSchedule(transport);
    await act(async () => {
      await store.startConnection();
    });
    fireEvent.click(screen.getByRole("button", { name: /add schedule/i }));
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "Morning feed" } });
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "08:30" } });
    fireEvent.click(screen.getByLabelText("Monday"));
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(transport.scheduleWrites).toHaveLength(1);
    expect(transport.scheduleWrites[0][0]).toMatchObject({
      label: "Morning feed",
      time: "08:30",
      daysOfWeek: "1",
      augerSpeed: 768,
      impellerSpeed: 1023,
      preSpinMs: 1500,
      feedMs: 3000,
      postSpinMs: 1500,
      enabled: true,
    });
    store.dispose();
  });
});
