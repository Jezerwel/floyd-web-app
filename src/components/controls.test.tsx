import { afterEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { CommandEnvelope, DeviceMessage, Schedule } from "@/protocol";
import type { FeederTransport, TransportSupport } from "@/transport/transport";
import { FeederStore } from "@/state/feeder-store";
import { FeederStoreProvider } from "@/state/feeder-context";
import { ControlsView } from "./ControlsView";

class ViewTransport implements FeederTransport {
  readonly kind = "bluetooth" as const;
  readonly support: TransportSupport = { available: true };
  readonly deviceName = "FloydFeeder-VIEW";
  readonly chipId = "VIEW";
  readonly commands: CommandEnvelope[] = [];
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
  async sendCommand(payload: CommandEnvelope): Promise<void> {
    this.commands.push(payload);
  }
  async syncTime(): Promise<void> {}
  async readSchedules(): Promise<Schedule[]> {
    return [];
  }
  async writeSchedules(schedules: Schedule[]): Promise<void> {
    this.scheduleWrites.push(schedules);
  }
}

function renderControls(transport: ViewTransport): FeederStore {
  const store = new FeederStore({ transport, now: () => 1234 });
  render(
    <FeederStoreProvider store={store}>
      <ControlsView />
    </FeederStoreProvider>,
  );
  return store;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("ControlsView", () => {
  it("keeps FEED unavailable while disconnected", () => {
    const store = renderControls(new ViewTransport());
    expect(screen.getByRole("button", { name: "FEED" })).toBeDisabled();
    expect(screen.getByText(/controls are unavailable/i)).toBeInTheDocument();
    store.dispose();
  });

  it("sends PWM speeds and milliseconds for a manual feed", async () => {
    const transport = new ViewTransport();
    const store = renderControls(transport);
    await act(async () => {
      await store.startConnection();
    });
    fireEvent.change(screen.getByLabelText("Feed speed"), { target: { value: "80" } });
    fireEvent.change(screen.getByLabelText("Spread speed"), { target: { value: "60" } });
    fireEvent.change(screen.getByLabelText("Feed duration"), { target: { value: "2.5" } });
    fireEvent.click(screen.getByRole("button", { name: "FEED" }));

    await waitFor(() => expect(transport.commands).toHaveLength(1));
    expect(transport.commands[0]).toMatchObject({
      action: "start_feed",
      parameters: {
        augerSpeed: Math.round(80 * 10.23),
        impellerSpeed: Math.round(60 * 10.23),
        preSpinMs: 1500,
        feedMs: 2500,
        postSpinMs: 1500,
      },
    });
    store.dispose();
  });

  it("requires an inline confirmation before clearing a jam", async () => {
    const transport = new ViewTransport();
    const store = renderControls(transport);
    await act(async () => {
      await store.startConnection();
    });
    fireEvent.click(screen.getByRole("button", { name: /clear jam/i }));
    expect(screen.getByText(/run the unclog sequence/i)).toBeInTheDocument();
    expect(transport.commands).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Confirm clear jam" }));
    await waitFor(() => expect(transport.commands[0]?.action).toBe("clear_jam"));
    store.dispose();
  });
});
