import { useState } from "react";
import { generateAlerts, getRelativeTime } from "@/protocol";
import { useFeederSnapshot, useFeederStore } from "@/state/feeder-context";
import { AlertList } from "./AlertList";
import { StatusBanner } from "./StatusBanner";

type LogSection = "sensor" | "alerts" | "feeds";

function formatSensorNumber(value: number | undefined, suffix: string): string | null {
  return value === undefined || !Number.isFinite(value) ? null : `${value.toFixed(1)}${suffix}`;
}

export function LogsView() {
  const snapshot = useFeederSnapshot();
  const store = useFeederStore();
  const [section, setSection] = useState<LogSection>("sensor");
  const alerts = generateAlerts(snapshot.deviceData, snapshot.isConnected);

  return (
    <div className="view-stack">
      {!snapshot.isConnected ? <StatusBanner tone="warning">Not connected — sensor logging is paused.</StatusBanner> : null}
      <section className="panel" aria-labelledby="logs-status-heading">
        <div className="panel-heading">
          <div>
            <h2 id="logs-status-heading">Logging status</h2>
            <p className="panel-subtitle">{snapshot.isConnected ? "Actively logging sensor data" : "Connect to resume logging"}</p>
          </div>
          <strong>{snapshot.sensorLogs.length} readings</strong>
        </div>
        <div className="tab-list" role="tablist" aria-label="Log sections">
          {(["sensor", "alerts", "feeds"] as const).map((item) => {
            const label = item === "sensor" ? "Sensor data" : item === "alerts" ? "Alerts" : "Feed history";
            return (
              <button
                type="button"
                role="tab"
                aria-selected={section === item}
                className={`tab-button ${section === item ? "tab-button--active" : ""}`}
                onClick={() => setSection(item)}
                key={item}
              >
                {label}
              </button>
            );
          })}
        </div>
      </section>

      {section === "sensor" ? (
        <section className="panel" aria-labelledby="sensor-history-heading">
          <div className="panel-heading">
            <div>
              <h2 id="sensor-history-heading">Sensor data</h2>
              <p className="panel-subtitle">Latest readings first. Kept in memory for this session.</p>
            </div>
            <button type="button" className="button button--quiet button--danger-text" onClick={() => store.clearSensorLogs()} disabled={snapshot.sensorLogs.length === 0}>
              Clear sensor logs
            </button>
          </div>
          {snapshot.sensorLogs.length === 0 ? (
            <div className="empty-state"><strong>No sensor data</strong><span>Connect to your feeder to start logging.</span></div>
          ) : (
            <div className="log-list" role="list">
              {snapshot.sensorLogs.map((entry) => (
                <article className="log-row" role="listitem" key={entry.id}>
                  <div className="log-row-heading"><time dateTime={new Date(entry.timestamp).toISOString()}>{new Date(entry.timestamp).toLocaleString()}</time><span>{entry.temperatureSensorConnected && entry.ultrasonicSensorConnected ? "Sensors ready" : "Sensor warning"}</span></div>
                  <div className="log-values">
                    {formatSensorNumber(entry.temperature, " °C") ? <span>{formatSensorNumber(entry.temperature, " °C")}</span> : null}
                    {formatSensorNumber(entry.distance, " cm") ? <span>{formatSensorNumber(entry.distance, " cm")}</span> : null}
                    {formatSensorNumber(entry.foodLevel, "%") ? <span>{formatSensorNumber(entry.foodLevel, "%")}</span> : null}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {section === "alerts" ? (
        <section className="panel" aria-labelledby="alert-history-heading">
          <div className="panel-heading"><div><h2 id="alert-history-heading">Alert history</h2><p className="panel-subtitle">Active alerts from the latest device readings.</p></div></div>
          <AlertList alerts={alerts} />
        </section>
      ) : null}

      {section === "feeds" ? (
        <section className="panel" aria-labelledby="feed-history-heading">
          <div className="panel-heading"><div><h2 id="feed-history-heading">Feed history</h2><p className="panel-subtitle">Feed completions saved in this browser.</p></div></div>
          {snapshot.feedLogs.length === 0 ? (
            <div className="empty-state"><strong>No feed history</strong><span>Feed logs appear after a completion response.</span></div>
          ) : (
            <div className="log-list" role="list">
              {snapshot.feedLogs.map((feed) => (
                <article className="log-row" role="listitem" key={feed.id}>
                  <div className="log-row-heading"><time dateTime={feed.timestamp}>{new Date(feed.timestamp).toLocaleString()}</time><span className={feed.success ? "result result--success" : "result result--danger"}>{feed.success ? "OK" : "FAIL"}</span></div>
                  <div className="log-values"><span>{Math.round(feed.feedMs / 1000)}s</span><span>Auger {Math.round(feed.augerSpeed / 10.23)}%</span><span>Spread {Math.round(feed.impellerSpeed / 10.23)}%</span></div>
                  {feed.errorMessage ? <p className="error-copy">{feed.errorMessage}</p> : null}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {alerts.length > 0 ? <p className="field-help">Alert times are shown as {getRelativeTime(alerts[0].timestamp)} when they are recent.</p> : null}
    </div>
  );
}
