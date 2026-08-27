import { afterEach, describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { CommandEnvelope, DeviceMessage, Schedule } from "@/protocol";
import type { FeederTransport, TransportSupport } from "@/transport/transport";
import { FeederStore } from "@/state/feeder-store";
import { FeederStoreProvider } from "@/state/feeder-context";
import { AppShell } from "./AppShell";

class ShellTransport implements FeederTransport {
  readonly kind = "bluetooth" as const;
  readonly deviceName = "FloydFeeder-TEST";
  readonly chipId = "TEST";
  readonly commands: CommandEnvelope[] = [];
  readonly support: TransportSupport;
  private readonly messages = new Set<(message: DeviceMessage) => void>();
  private readonly disconnects = new Set<(reason: string | null) => void>();

  constructor(support: TransportSupport = { available: true }) {
    this.support = support;
  }

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
  async writeSchedules(): Promise<void> {}
}

function renderShell(transport: ShellTransport): FeederStore {
  const store = new FeederStore({ transport });
  render(
    <FeederStoreProvider store={store}>
      <AppShell />
    </FeederStoreProvider>,
  );
  return store;
}

afterEach(() => {
  window.location.hash = "#dashboard";
  document.body.innerHTML = "";
});

describe("AppShell", () => {
  it("renders landmarks and keyboard-accessible navigation", () => {
    const store = renderShell(new ShellTransport());
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Controls" })).toHaveAttribute("href", "#controls");
    expect(screen.getByRole("link", { name: "Logs" })).toHaveAttribute("href", "#logs");
    expect(screen.getByRole("button", { name: /connect feeder/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /skip to content/i })).toBeInTheDocument();
    store.dispose();
  });

  it("shows the unsupported browser message without opening a chooser", () => {
    const store = renderShell(
      new ShellTransport({
        available: false,
        code: "unsupported",
        reason: "This browser does not support Web Bluetooth.",
      }),
    );
    expect(screen.getByText("This browser does not support Web Bluetooth.")).toBeInTheDocument();
    expect(screen.getByText(/raw MQTT/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/wi-fi password/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/network name/i)).not.toBeInTheDocument();
    store.dispose();
  });

  it("changes route through a native link", () => {
    const store = renderShell(new ShellTransport());
    fireEvent.click(screen.getByRole("link", { name: "Controls" }));
    expect(window.location.hash).toBe("#controls");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Controls");
    store.dispose();
  });
});
