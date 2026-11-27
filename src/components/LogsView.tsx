import { useFeederSnapshot } from "@/state/feeder-context";

const PWM_MAX = 1023;

function percent(pwm: number): number {
  return Math.round((pwm / PWM_MAX) * 100);
}

export function LogsView() {
  const snapshot = useFeederSnapshot();

  return (
    <div className="view-stack">
      <section className="panel" aria-labelledby="feed-history-heading">
        <div className="panel-heading">
          <div>
            <h2 id="feed-history-heading">Feed history</h2>
            <p className="panel-subtitle">Feeds from the app, schedules and Button A, saved in this browser.</p>
          </div>
          <strong>{snapshot.feedLogs.length} feeds</strong>
        </div>
        {snapshot.feedLogs.length === 0 ? (
          <div className="empty-state"><strong>No feed history</strong><span>Feed logs appear after a completion response.</span></div>
        ) : (
          <div className="log-list" role="list">
            {snapshot.feedLogs.map((feed) => (
              <article className="log-row" role="listitem" key={feed.id}>
                <div className="log-row-heading"><time dateTime={feed.timestamp}>{new Date(feed.timestamp).toLocaleString()}</time><span className={feed.success ? "result result--success" : "result result--danger"}>{feed.success ? "OK" : "FAIL"}</span></div>
                <div className="log-values"><span>{Math.round(feed.feedMs / 1000)}s</span><span>Auger {percent(feed.augerSpeed)}%</span><span>Spread {percent(feed.impellerSpeed)}%</span></div>
                {feed.errorMessage ? <p className="error-copy">{feed.errorMessage}</p> : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
