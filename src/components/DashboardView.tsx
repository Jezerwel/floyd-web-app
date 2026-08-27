import { generateAlerts } from "@/protocol";
import { useFeederSnapshot, useFeederStore } from "@/state/feeder-context";
import { AlertList } from "./AlertList";
import { MetricCard } from "./MetricCard";
import { StatusBanner } from "./StatusBanner";

function validValue(value: number | undefined, min: number, max: number): number | null {
  return value !== undefined && Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function motorLabel(state: string | undefined): string {
  const labels: Record<string, string> = {
    idle: "Idle",
    pre_spin: "Getting ready",
    feeding: "Feeding",
    post_spin: "Finishing up",
    jam_clear: "Unclogging",
  };
  return labels[state ?? "idle"] ?? "Idle";
}

function formatFeedDate(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

export function DashboardView() {
  const snapshot = useFeederSnapshot();
  const store = useFeederStore();
  const temperature = snapshot.isConnected
    ? validValue(snapshot.deviceData.temperature, -40, 85)
    : null;
  const foodLevel = snapshot.isConnected
    ? validValue(snapshot.deviceData.foodLevelPercentage, 0, 100)
    : null;
  const distance = snapshot.isConnected ? validValue(snapshot.deviceData.distance, 0, 400) : null;
  const alerts = generateAlerts(snapshot.deviceData, snapshot.isConnected);
  const activeMotor = snapshot.deviceData.motorState && snapshot.deviceData.motorState !== "idle";

  return (
    <div className="view-stack">
      {snapshot.wasConnected && !snapshot.isConnected ? (
        <StatusBanner tone={snapshot.connectionState === "error" ? "error" : "warning"}>
          {snapshot.connectionState === "scanning" ? "Connection lost — reconnecting…" : "Connection lost."}
        </StatusBanner>
      ) : null}

      <section className="metric-grid" aria-label="Feeder readings">
        <MetricCard
          label="Food remaining"
          value={foodLevel === null ? "--" : foodLevel.toFixed(0)}
          unit={foodLevel === null ? undefined : "%"}
          detail={distance === null ? "Level sensor: no data" : `Level distance ${distance.toFixed(1)} cm`}
          tone={foodLevel !== null && foodLevel <= 10 ? "danger" : "primary"}
        />
        <MetricCard
          label="Water temperature"
          value={temperature === null ? "--" : temperature.toFixed(1)}
          unit={temperature === null ? undefined : "°C"}
          detail={snapshot.deviceData.temperatureSensorConnected === false ? "Temperature sensor disconnected" : "Temperature sensor"}
          tone={temperature !== null && (temperature < 20 || temperature > 32) ? "warning" : "secondary"}
        />
        <MetricCard
          label="Motor status"
          value={motorLabel(snapshot.deviceData.motorState)}
          detail={activeMotor ? `Auger ${snapshot.deviceData.augerSpeed ?? 0} · spread ${snapshot.deviceData.impellerSpeed ?? 0}` : "Ready for a manual feed"}
          tone={activeMotor ? "primary" : "neutral"}
        />
      </section>

      <section className="panel capacity-panel" aria-labelledby="capacity-heading">
        <div className="panel-heading">
          <div>
            <h2 id="capacity-heading">Feeder capacity</h2>
            <p className="panel-subtitle">Current reading from the ultrasonic level sensor.</p>
          </div>
          <strong>{foodLevel === null ? "--" : `${foodLevel.toFixed(0)}%`}</strong>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-label="Food remaining"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={foodLevel ?? 0}
          aria-valuetext={foodLevel === null ? "No reading" : `${foodLevel.toFixed(0)} percent`}
        >
          <span className="progress-fill" style={{ width: `${foodLevel ?? 0}%` }} />
        </div>
        <p className="field-help">
          {snapshot.deviceData.ultrasonicSensorConnected === false ? "Food level sensor disconnected." : foodLevel === null ? "Connect to see a live capacity reading." : "Reading is within the feeder sensor range."}
        </p>
      </section>

      <section className="panel" aria-labelledby="alerts-heading">
        <div className="panel-heading">
          <div>
            <h2 id="alerts-heading">Alerts{alerts.length > 0 ? ` (${alerts.length})` : ""}</h2>
            <p className="panel-subtitle">Derived from the latest valid sensor readings.</p>
          </div>
        </div>
        <AlertList alerts={alerts} limit={3} />
        {alerts.length > 3 ? <a className="inline-link" href="#logs" >View all alerts</a> : null}
      </section>

      <section className="panel" aria-labelledby="recent-feed-heading">
        <div className="panel-heading">
          <div>
            <h2 id="recent-feed-heading">Recent feeds</h2>
            <p className="panel-subtitle">Feed completions saved in this browser.</p>
          </div>
          <button type="button" className="button button--quiet" onClick={() => void store.requestSensorData()} disabled={!snapshot.isConnected}>
            Refresh
          </button>
        </div>
        {snapshot.feedLogs.length === 0 ? (
          <div className="empty-state"><strong>No feed history</strong><span>Completed feeds will appear here.</span></div>
        ) : (
          <div className="feed-list" role="list">
            {snapshot.feedLogs.slice(0, 3).map((feed) => (
              <div className="feed-row" role="listitem" key={feed.id}>
                <div><strong>{feed.success ? "Feed completed" : "Feed failed"}</strong><time dateTime={feed.timestamp}>{formatFeedDate(feed.timestamp)}</time></div>
                <span className={feed.success ? "result result--success" : "result result--danger"}>{feed.success ? "OK" : "FAIL"}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
