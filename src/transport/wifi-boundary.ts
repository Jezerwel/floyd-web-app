import { Capacitor } from "@capacitor/core";
import type { WebBluetoothTransportOptions } from "./web-bluetooth";
import { WebBluetoothTransport } from "./web-bluetooth";
import type { FeederTransport } from "./transport";
import { nativeBluetooth } from "./native-bluetooth";

export interface WifiAvailability {
  available: false;
  reason: string;
}

const WIFI_UNAVAILABLE_REASON =
  "Wi-Fi is unavailable: the checked-in firmware exposes raw MQTT only. A documented browser-safe HTTP/WebSocket API, CORS, no-store responses, provisioning, and an approved HTTPS/WSS strategy are required before enabling it.";

export function getWifiAvailability(): WifiAvailability {
  return { available: false, reason: WIFI_UNAVAILABLE_REASON };
}

export function createDefaultTransport(
  options: WebBluetoothTransportOptions = {},
): FeederTransport {
  if (Capacitor.getPlatform() === "ios" && Capacitor.isNativePlatform()) {
    return new WebBluetoothTransport({ bluetooth: nativeBluetooth, secureContext: true, ...options });
  }
  return new WebBluetoothTransport(options);
}
