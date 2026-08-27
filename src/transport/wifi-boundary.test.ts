import { describe, expect, it } from "vitest";
import { createDefaultTransport, getWifiAvailability } from "./wifi-boundary";

describe("Wi-Fi transport boundary", () => {
  it("keeps the default browser transport on Web Bluetooth", () => {
    const transport = createDefaultTransport({ bluetooth: undefined, secureContext: true });
    expect(transport.kind).toBe("bluetooth");
    expect(transport.support.available).toBe(false);
  });

  it("reports Wi-Fi as unavailable until firmware exposes a browser API", () => {
    const availability = getWifiAvailability();
    expect(availability).toEqual({
      available: false,
      reason: expect.stringContaining("raw MQTT"),
    });
    expect(availability.reason).toContain("HTTP/WebSocket");
  });

  it("does not expose a credential-bearing provisioning surface", () => {
    const availability = getWifiAvailability();
    expect(Object.keys(availability)).toEqual(["available", "reason"]);
    expect(JSON.stringify(availability)).not.toMatch(/password|ssid|credential/i);
  });
});
