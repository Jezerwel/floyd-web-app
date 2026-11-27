import {
  createCommandEnvelope,
  type CommandEnvelope,
  type DeviceData,
  type DeviceMessage,
  type FeedLogEntry,
  type FeederConfig,
  type MotorDirection,
  type Schedule,
} from "@/protocol";
import { validateScheduleList } from "@/protocol/schedules";
import {
  getBrowserStorage,
  loadChipId,
  loadFeedLogs,
  removeChipId,
  saveChipId,
  saveFeedLogs,
  type StorageLike,
} from "@/storage/local-storage";
import { normalizeTransportError } from "@/transport/errors";
import { createDefaultTransport } from "@/transport/wifi-boundary";
import type { FeederTransport, TransportSupport } from "@/transport/transport";

const MAX_FEED_LOG_ENTRIES = 100;
const DEFAULT_AUTO_REFRESH_INTERVAL = 10_000;
const DEFAULT_RECONNECT_DELAY = 1_000;
const DEFAULT_RECONNECT_ATTEMPTS = 3;
const DEFAULT_RECONNECT_WINDOW = 30_000;

export interface FeederSnapshot {
  readonly connectionState: "idle" | "scanning" | "connecting" | "connected" | "error";
  readonly connectionError: { kind: string; message: string } | null;
  readonly connectionElapsedMs: number;
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly wasConnected: boolean;
  readonly chipId: string | null;
  readonly deviceName: string | null;
  readonly deviceData: DeviceData;
  readonly schedules: Schedule[];
  readonly feedLogs: FeedLogEntry[];
  readonly lastCommandError: string | null;
  readonly isAutoRefreshEnabled: boolean;
  readonly autoRefreshInterval: number;
  readonly bleRssi: number | null;
  readonly transportSupport: TransportSupport;
  readonly transportKind: FeederTransport["kind"];
}

export interface VisibilityTarget {
  visibilityState?: string;
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
}

export interface FeederStoreOptions {
  transport?: FeederTransport;
  storage?: StorageLike;
  now?: () => number;
  reconnectDelayMs?: number;
  reconnectAttempts?: number;
  reconnectWindowMs?: number;
  visibilityTarget?: VisibilityTarget;
}

export type FeederListener = () => void;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isFeederConfig(value: unknown): value is FeederConfig {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.cylinderRadius === "number" &&
    Number.isFinite(record.cylinderRadius) &&
    typeof record.cylinderHeight === "number" &&
    Number.isFinite(record.cylinderHeight) &&
    typeof record.frustumTopRadius === "number" &&
    Number.isFinite(record.frustumTopRadius) &&
    typeof record.frustumBottomRadius === "number" &&
    Number.isFinite(record.frustumBottomRadius) &&
    typeof record.frustumHeight === "number" &&
    Number.isFinite(record.frustumHeight) &&
    typeof record.totalVolumeCm3 === "number" &&
    Number.isFinite(record.totalVolumeCm3) &&
    typeof record.defaultPreSpinMs === "number" &&
    Number.isFinite(record.defaultPreSpinMs) &&
    typeof record.defaultPostSpinMs === "number" &&
    Number.isFinite(record.defaultPostSpinMs) &&
    typeof record.defaultFeedMs === "number" &&
    Number.isFinite(record.defaultFeedMs)
  );
}
function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asMotorState(value: unknown): DeviceData["motorState"] | undefined {
  if (
    value === "idle" ||
    value === "pre_spin" ||
    value === "feeding" ||
    value === "post_spin" ||
    value === "jam_clear"
  ) {
    return value;
  }
  return undefined;
}

function asMotorDirection(value: unknown): MotorDirection | undefined {
  return value === "forward" || value === "reverse" || value === "brake" ? value : undefined;
}

function asPwm(value: unknown): number | undefined {
  const pwm = asFiniteNumber(value);
  return pwm !== undefined && pwm >= 0 && pwm <= 1023 ? pwm : undefined;
}

function isSchedule(value: unknown): value is Schedule {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.id === "string" &&
    typeof record.label === "string" &&
    typeof record.time === "string" &&
    typeof record.daysOfWeek === "string" &&
    typeof record.augerSpeed === "number" &&
    typeof record.impellerSpeed === "number" &&
    typeof record.preSpinMs === "number" &&
    typeof record.feedMs === "number" &&
    typeof record.postSpinMs === "number" &&
    typeof record.enabled === "boolean"
  );
}

function toErrorMessage(error: unknown): string {
  return normalizeTransportError(error).message;
}

export class FeederStore {
  private snapshot: FeederSnapshot;
  private readonly listeners = new Set<FeederListener>();
  private readonly transport: FeederTransport;
  private readonly storage: StorageLike;
  private readonly now: () => number;
  private readonly reconnectDelayMs: number;
  private readonly reconnectAttempts: number;
  private readonly reconnectWindowMs: number;
  private readonly visibilityTarget: VisibilityTarget | undefined;
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeDisconnect: () => void;
  private readonly onVisibilityChange = (): void => {
    if (this.visibilityTarget?.visibilityState !== "visible" || !this.snapshot.isConnected) return;
    void this.syncTime().catch(() => undefined);
  };
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private elapsedTimer: ReturnType<typeof setInterval> | null = null;
  private autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
  private connectionStartedAt = 0;
  private reconnectStartedAt = 0;
  private reconnectCount = 0;
  private manualDisconnect = false;
  private destroyed = false;

  constructor(options: FeederStoreOptions = {}) {
    this.transport = options.transport ?? createDefaultTransport();
    this.storage = options.storage ?? getBrowserStorage();
    this.now = options.now ?? (() => Date.now());
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY;
    this.reconnectAttempts = options.reconnectAttempts ?? DEFAULT_RECONNECT_ATTEMPTS;
    this.reconnectWindowMs = options.reconnectWindowMs ?? DEFAULT_RECONNECT_WINDOW;
    this.visibilityTarget = options.visibilityTarget ?? this.defaultVisibilityTarget();
    this.snapshot = {
      connectionState: "idle",
      connectionError: null,
      connectionElapsedMs: 0,
      isConnected: false,
      isConnecting: false,
      wasConnected: false,
      chipId: loadChipId(this.storage),
      deviceName: null,
      deviceData: {},
      schedules: [],
      feedLogs: loadFeedLogs(this.storage),
      lastCommandError: null,
      isAutoRefreshEnabled: true,
      autoRefreshInterval: DEFAULT_AUTO_REFRESH_INTERVAL,
      bleRssi: null,
      transportSupport: this.transport.support,
      transportKind: this.transport.kind,
    };
    this.unsubscribeMessage = this.transport.onMessage((message) => this.handleMessage(message));
    this.unsubscribeDisconnect = this.transport.onDisconnect((reason) => this.handleDisconnect(reason));
    this.visibilityTarget?.addEventListener("visibilitychange", this.onVisibilityChange);
  }

  subscribe = (listener: FeederListener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): FeederSnapshot => this.snapshot;

  async startConnection(): Promise<boolean> {
    this.cancelReconnect();
    this.manualDisconnect = false;
    this.reconnectCount = 0;
    this.reconnectStartedAt = 0;
    if (!this.transport.support.available) {
      this.enterConnectionError(
        this.transport.support.code ?? "unsupported",
        this.transport.support.reason ?? "Bluetooth is unavailable.",
      );
      return false;
    }
    this.stopAutoRefresh();
    this.setConnectionState("scanning");
    try {
      await this.transport.connect({ requestDevice: true, chipId: this.snapshot.chipId });
      await this.markConnected();
      return true;
    } catch (error) {
      const normalized = normalizeTransportError(error);
      this.enterConnectionError(normalized.code, normalized.message);
      return false;
    }
  }

  async connectToDevice(deviceId: string, feederChipId: string): Promise<boolean> {
    void deviceId;
    this.patch({ chipId: feederChipId });
    saveChipId(this.storage, feederChipId);
    return this.startConnection();
  }

  retryConnection(): Promise<boolean> {
    return this.startConnection();
  }

  disconnectBle(): void {
    this.manualDisconnect = true;
    this.cancelReconnect();
    this.stopElapsedTimer();
    this.stopAutoRefresh();
    void this.transport.disconnect();
    this.reconnectCount = 0;
    this.reconnectStartedAt = 0;
    this.patch({
      connectionState: "idle",
      connectionError: null,
      connectionElapsedMs: 0,
      isConnected: false,
      isConnecting: false,
      wasConnected: false,
      lastCommandError: null,
    });
  }

  forgetFeeder(): void {
    this.disconnectBle();
    removeChipId(this.storage);
    this.patch({ chipId: null, deviceName: null });
  }

  requestSensorData(): Promise<boolean> {
    return this.sendCommand("get_sensors");
  }

  startFeed(parameters: Record<string, number>): Promise<boolean> {
    return this.sendCommand("start_feed", parameters);
  }

  stopFeed(): Promise<boolean> {
    return this.sendCommand("stop_feed");
  }

  clearJam(speed = 768, duration = 2000): Promise<boolean> {
    return this.sendCommand("clear_jam", { speed, duration });
  }

  setSensorReadingInterval(interval: number): Promise<boolean> {
    return this.sendCommand("set_sensor_interval", { interval });
  }

  async reloadSchedules(): Promise<boolean> {
    if (!this.snapshot.isConnected) {
      this.setCommandError("Not connected to feeder.");
      return false;
    }
    try {
      const schedules = await this.transport.readSchedules();
      this.patch({ schedules, lastCommandError: null });
      return true;
    } catch (error) {
      this.setCommandError(toErrorMessage(error));
      return false;
    }
  }

  async publishScheduleSync(schedules: Schedule[]): Promise<boolean> {
    const validationErrors = validateScheduleList(schedules);
    if (validationErrors.length > 0) {
      this.setCommandError(validationErrors.join(" "));
      return false;
    }
    if (!this.snapshot.isConnected) {
      this.setCommandError("Not connected to feeder.");
      return false;
    }
    try {
      await this.transport.writeSchedules(schedules);
      this.patch({ schedules: [...schedules], lastCommandError: null });
      return true;
    } catch (error) {
      this.setCommandError(toErrorMessage(error));
      return false;
    }
  }

  setAutoRefreshEnabled(enabled: boolean): void {
    this.patch({ isAutoRefreshEnabled: enabled });
    if (enabled && this.snapshot.isConnected) this.startAutoRefresh();
    else this.stopAutoRefresh();
  }

  setAutoRefreshInterval(interval: number): void {
    const nextInterval = Number.isFinite(interval) ? Math.max(1_000, interval) : DEFAULT_AUTO_REFRESH_INTERVAL;
    this.patch({ autoRefreshInterval: nextInterval });
    if (this.snapshot.isConnected && this.snapshot.isAutoRefreshEnabled) this.startAutoRefresh();
  }

  setFeedLogs(logs: FeedLogEntry[]): void {
    const bounded = logs.slice(0, MAX_FEED_LOG_ENTRIES);
    this.patch({ feedLogs: bounded });
    saveFeedLogs(this.storage, bounded);
  }

  clearCommandError(): void {
    this.patch({ lastCommandError: null });
  }

  dispose(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribeMessage();
    this.unsubscribeDisconnect();
    this.visibilityTarget?.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.cancelReconnect();
    this.stopElapsedTimer();
    this.stopAutoRefresh();
    void this.transport.disconnect();
    this.listeners.clear();
  }

  private async sendCommand(
    action: string,
    parameters?: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.snapshot.isConnected) {
      this.setCommandError("Not connected to feeder.");
      return false;
    }
    const payload: CommandEnvelope = createCommandEnvelope(action, parameters, this.now());
    this.patch({ lastCommandError: null });
    try {
      await this.transport.sendCommand(payload);
      return true;
    } catch (error) {
      this.setCommandError(toErrorMessage(error));
      return false;
    }
  }

  private syncTime(): Promise<void> {
    const now = this.now();
    return this.transport.syncTime(Math.floor(now / 1000), -new Date(now).getTimezoneOffset());
  }

  private async markConnected(): Promise<void> {
    this.stopElapsedTimer();
    const chipId = this.transport.chipId ?? this.snapshot.chipId;
    if (chipId) saveChipId(this.storage, chipId);
    this.patch({
      connectionState: "connected",
      connectionError: null,
      connectionElapsedMs: 0,
      isConnected: true,
      isConnecting: false,
      wasConnected: true,
      chipId,
      deviceName: this.transport.deviceName,
      bleRssi: null,
      lastCommandError: null,
    });
    this.reconnectCount = 0;
    this.reconnectStartedAt = 0;
    await this.syncTime().catch(() => undefined);
    this.startAutoRefresh();
    await this.reloadSchedules();
  }

  private handleMessage(message: DeviceMessage): void {
    const data = asRecord(message.data);
    if (message.type === "sensor_data" && data) {
      const previous = this.snapshot.deviceData;
      this.patch({
        deviceData: {
          ...previous,
          motorState: asMotorState(data.motorState) ?? previous.motorState ?? "idle",
          augerSpeed: asPwm(data.augerSpeed) ?? previous.augerSpeed,
          impellerSpeed: asPwm(data.impellerSpeed) ?? previous.impellerSpeed,
          augerDirection: asMotorDirection(data.augerDirection) ?? previous.augerDirection,
          impellerDirection: asMotorDirection(data.impellerDirection) ?? previous.impellerDirection,
          buttonAPressed: asBoolean(data.buttonAPressed) ?? previous.buttonAPressed,
          buttonBPressed: asBoolean(data.buttonBPressed) ?? previous.buttonBPressed,
          lastUpdate: message.timestamp,
          esp32Connected: true,
        },
      });
      return;
    }

    if (message.type === "control_response" && data) {
      const nextData: DeviceData = {
        ...this.snapshot.deviceData,
        motorState: asMotorState(data.motorState) ?? this.snapshot.deviceData.motorState,
        lastUpdate: message.timestamp,
        esp32Connected: true,
      };
      this.patch({ deviceData: nextData });
      if (data.action === "feed_complete") this.appendFeedLog(data);
      return;
    }

    if (message.type === "status" && data) {
      this.patch({
        deviceData: {
          ...this.snapshot.deviceData,
          feederConfig: isFeederConfig(data.feederConfig)
            ? data.feederConfig
            : this.snapshot.deviceData.feederConfig,
          wifiRssi: asFiniteNumber(data.wifiRssi) ?? this.snapshot.deviceData.wifiRssi,
          lastUpdate: message.timestamp,
          esp32Connected: data.connected !== false,
        },
      });
      return;
    }

    if (message.type === "schedules_list" && Array.isArray(message.data)) {
      this.patch({
        schedules: message.data.filter(isSchedule),
        deviceData: { ...this.snapshot.deviceData, lastUpdate: message.timestamp },
      });
      return;
    }

    if (message.type === "error") {
      const messageText = data && typeof data.message === "string" ? data.message : "The feeder reported an error.";
      this.setCommandError(messageText);
    }
  }

  private appendFeedLog(data: Record<string, unknown>): void {
    const entry: FeedLogEntry = {
      id: `${this.now()}-${this.snapshot.feedLogs.length}`,
      timestamp: new Date(this.now()).toISOString(),
      augerSpeed: asFiniteNumber(data.augerSpeed) ?? 768,
      impellerSpeed: asFiniteNumber(data.impellerSpeed) ?? 1023,
      feedMs: asFiniteNumber(data.feedMs) ?? 3000,
      success: data.success !== false,
      errorMessage: typeof data.errorMessage === "string" ? data.errorMessage : undefined,
    };
    const feedLogs = [entry, ...this.snapshot.feedLogs].slice(0, MAX_FEED_LOG_ENTRIES);
    this.patch({ feedLogs });
    saveFeedLogs(this.storage, feedLogs);
  }

  private handleDisconnect(_reason: string | null): void {
    void _reason;
    if (this.manualDisconnect || this.snapshot.connectionState === "idle") return;
    this.stopElapsedTimer();
    this.stopAutoRefresh();
    this.reconnectStartedAt ||= this.now();
    this.reconnectCount = 0;
    this.patch({
      connectionState: "scanning",
      connectionError: null,
      connectionElapsedMs: 0,
      isConnected: false,
      isConnecting: false,
      wasConnected: true,
    });
    this.startElapsedTimer();
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.cancelReconnect();
    this.reconnectTimer = setTimeout(() => void this.attemptReconnect(), this.reconnectDelayMs);
  }

  private async attemptReconnect(): Promise<void> {
    this.reconnectTimer = null;
    if (this.manualDisconnect || this.snapshot.connectionState !== "scanning") return;
    if (
      this.reconnectCount >= this.reconnectAttempts ||
      this.now() - this.reconnectStartedAt >= this.reconnectWindowMs
    ) {
      this.enterConnectionError(
        "connection_lost",
        "Connection lost after multiple reconnect attempts. Make sure the feeder is powered on and nearby.",
      );
      return;
    }

    this.reconnectCount += 1;
    this.setConnectionState("connecting");
    try {
      await this.transport.connect({ requestDevice: false, chipId: this.snapshot.chipId });
      await this.markConnected();
    } catch {
      if (
        this.reconnectCount >= this.reconnectAttempts ||
        this.now() - this.reconnectStartedAt >= this.reconnectWindowMs
      ) {
        this.enterConnectionError(
          "connection_lost",
          "Connection lost after multiple reconnect attempts. Make sure the feeder is powered on and nearby.",
        );
      } else {
        this.setConnectionState("scanning");
        this.scheduleReconnect();
      }
    }
  }

  private enterConnectionError(kind: string, message: string): void {
    this.cancelReconnect();
    this.stopElapsedTimer();
    this.stopAutoRefresh();
    this.patch({
      connectionState: "error",
      connectionError: { kind, message },
      connectionElapsedMs: 0,
      isConnected: false,
      isConnecting: false,
    });
  }

  private setCommandError(message: string): void {
    this.patch({ lastCommandError: message });
  }

  private setConnectionState(state: FeederSnapshot["connectionState"]): void {
    const entering = state === "scanning" || state === "connecting";
    if (entering) this.startElapsedTimer();
    else this.stopElapsedTimer();
    this.patch({
      connectionState: state,
      connectionError: state === "connected" ? null : this.snapshot.connectionError,
      connectionElapsedMs: entering ? 0 : this.snapshot.connectionElapsedMs,
      isConnected: state === "connected",
      isConnecting: state === "connecting",
    });
  }

  private startElapsedTimer(): void {
    if (this.elapsedTimer) return;
    this.connectionStartedAt = this.now();
    this.elapsedTimer = setInterval(() => {
      this.patch({ connectionElapsedMs: this.now() - this.connectionStartedAt });
    }, 1_000);
  }

  private stopElapsedTimer(): void {
    if (!this.elapsedTimer) return;
    clearInterval(this.elapsedTimer);
    this.elapsedTimer = null;
  }

  private startAutoRefresh(): void {
    this.stopAutoRefresh();
    if (!this.snapshot.isConnected || !this.snapshot.isAutoRefreshEnabled) return;
    this.autoRefreshTimer = setInterval(() => {
      if (this.snapshot.isConnected) void this.requestSensorData();
    }, this.snapshot.autoRefreshInterval);
  }

  private stopAutoRefresh(): void {
    if (!this.autoRefreshTimer) return;
    clearInterval(this.autoRefreshTimer);
    this.autoRefreshTimer = null;
  }

  private cancelReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }

  private patch(update: Partial<FeederSnapshot>): void {
    if (this.destroyed) return;
    this.snapshot = { ...this.snapshot, ...update };
    for (const listener of this.listeners) listener();
  }

  private defaultVisibilityTarget(): VisibilityTarget | undefined {
    if (typeof document === "undefined") return undefined;
    return document;
  }
}
