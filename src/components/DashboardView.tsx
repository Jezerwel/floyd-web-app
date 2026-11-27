import type { MotorDirection } from "@/protocol";
import { useFeederSnapshot, useFeederStore } from "@/state/feeder-context";
import { MetricCard } from "./MetricCard";
import { StatusBanner } from "./StatusBanner";

const PWM_MAX = 1023;

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

const DIRECTION_LABELS: Record<MotorDirection, string> = {
  forward: "Forward",
  reverse: "Reverse",
  brake: "Brake",
};

function speedPercent(pwm: number | undefined): string {
  return pwm === undefined ? "--" : `${Math.round((pwm / PWM_MAX) * 100)}%`;
}

function formatFeedDate(timestamp: string): string {
  return new Date(timestamp).toLocaleString();
}

export function DashboardView() {
  const snapshot = useFeederSnapshot();
  const store = useFeederStore();
  const data = snapshot.isConnected ? snapshot.deviceData : {};
  const activeMotor = data.motorState !== undefined && data.motorState !== "idle";
  const motors = [
    { name: "Auger", detail: "Feed motor", direction: data.augerDirection, speed: data.augerSpeed },
    { name: "Impeller", detail: "Spread motor", direction: data.impellerDirection, speed: data.impellerSpeed },
  ];
  const buttons = [
    { name: "Button A", role: "feed", pressed: data.buttonAPressed },
    { name: "Button B", role: "clear jam", pressed: data.buttonBPressed },
  ];

  return (
    <div className="view-stack">
      {snapshot.wasConnected && !snapshot.isConnected ? (
        <StatusBanner tone={snapshot.connectionState === "error" ? "error" : "warning"}>
          {snapshot.connectionState === "scanning" ? "Connection lost — reconnecting…" : "Connection lost."}
        </StatusBanner>
      ) : null}

      <section className="metric-grid" aria-label="Feeder status">
        <MetricCard
          label="Motor status"
          value={snapshot.isConnected ? motorLabel(data.motorState) : "--"}
          detail={activeMotor ? "Sequence running" : snapshot.isConnected ? "Ready for a manual feed" : "Connect to see live status"}
          tone={activeMotor ? "primary" : "neutral"}
        />
        {motors.map((motor) => {
          const running = motor.direction === "forward" || motor.direction === "reverse";
          return (
            <MetricCard
              key={motor.name}
              ariaLabel={`${motor.name} motor`}
              label={motor.name}
              value={motor.direction ? DIRECTION_LABELS[motor.direction] : "--"}
              detail={`${motor.detail} · speed ${speedPercent(motor.speed)}`}
              tone={motor.direction === "reverse" ? "warning" : running ? "primary" : "neutral"}
            />
          );
        })}
      </section>

      <section className="panel" aria-labelledby="buttons-heading">
        <div className="panel-heading">
          <div>
            <h2 id="buttons-heading">Feeder buttons</h2>
            <p className="panel-subtitle">Button A starts or stops a feed. Button B clears a jam.</p>
          </div>
        </div>
        <div className="log-list">
          {buttons.map((button) => (
            <div className="log-row log-row-heading" role="group" aria-label={`${button.name} (${button.role})`} key={button.name}>
              <strong>{button.name} · {button.role}</strong>
              <span className={button.pressed ? "result result--success" : "result"}>
                {button.pressed === undefined ? "--" : button.pressed ? "Pressed" : "Released"}
              </span>
            </div>
          ))}
        </div>
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
