import type { Alert, DeviceData } from "./types";

export const DEFAULT_THRESHOLDS = {
  LOW_FOOD: 30,
  CRITICAL_FOOD: 10,
  TEMP_MIN: 20,
  TEMP_MAX: 32,
} as const;

const SENSOR_RANGES = {
  TEMPERATURE: { min: -40, max: 85 },
  FOOD_LEVEL: { min: 0, max: 100 },
} as const;

function isInRange(value: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(value) && value >= range.min && value <= range.max;
}

export function generateAlerts(
  deviceData: DeviceData,
  connected: boolean,
  now: Date = new Date(),
): Alert[] {
  if (!connected) return [];

  const timestamp = now.toLocaleString();
  const alerts: Alert[] = [];
  const foodLevel = deviceData.foodLevelPercentage;
  if (
    deviceData.ultrasonicSensorConnected &&
    foodLevel !== undefined &&
    isInRange(foodLevel, SENSOR_RANGES.FOOD_LEVEL)
  ) {
    if (foodLevel <= DEFAULT_THRESHOLDS.CRITICAL_FOOD) {
      alerts.push({
        id: "critical_food",
        type: "CRITICAL_FOOD",
        message: `Critical food level at ${foodLevel.toFixed(1)}%. Immediate refill required!`,
        timestamp,
        severity: "HIGH",
        isResolved: false,
        triggerValue: foodLevel,
      });
    } else if (foodLevel <= DEFAULT_THRESHOLDS.LOW_FOOD) {
      alerts.push({
        id: "low_food",
        type: "LOW_FOOD",
        message: `Food level dropped to ${foodLevel.toFixed(1)}%. Consider refilling soon.`,
        timestamp,
        severity: "MEDIUM",
        isResolved: false,
        triggerValue: foodLevel,
      });
    }
  }

  const temperature = deviceData.temperature;
  if (
    deviceData.temperatureSensorConnected &&
    temperature !== undefined &&
    isInRange(temperature, SENSOR_RANGES.TEMPERATURE)
  ) {
    if (temperature > DEFAULT_THRESHOLDS.TEMP_MAX) {
      alerts.push({
        id: "temp_high",
        type: "TEMPERATURE_HIGH",
        message: `Water temperature is high at ${temperature.toFixed(1)} C. Check cooling system.`,
        timestamp,
        severity: "MEDIUM",
        isResolved: false,
        triggerValue: temperature,
      });
    } else if (temperature < DEFAULT_THRESHOLDS.TEMP_MIN) {
      alerts.push({
        id: "temp_low",
        type: "TEMPERATURE_LOW",
        message: `Water temperature is low at ${temperature.toFixed(1)} C. Check heating system.`,
        timestamp,
        severity: "MEDIUM",
        isResolved: false,
        triggerValue: temperature,
      });
    }
  }

  if (deviceData.temperatureSensorConnected === false) {
    alerts.push({
      id: "temp_sensor_disconnected",
      type: "SENSOR_DISCONNECTED",
      message: "Temperature sensor disconnected. Check wiring and connections.",
      timestamp,
      severity: "LOW",
      isResolved: false,
    });
  }
  if (deviceData.ultrasonicSensorConnected === false) {
    alerts.push({
      id: "ultrasonic_sensor_disconnected",
      type: "SENSOR_DISCONNECTED",
      message: "Ultrasonic sensor disconnected. Food level monitoring unavailable.",
      timestamp,
      severity: "LOW",
      isResolved: false,
    });
  }
  return alerts;
}

export function getRelativeTime(timestamp: string, now: Date = new Date()): string {
  const diffMinutes = Math.floor(
    (now.getTime() - new Date(timestamp).getTime()) / 60000,
  );
  if (diffMinutes < 1) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? "" : "s"} ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
}
