interface StatusBannerProps {
  tone: "error" | "warning" | "info" | "success";
  children: string;
  onDismiss?: () => void;
}

export function StatusBanner({ tone, children, onDismiss }: StatusBannerProps) {
  return (
    <div className={`status-banner status-banner--${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span>{children}</span>
      {onDismiss ? (
        <button type="button" className="icon-button" onClick={onDismiss} aria-label="Dismiss message">
          ×
        </button>
      ) : null}
    </div>
  );
}
