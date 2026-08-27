import type { Alert } from "@/protocol";
import { getRelativeTime } from "@/protocol";

interface AlertListProps {
  alerts: Alert[];
  limit?: number;
}

export function AlertList({ alerts, limit }: AlertListProps) {
  const visibleAlerts = limit === undefined ? alerts : alerts.slice(0, limit);
  if (visibleAlerts.length === 0) {
    return (
      <div className="empty-state empty-state--success">
        <strong>All systems normal</strong>
        <span>No active alerts at this time.</span>
      </div>
    );
  }

  return (
    <div className="alert-list" role="list">
      {visibleAlerts.map((alert) => (
        <article key={alert.id} className={`alert-row alert-row--${alert.severity.toLowerCase()}`} role="listitem">
          <div className="alert-row-heading">
            <strong>{alert.type.replaceAll("_", " ")}</strong>
            <time dateTime={new Date(alert.timestamp).toISOString()}>{getRelativeTime(alert.timestamp)}</time>
          </div>
          <p>{alert.message}</p>
        </article>
      ))}
    </div>
  );
}
