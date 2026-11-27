import type { PropsWithChildren } from "react";
import { navigate, useHashRoute, type AppRoute } from "@/hooks/use-hash-route";
import { useFeederSnapshot } from "@/state/feeder-context";
import { ConnectionPanel } from "./ConnectionPanel";

const ROUTE_META: Record<AppRoute, { label: string; description: string }> = {
  dashboard: {
    label: "Dashboard",
    description: "Live feeder status and recent activity.",
  },
  controls: {
    label: "Controls",
    description: "Run a feed or stop the motor safely.",
  },
  schedule: {
    label: "Schedule",
    description: "Choose when the feeder runs automatically.",
  },
  logs: {
    label: "Logs",
    description: "Review feed history.",
  },
};

const NAV_ITEMS: readonly { route: AppRoute; label: string; icon: string }[] = [
  { route: "dashboard", label: "Dashboard", icon: "▦" },
  { route: "controls", label: "Controls", icon: "⌁" },
  { route: "schedule", label: "Schedule", icon: "◷" },
  { route: "logs", label: "Logs", icon: "≡" },
];


export function AppShell({ children }: PropsWithChildren) {
  const route = useHashRoute();
  const snapshot = useFeederSnapshot();
  const meta = ROUTE_META[route];
  const statusLabel = snapshot.isConnected
    ? "Feeder online"
    : snapshot.connectionState === "scanning" || snapshot.connectionState === "connecting"
      ? "Connecting"
      : "Feeder offline";

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar" aria-label="Primary navigation">
        <a className="brand" href="#dashboard" aria-label="Floyd dashboard">
          <span className="brand-mark" aria-hidden="true">F</span>
          <span>Floyd</span>
        </a>
        <nav className="nav-list">
          {NAV_ITEMS.map((item) => (
            <a
              key={item.route}
              className={`nav-link ${route === item.route ? "nav-link--active" : ""}`}
              href={`#${item.route}`}
              onClick={() => navigate(item.route)}
              aria-current={route === item.route ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-status" role="status" aria-live="polite">
          <span className={`status-dot status-dot--${snapshot.isConnected ? "online" : "offline"}`} aria-hidden="true" />
          <span>{statusLabel}</span>
        </div>
      </aside>

      <div className="shell-content">
        <header className="topbar">
          <div>
            <p className="product-label">FLOYD FEEDER</p>
            <p className="topbar-status" role="status" aria-live="polite">{statusLabel}</p>
          </div>
          {snapshot.chipId ? <span className="chip-id">{snapshot.chipId}</span> : null}
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>
          <div className="page-heading">
            <h1>{meta.label}</h1>
            <p>{meta.description}</p>
          </div>
          <ConnectionPanel />
          {children}
        </main>

      </div>
    </div>
  );
}
