export const FLOYD_BLE_SERVICE = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
export const FLOYD_BLE_COMMAND = "4fafc201-1fb5-459e-8fcc-c5c9c3319141";
export const FLOYD_BLE_RESPONSE = "4fafc201-1fb5-459e-8fcc-c5c9c3319142";
export const FLOYD_BLE_TELEMETRY = "4fafc201-1fb5-459e-8fcc-c5c9c3319143";
export const FLOYD_BLE_STATUS = "4fafc201-1fb5-459e-8fcc-c5c9c3319144";
export const FLOYD_BLE_SCHEDULES = "4fafc201-1fb5-459e-8fcc-c5c9c3319145";
export const FLOYD_BLE_CONFIG = "4fafc201-1fb5-459e-8fcc-c5c9c3319146";
export const FLOYD_BLE_TIME = "4fafc201-1fb5-459e-8fcc-c5c9c3319147";
export const FLOYD_BLE_FEEDLOG = "4fafc201-1fb5-459e-8fcc-c5c9c3319148";

export const FLOYD_DEVICE_NAME_PREFIX = "FloydFeeder-";
export const CHUNK_PAYLOAD_MAX = 480;
export const MAX_SCHEDULES = 10;
export const MAX_SCHEDULE_BUFFER_BYTES = 4096;

export const FLOYD_BLE_NOTIFICATION_CHARACTERISTICS = [
  FLOYD_BLE_RESPONSE,
  FLOYD_BLE_TELEMETRY,
  FLOYD_BLE_STATUS,
  FLOYD_BLE_FEEDLOG,
] as const;

export function chipIdFromDeviceName(
  name: string | null | undefined,
): string | null {
  if (!name || !name.startsWith(FLOYD_DEVICE_NAME_PREFIX)) return null;
  const id = name.slice(FLOYD_DEVICE_NAME_PREFIX.length).trim();
  return id.length > 0 ? id : null;
}
