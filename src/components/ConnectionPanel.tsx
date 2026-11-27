import { Capacitor } from "@capacitor/core";
import { useFeederSnapshot, useFeederStore } from "@/state/feeder-context";
import { getWifiAvailability } from "@/transport/wifi-boundary";
import { StatusBanner } from "./StatusBanner";

function connectionLabel(state: string, isNative: boolean): string {
  if (state === "connected") return "Connected";
  if (state === "scanning") return isNative ? "Looking for feeders" : "Waiting for browser device chooser";
  if (state === "connecting") return "Connecting to feeder";
  if (state === "error") return "Connection needs attention";
  return "Not connected";
}

export function ConnectionPanel() {
  const snapshot = useFeederSnapshot();
  const store = useFeederStore();
  const wifi = getWifiAvailability();
  const isNative = Capacitor.isNativePlatform();
  const busy = snapshot.connectionState === "scanning" || snapshot.connectionState === "connecting";
  const unavailable = !snapshot.transportSupport.available;

  return (
    <section className="panel connection-panel" aria-labelledby="connection-heading">
      <div className="panel-heading">
        <div>
          <h2 id="connection-heading">Feeder connection</h2>
          <p className="panel-subtitle">{connectionLabel(snapshot.connectionState, isNative)}</p>
        </div>
        <span
          className={`status-badge status-badge--${snapshot.isConnected ? "online" : "offline"}`}
          aria-label={snapshot.isConnected ? "Feeder connected" : "Feeder disconnected"}
        >
          {snapshot.isConnected ? "Online" : "Offline"}
        </span>
      </div>

      {snapshot.deviceName ? <p className="device-name">{snapshot.deviceName}</p> : null}
      {snapshot.connectionError ? (
        <StatusBanner tone="error">{snapshot.connectionError.message}</StatusBanner>
      ) : null}
      {snapshot.lastCommandError ? (
        <StatusBanner tone="error" onDismiss={() => store.clearCommandError()}>
          {snapshot.lastCommandError}
        </StatusBanner>
      ) : null}

      {unavailable ? (
        <StatusBanner tone="warning">
          {snapshot.transportSupport.reason ?? "Web Bluetooth is unavailable in this browser."}
        </StatusBanner>
      ) : null}

      <div className="connection-actions">
        {!snapshot.isConnected ? (
          <button
            type="button"
            className="button button--primary"
            onClick={() => void (snapshot.connectionState === "error" ? store.retryConnection() : store.startConnection())}
            disabled={busy || unavailable}
            aria-busy={busy}
          >
            {busy ? "Connecting…" : snapshot.connectionState === "error" ? "Retry connection" : "Connect feeder"}
          </button>
        ) : (
          <button type="button" className="button button--secondary" onClick={() => store.disconnectBle()}>
            Disconnect
          </button>
        )}
        {snapshot.chipId ? (
          <button type="button" className="button button--quiet" onClick={() => store.forgetFeeder()} disabled={busy}>
            Forget feeder
          </button>
        ) : null}
      </div>

      {!snapshot.isConnected || snapshot.clockSyncPending ? (
        <p className="connection-note">
          If your device asks for a pairing code, open the feeder’s USB serial monitor at 115200 baud.
        </p>
      ) : null}

      {!snapshot.isConnected ? (
        <div className="boundary-note">
          <h3>Provisioning</h3>
          <p>{wifi.reason}</p>
          <p className="muted-copy">Wi‑Fi credentials are not collected or saved by this app.</p>
        </div>
      ) : null}
    </section>
  );
}
