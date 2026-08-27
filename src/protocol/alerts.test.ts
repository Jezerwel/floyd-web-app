import { describe, expect, it } from "vitest";
import { generateAlerts } from "./alerts";
import type { DeviceData } from "./types";

const connectedData = (overrides: Partial<DeviceData> = {}): DeviceData => ({
  foodLevelPercentage: 25,
  temperature: 24,
  temperatureSensorConnected: true,
  ultrasonicSensorConnected: true,
  ...overrides,
});

describe("generateAlerts", () => {
  it("returns no alerts while the transport is disconnected", () => {
    expect(generateAlerts(connectedData({ foodLevelPercentage: 5 }), false)).toEqual(
      [],
    );
  });

  it("uses critical food severity before the low-food threshold", () => {
    const alerts = generateAlerts(
      connectedData({ foodLevelPercentage: 5 }),
      true,
      new Date("2026-08-27T10:00:00.000Z"),
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      id: "critical_food",
      type: "CRITICAL_FOOD",
      severity: "HIGH",
      triggerValue: 5,
    });
  });

  it("reports temperature and sensor warnings together", () => {
    const alerts = generateAlerts(
      connectedData({
        foodLevelPercentage: 20,
        temperature: 35,
        temperatureSensorConnected: true,
        ultrasonicSensorConnected: false,
      }),
      true,
      new Date("2026-08-27T10:00:00.000Z"),
    );
    expect(alerts.map((alert) => alert.id)).toEqual([
      "temp_high",
      "ultrasonic_sensor_disconnected",
    ]);
    expect(alerts[0].message).toContain("35.0 C");
  });

  it("reports a low-food warning when the level sensor is connected", () => {
    const alerts = generateAlerts(
      connectedData({ foodLevelPercentage: 20 }),
      true,
      new Date("2026-08-27T10:00:00.000Z"),
    );
    expect(alerts[0]).toMatchObject({
      id: "low_food",
      severity: "MEDIUM",
      triggerValue: 20,
    });
  });

  it("ignores values outside the supported sensor ranges", () => {
    const alerts = generateAlerts(
      connectedData({ foodLevelPercentage: 120, temperature: 200 }),
      true,
      new Date("2026-08-27T10:00:00.000Z"),
    );
    expect(alerts).toEqual([]);
  });
});
