interface MetricCardProps {
  label: string;
  value: string;
  unit?: string;
  detail?: string;
  tone?: "primary" | "secondary" | "warning" | "danger" | "neutral";
}

export function MetricCard({ label, value, unit, detail, tone = "neutral" }: MetricCardProps) {
  return (
    <article className={`metric-card metric-card--${tone}`}>
      <p className="metric-label">{label}</p>
      <p className="metric-value">
        {value}
        {unit ? <span className="metric-unit">{unit}</span> : null}
      </p>
      {detail ? <p className="metric-detail">{detail}</p> : null}
    </article>
  );
}
