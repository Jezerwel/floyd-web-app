import { describe, expect, it } from "vitest";
import {
  CHUNK_PAYLOAD_MAX,
  FLOYD_BLE_COMMAND,
  FLOYD_BLE_CONFIG,
  FLOYD_BLE_FEEDLOG,
  FLOYD_BLE_RESPONSE,
  FLOYD_BLE_SCHEDULES,
  FLOYD_BLE_SERVICE,
  FLOYD_BLE_STATUS,
  FLOYD_BLE_TELEMETRY,
  FLOYD_BLE_TIME,
  MAX_SCHEDULES,
  MAX_SCHEDULE_BUFFER_BYTES,
  chipIdFromDeviceName,
  createCommandEnvelope,
  daysStringToFlags,
  encodeScheduleChunks,
  encodeUnixSeconds,
  flagsToDaysString,
  parseDeviceMessage,
  validateSchedule,
} from "./index";
import type { Schedule } from "./types";

const baseSchedule = (overrides: Partial<Schedule> = {}): Schedule => ({
  id: "morning",
  label: "Morning feed",
  time: "08:30",
  daysOfWeek: "1,2,3,4,5",
  augerSpeed: 768,
  impellerSpeed: 1023,
  preSpinMs: 1500,
  feedMs: 3000,
  postSpinMs: 1500,
  enabled: true,
  ...overrides,
});

describe("Floyd BLE protocol", () => {
  it("keeps the service and characteristic UUID contract", () => {
    expect(FLOYD_BLE_SERVICE).toBe("4fafc201-1fb5-459e-8fcc-c5c9c331914b");
    expect(FLOYD_BLE_COMMAND.endsWith("9141")).toBe(true);
    expect(FLOYD_BLE_RESPONSE.endsWith("9142")).toBe(true);
    expect(FLOYD_BLE_TELEMETRY.endsWith("9143")).toBe(true);
    expect(FLOYD_BLE_STATUS.endsWith("9144")).toBe(true);
    expect(FLOYD_BLE_SCHEDULES.endsWith("9145")).toBe(true);
    expect(FLOYD_BLE_CONFIG.endsWith("9146")).toBe(true);
    expect(FLOYD_BLE_TIME.endsWith("9147")).toBe(true);
    expect(FLOYD_BLE_FEEDLOG.endsWith("9148")).toBe(true);
  });

  it("extracts a chip id only from a Floyd feeder name", () => {
    expect(chipIdFromDeviceName("FloydFeeder-A1B2")).toBe("A1B2");
    expect(chipIdFromDeviceName("  FloydFeeder-A1B2")).toBeNull();
    expect(chipIdFromDeviceName("Other-A1B2")).toBeNull();
    expect(chipIdFromDeviceName("FloydFeeder-")).toBeNull();
    expect(chipIdFromDeviceName(undefined)).toBeNull();
  });

  it("creates the command envelope with an optional parameter object", () => {
    expect(createCommandEnvelope("ping", undefined, 1234)).toEqual({
      action: "ping",
      timestamp: 1234,
    });
    expect(createCommandEnvelope("start_feed", { feedMs: 3000 }, 1234)).toEqual({
      action: "start_feed",
      parameters: { feedMs: 3000 },
      timestamp: 1234,
    });
  });

  it("parses UTF-8 device messages and rejects malformed envelopes", () => {
    const encoded = new TextEncoder().encode(
      JSON.stringify({ type: "sensor_data", data: { label: "🐟" }, timestamp: 88 }),
    );
    expect(parseDeviceMessage(encoded)).toEqual({
      type: "sensor_data",
      data: { label: "🐟" },
      timestamp: 88,
    });
    expect(parseDeviceMessage('{"data":{}}')).toBeNull();
    expect(parseDeviceMessage("not json")).toBeNull();
    expect(parseDeviceMessage('{"type":3,"data":{}}')).toBeNull();
  });

  it("encodes Unix seconds as an unsigned little-endian uint32", () => {
    expect([...encodeUnixSeconds(0x12345678)]).toEqual([0x78, 0x56, 0x34, 0x12]);
  });

  it("frames multibyte schedule JSON into 480-byte UTF-8 chunks", () => {
    const schedules = [baseSchedule({ label: "🐟".repeat(200) })];
    const chunks = encodeScheduleChunks(schedules);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.length <= CHUNK_PAYLOAD_MAX + 4)).toBe(true);

    const payload = new Uint8Array(
      chunks.reduce((size, chunk) => size + chunk.length - 4, 0),
    );
    let offset = 0;
    for (const chunk of chunks) {
      payload.set(chunk.slice(4), offset);
      offset += chunk.length - 4;
    }
    expect(JSON.parse(new TextDecoder().decode(payload))).toEqual(schedules);

    const firstHeader = new DataView(chunks[0].buffer, chunks[0].byteOffset, 4);
    expect(firstHeader.getUint16(0, true)).toBe(0);
    expect(firstHeader.getUint16(2, true)).toBe(chunks.length);
  });

  it("accepts the firmware schedule count boundary and rejects overflow", () => {
    const ten = Array.from({ length: MAX_SCHEDULES }, (_, index) =>
      baseSchedule({ id: `schedule-${index}` }),
    );
    expect(() => encodeScheduleChunks(ten)).not.toThrow();
    expect(() =>
      encodeScheduleChunks([...ten, baseSchedule({ id: "overflow" })]),
    ).toThrow(/10 schedules/);
  });

  it("rejects JSON larger than the firmware schedule buffer", () => {
    const oversized = [baseSchedule({ label: "x".repeat(MAX_SCHEDULE_BUFFER_BYTES) })];
    expect(() => encodeScheduleChunks(oversized)).toThrow(/4096/);
  });

  it("validates schedule fields and converts weekday flags", () => {
    expect(validateSchedule(baseSchedule())).toEqual([]);
    expect(
      validateSchedule(
        baseSchedule({ label: " ", time: "25:99", daysOfWeek: "", augerSpeed: 2000 }),
      ),
    ).toEqual([
      "Label is required.",
      "Time must use HH:MM in 24-hour time.",
      "Select at least one day.",
      "Auger speed must be between 0 and 1023.",
    ]);
    expect(daysStringToFlags("0,2,6")).toEqual([
      true,
      false,
      true,
      false,
      false,
      false,
      true,
    ]);
    expect(flagsToDaysString([true, false, true, false, false, false, true])).toBe(
      "0,2,6",
    );
  });
});
