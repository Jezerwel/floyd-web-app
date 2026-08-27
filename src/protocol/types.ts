export type DeviceMessageType =
  | "sensor_data"
  | "control_response"
  | "error"
  | "status"
  | "schedules_list"
  | (string & {});

export type DeviceMessageData = Record<string, unknown> | unknown[];

export interface DeviceMessage {
  type: DeviceMessageType;
  data: DeviceMessageData;
  timestamp: number;
}

export type CommandAction =
  | "start_feed"
  | "stop_feed"
  | "clear_jam"
  | "get_sensors"
  | "set_sensor_interval"
  | "set_config"
  | "ping"
  | "get_schedules"
  | "set_schedules"
  | "switch_mode"
  | "restart_provisioning";

export interface CommandEnvelope {
  action: string;
  parameters?: Record<string, unknown>;
  timestamp: number;
}

export interface FeederConfig {
  cylinderRadius: number;
  cylinderHeight: number;
  frustumTopRadius: number;
  frustumBottomRadius: number;
  frustumHeight: number;
  totalVolumeCm3: number;
  defaultPreSpinMs: number;
  defaultPostSpinMs: number;
  defaultFeedMs: number;
}

export type MotorState =
  | "idle"
  | "pre_spin"
  | "feeding"
  | "post_spin"
  | "jam_clear";

export interface DeviceData {
  temperature?: number;
  temperatureSensorConnected?: boolean;
  ultrasonicSensorConnected?: boolean;
  distance?: number;
  foodLevelPercentage?: number;
  motorState?: MotorState;
  augerSpeed?: number;
  impellerSpeed?: number;
  wifiRssi?: number;
  feederConfig?: FeederConfig;
  lastUpdate?: number;
  esp32Connected?: boolean;
}

export interface Schedule {
  id: string;
  label: string;
  time: string;
  daysOfWeek: string;
  augerSpeed: number;
  impellerSpeed: number;
  preSpinMs: number;
  feedMs: number;
  postSpinMs: number;
  enabled: boolean;
}

export interface FeedLogEntry {
  id: string;
  timestamp: string;
  augerSpeed: number;
  impellerSpeed: number;
  feedMs: number;
  success: boolean;
  errorMessage?: string;
}

export interface SensorLogEntry {
  id: string;
  timestamp: number;
  temperature?: number;
  distance?: number;
  foodLevel?: number;
  temperatureSensorConnected: boolean;
  ultrasonicSensorConnected: boolean;
}

export interface Alert {
  id: string;
  type:
    | "LOW_FOOD"
    | "CRITICAL_FOOD"
    | "TEMPERATURE_HIGH"
    | "TEMPERATURE_LOW"
    | "SENSOR_DISCONNECTED"
    | "CONNECTION_LOST";
  message: string;
  timestamp: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  isResolved: boolean;
  triggerValue?: number;
}

export type ConnectionState =
  | "idle"
  | "scanning"
  | "connecting"
  | "connected"
  | "error";

export type ConnectionErrorKind =
  | "unsupported"
  | "insecure_context"
  | "cancelled"
  | "no_devices"
  | "connection_failed"
  | "connection_lost"
  | "permission_denied"
  | "bluetooth_off"
  | "unknown";

export interface ConnectionError {
  kind: ConnectionErrorKind;
  message: string;
}
