import type {
  CommandEnvelope,
  CommandAction,
  DeviceMessage,
  DeviceMessageData,
} from "./types";

export function createCommandEnvelope(
  action: CommandAction | string,
  parameters?: Record<string, unknown>,
  now: number = Date.now(),
): CommandEnvelope {
  if (parameters === undefined) {
    return { action, timestamp: now };
  }
  return { action, parameters, timestamp: now };
}

export function encodeJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function asBytes(value: Uint8Array | ArrayBuffer | DataView | string): Uint8Array {
  if (typeof value === "string") return new TextEncoder().encode(value);
  if (value instanceof DataView) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  if (value instanceof Uint8Array) return value;
  return new Uint8Array(value);
}

function isMessageData(value: unknown): value is DeviceMessageData {
  return Array.isArray(value) || (!!value && typeof value === "object");
}

export function parseDeviceMessage(
  value: Uint8Array | ArrayBuffer | DataView | string,
  now: number = Date.now(),
): DeviceMessage | null {
  try {
    const raw = JSON.parse(new TextDecoder().decode(asBytes(value))) as unknown;
    if (!raw || typeof raw !== "object") return null;
    const record = raw as Record<string, unknown>;
    if (typeof record.type !== "string") return null;
    return {
      type: record.type,
      data: isMessageData(record.data) ? record.data : {},
      timestamp: typeof record.timestamp === "number" ? record.timestamp : now,
    };
  } catch {
    return null;
  }
}

export function encodeUnixSeconds(seconds: number): Uint8Array {
  const buffer = new ArrayBuffer(4);
  new DataView(buffer).setUint32(0, Math.trunc(seconds) >>> 0, true);
  return new Uint8Array(buffer);
}

/**
 * Time sync payload: uint32 LE Unix seconds, then (optional) int16 LE UTC offset in
 * minutes east of UTC. The offset lets the feeder run "HH:MM" schedules in local time.
 */
export function encodeTimeSync(seconds: number, utcOffsetMinutes?: number): Uint8Array {
  const unix = encodeUnixSeconds(seconds);
  if (utcOffsetMinutes === undefined) return unix;
  const bytes = new Uint8Array(6);
  bytes.set(unix, 0);
  new DataView(bytes.buffer).setInt16(4, Math.trunc(utcOffsetMinutes), true);
  return bytes;
}

export function decodeUtf8Json(value: DataView | Uint8Array | ArrayBuffer): unknown {
  const bytes =
    value instanceof DataView
      ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
      : value instanceof Uint8Array
        ? value
        : new Uint8Array(value);
  return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}
