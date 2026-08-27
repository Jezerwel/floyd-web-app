import type { FeedLogEntry } from "@/protocol";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const STORAGE_KEYS = {
  chipId: "floydChipId",
  feedLogs: "floyd-feedlogs",
} as const;

const emptyStorage: StorageLike = {
  getItem: () => null,
  setItem: () => undefined,
  removeItem: () => undefined,
};

export function getBrowserStorage(): StorageLike {
  if (typeof localStorage === "undefined") return emptyStorage;
  return localStorage;
}

function isFeedLogEntry(value: unknown): value is FeedLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.timestamp === "string" &&
    typeof entry.augerSpeed === "number" &&
    typeof entry.impellerSpeed === "number" &&
    typeof entry.feedMs === "number" &&
    typeof entry.success === "boolean" &&
    (entry.errorMessage === undefined || typeof entry.errorMessage === "string")
  );
}

export function loadFeedLogs(storage: StorageLike): FeedLogEntry[] {
  try {
    const raw = storage.getItem(STORAGE_KEYS.feedLogs);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isFeedLogEntry).slice(0, 100);
  } catch {
    return [];
  }
}

export function saveFeedLogs(storage: StorageLike, logs: FeedLogEntry[]): void {
  try {
    storage.setItem(STORAGE_KEYS.feedLogs, JSON.stringify(logs.slice(0, 100)));
  } catch {
    // Storage can be blocked by privacy mode; in-memory behavior remains usable.
  }
}

export function loadChipId(storage: StorageLike): string | null {
  try {
    const value = storage.getItem(STORAGE_KEYS.chipId)?.trim();
    return value || null;
  } catch {
    return null;
  }
}

export function saveChipId(storage: StorageLike, chipId: string): void {
  try {
    storage.setItem(STORAGE_KEYS.chipId, chipId);
  } catch {
    // Storage can be blocked by privacy mode; reconnect still works this session.
  }
}

export function removeChipId(storage: StorageLike): void {
  try {
    storage.removeItem(STORAGE_KEYS.chipId);
  } catch {
    // Storage can be blocked by privacy mode; the active connection is still cleared.
  }
}
