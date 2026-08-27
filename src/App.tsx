import { AppShell } from "@/components/AppShell";
import { ControlsView } from "@/components/ControlsView";
import { DashboardView } from "@/components/DashboardView";
import { LogsView } from "@/components/LogsView";
import { ScheduleView } from "@/components/ScheduleView";
import { useHashRoute } from "@/hooks/use-hash-route";

export function App() {
  const route = useHashRoute();
  const view = route === "dashboard"
    ? <DashboardView />
    : route === "controls"
      ? <ControlsView />
      : route === "schedule"
        ? <ScheduleView />
        : <LogsView />;

  return <AppShell>{view}</AppShell>;
}
