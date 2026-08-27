# Floyd Web PWA Migration Design

## Scope

Build an independent React/Vite/TypeScript browser application in `floyd-web-app`. Do not modify `floyd-app` or `ESP32_MQTT_Server.ino`; preserve the existing BLE UUIDs, JSON command envelope, schedule chunk framing, and device message shapes.

The web target provides dashboard, controls, schedules, logs, connection recovery, and an explicit provisioning limitation. Chromium Web Bluetooth is the active transport. iOS Safari/Chrome and browsers without Web Bluetooth receive a clear unsupported message. The current firmware's raw MQTT SoftAP is not presented as a working browser transport.

## Transport boundary

`FeederTransport` owns connection, characteristic access, notifications, command writes, schedule reads/writes, and time sync. `WebBluetoothTransport` implements it with a user-initiated `requestDevice()` call filtered to the Floyd service and device name prefix. It discovers the existing service and response, telemetry, status, schedules, time, and feed-log characteristics. It subscribes to notifications and maps UTF-8 JSON to typed device messages.

The transport reports unsupported API, insecure context, chooser cancellation, permission, and GATT failures as structured errors. It never exposes an RSSI/distance estimate because Web Bluetooth does not provide the native scan list/RSSI contract. Unexpected GATT disconnects are emitted to the store; the store attempts up to three reconnects within roughly 30 seconds using previously granted devices when the browser exposes `getDevices()`. Manual disconnect cancels recovery.

No Wi-Fi transport is implemented in this migration. The checked-in firmware has no browser-safe HTTP/WebSocket endpoint or stable browser-facing message contract; inventing one would make the PWA claim support it cannot provide. The transport interface remains the seam for a later adapter after firmware exposes and documents HTTP/WebSocket behavior, CORS, no-store responses, provisioning, and an approved HTTPS/WSS strategy.

## Protocol and data

Pure modules contain BLE UUIDs, device-name parsing, command envelope creation, UTF-8 message parsing, little-endian Unix time encoding, 480-byte schedule chunk encoding, schedule types/validation, sensor ranges, and alert rules. Schedule validation enforces a non-empty trimmed label, a valid `HH:MM` time, at least one day, finite speed/duration values, and the ten-schedule firmware limit. JSON larger than the 4096-byte firmware schedule buffer is rejected before a write.

The browser store is an external store consumed with `useSyncExternalStore`; React components do not call `useEffect`. It owns connection state, reconnect timers, transport subscriptions, sensor/feed journal updates, command errors, and auto-refresh. Feed logs are restored from local storage on store creation and persisted after every update. Sensor logs remain bounded in memory. Only the feeder chip ID and feed logs are persisted; Wi-Fi credentials are never accepted or written to storage or the service-worker cache.

## UI

Use a responsive application shell with a normal fixed-width sidebar on wide screens and a compact bottom navigation on small screens. Routes are hash-based (`dashboard`, `controls`, `schedule`, `logs`) so the app needs no routing dependency. Use semantic headings, native buttons/inputs, visible focus rings, inline validation, keyboard-operable dialogs, stable live regions for transport status/errors, and a skip link.

Dashboard mirrors the mobile surface: connection state, last-known/live sensor values, motor state, capacity, alerts, and recent feed activity. Controls expose 0–100% auger/impeller steppers, 0–30 second duration, FEED, STOP, and CLEAR JAM. Speeds are converted with `Math.round(value * 10.23)`. Schedules support add/edit/delete, enable/disable, time, weekdays, and sync. Logs expose bounded sensor readings, derived alerts, feed history, clear-sensor action, and full section views through the same shell.

The connection panel owns the connect/retry/disconnect/forget actions and states that browser chooser selection replaces the native scan list. A provisioning panel explains that the current firmware's open SoftAP/raw MQTT mode cannot be used by a browser and that the browser-safe HTTP/WebSocket firmware extension is still required. It does not collect or persist Wi-Fi credentials and does not pretend that `restart_provisioning` completes browser provisioning.

## PWA packaging

Use a hand-written same-origin service worker in `public/sw.js`. Cache only the app shell/static assets and never cache device/API responses, credentials, or cross-origin resources. Add a manifest with standalone display, theme/background colors, and local icons generated as simple SVG assets. Register the worker from the app entry point without React effects.

## Verification

Vitest covers protocol framing, validation, alert thresholds, local persistence, unsupported/secure-context BLE, chooser cancellation, GATT notifications, command failures, disconnect/reconnect limits, and the provisioning panel's non-persistence guarantee. Browser smoke coverage checks the manifest, service-worker scope, keyboard navigation, unsupported-BLE messaging, and route actions. `npm run build`, `npm run test`, and `npm run lint` are runnable from `floyd-web-app`. Real-device evidence remains separate and is not claimed without Chrome desktop or Android Chrome hardware testing; iOS BLE remains unsupported.
