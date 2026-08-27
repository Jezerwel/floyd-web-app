import { useSyncExternalStore } from "react";

export type AppRoute = "dashboard" | "controls" | "schedule" | "logs";

const ROUTES: readonly AppRoute[] = ["dashboard", "controls", "schedule", "logs"];

function readRoute(): AppRoute {
  if (typeof window === "undefined") return "dashboard";
  const raw = window.location.hash.slice(1).split("?")[0];
  return ROUTES.includes(raw as AppRoute) ? (raw as AppRoute) : "dashboard";
}

function subscribeToHash(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => window.removeEventListener("hashchange", listener);
}
export function navigate(route: AppRoute): void {
  window.location.hash = route;
  window.dispatchEvent(new Event("hashchange"));
}

export function useHashRoute(): AppRoute {
  return useSyncExternalStore(subscribeToHash, readRoute, () => "dashboard");
}
