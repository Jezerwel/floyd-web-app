import {
  CHUNK_PAYLOAD_MAX,
  MAX_SCHEDULES,
  MAX_SCHEDULE_BUFFER_BYTES,
} from "./constants";
import { encodeJson } from "./codec";
import type { Schedule } from "./types";

const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const DAY_PATTERN = /^(?:[0-6](?:,[0-6])*)?$/;

export function isScheduleShape(value: unknown): value is Schedule {
  if (!value || typeof value !== "object") return false;
  const schedule = value as Partial<Schedule>;
  return (
    typeof schedule.id === "string" &&
    typeof schedule.label === "string" &&
    typeof schedule.time === "string" &&
    typeof schedule.daysOfWeek === "string" &&
    typeof schedule.augerSpeed === "number" &&
    typeof schedule.impellerSpeed === "number" &&
    typeof schedule.preSpinMs === "number" &&
    typeof schedule.feedMs === "number" &&
    typeof schedule.postSpinMs === "number" &&
    typeof schedule.enabled === "boolean"
  );
}

export function validateSchedule(schedule: Schedule): string[] {
  const errors: string[] = [];
  if (!schedule.id.trim()) errors.push("Schedule id is required.");
  if (!schedule.label.trim()) errors.push("Label is required.");
  if (!TIME_PATTERN.test(schedule.time)) {
    errors.push("Time must use HH:MM in 24-hour time.");
  }
  if (!DAY_PATTERN.test(schedule.daysOfWeek) || !schedule.daysOfWeek) {
    errors.push("Select at least one day.");
  }
  if (!Number.isFinite(schedule.augerSpeed) || schedule.augerSpeed < 0 || schedule.augerSpeed > 1023) {
    errors.push("Auger speed must be between 0 and 1023.");
  }
  if (
    !Number.isFinite(schedule.impellerSpeed) ||
    schedule.impellerSpeed < 0 ||
    schedule.impellerSpeed > 1023
  ) {
    errors.push("Impeller speed must be between 0 and 1023.");
  }
  for (const [name, value] of [
    ["Pre-spin", schedule.preSpinMs],
    ["Feed", schedule.feedMs],
    ["Post-spin", schedule.postSpinMs],
  ] as const) {
    if (!Number.isFinite(value) || value < 0) {
      errors.push(`${name} duration must be a non-negative number.`);
    }
  }
  return errors;
}

export function validateScheduleList(schedules: readonly Schedule[]): string[] {
  const errors: string[] = [];
  if (schedules.length > MAX_SCHEDULES) {
    errors.push(`The feeder supports at most ${MAX_SCHEDULES} schedules.`);
  }
  schedules.forEach((schedule, index) => {
    for (const error of validateSchedule(schedule)) {
      errors.push(`Schedule ${index + 1}: ${error}`);
    }
  });
  return errors;
}

export function daysStringToFlags(value: string): boolean[] {
  const flags = Array.from({ length: 7 }, () => false);
  for (const rawDay of value.split(",")) {
    const day = Number.parseInt(rawDay.trim(), 10);
    if (day >= 0 && day <= 6) flags[day] = true;
  }
  return flags;
}

export function flagsToDaysString(flags: readonly boolean[]): string {
  return flags
    .map((selected, index) => (selected ? String(index) : null))
    .filter((day): day is string => day !== null)
    .join(",");
}

export function formatTimeDisplay(time: string): string {
  if (!TIME_PATTERN.test(time)) return "Not set";
  const [hours, minutes] = time.split(":").map(Number);
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function encodeScheduleChunks(schedules: Schedule[]): Uint8Array[] {
  const validationErrors = validateScheduleList(schedules);
  if (validationErrors.length > 0) {
    throw new RangeError(validationErrors.join(" "));
  }

  const encoded = encodeJson(schedules);
  if (encoded.length > MAX_SCHEDULE_BUFFER_BYTES) {
    throw new RangeError(
      `Schedule JSON is ${encoded.length} bytes; the firmware buffer is ${MAX_SCHEDULE_BUFFER_BYTES} bytes.`,
    );
  }

  const totalChunks = Math.max(1, Math.ceil(encoded.length / CHUNK_PAYLOAD_MAX));
  if (totalChunks > 0xffff) {
    throw new RangeError("Schedule payload has too many chunks.");
  }

  const chunks: Uint8Array[] = [];
  for (let index = 0; index < totalChunks; index += 1) {
    const start = index * CHUNK_PAYLOAD_MAX;
    const payload = encoded.slice(start, start + CHUNK_PAYLOAD_MAX);
    const chunk = new Uint8Array(4 + payload.length);
    const header = new DataView(chunk.buffer);
    header.setUint16(0, index, true);
    header.setUint16(2, totalChunks, true);
    chunk.set(payload, 4);
    chunks.push(chunk);
  }
  return chunks;
}

export interface ScheduleChunk {
  index: number;
  total: number;
  payload: Uint8Array;
}

/** Splits one schedule read/write page: uint16 LE index, uint16 LE total, JSON bytes. */
export function decodeScheduleChunk(bytes: Uint8Array): ScheduleChunk | null {
  if (bytes.length < 4) return null;
  const header = new DataView(bytes.buffer, bytes.byteOffset, 4);
  const index = header.getUint16(0, true);
  const total = header.getUint16(2, true);
  if (total === 0 || index >= total) return null;
  return { index, total, payload: bytes.slice(4) };
}

export function joinScheduleChunks(chunks: readonly ScheduleChunk[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.payload.length, 0);
  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk.payload, offset);
    offset += chunk.payload.length;
  }
  return joined;
}
