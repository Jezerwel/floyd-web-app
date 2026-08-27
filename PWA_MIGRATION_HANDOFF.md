# Floyd Web PWA Migration Handoff

Date: 2026-08-27

## Next-session focus

Build a pure browser PWA in `C:/Users/Acer/Desktop/FEEDER/floyd-web-app` while keeping the existing Expo mobile app and ESP32 BLE contract working. The implementation is paused until the browser/firmware and iOS tradeoffs below are explicitly accepted.

## Repository state

- `C:/Users/Acer/Desktop/FEEDER/floyd-app` is the existing Expo/React Native app on branch `local-connection`, HEAD `12b58d9`.
- The mobile checkout has one pre-existing edit: `.vscode/settings.json`. Preserve it.
- `C:/Users/Acer/Desktop/FEEDER/floyd-web-app` was empty apart from `.git`; this handoff is its first file.
- No mobile source or firmware files were changed during the audit.

## Current mobile app

- Expo SDK 55, React Native 0.83, React 19, TypeScript, Metro, and Expo Router.
- Root Stack routes: `(tabs)`, `logs-more`, and `+not-found`.
- Tabs: Dashboard, Controls, Logs, and Schedule.
- State is React Context plus local hooks; there is no Redux or other state library.
- AsyncStorage is used for `floydChipId` and attempted feed-log persistence. The chip ID is loaded, but feed logs are not loaded on startup, so history is not reliably restored.
- There is no authentication, cloud API, user account, token, or server.
- `package.json` has `lint` and `web` scripts but no `test` or production `build` script.
- `node_modules` is absent. Baseline results: lint cannot find Expo, TypeScript is unavailable, and test/build scripts are missing.

## Existing screens and flows

- Dashboard shows the BLE connection card, motor status, food capacity, temperature, alerts, refresh, and links to expanded logs.
- Controls expose auger and impeller speed steppers, a 0–30 second feed duration, FEED, STOP, and CLEAR JAM. Percentage speeds become PWM values with `Math.round(value * 10.23)`.
- Schedule reads and writes the complete schedule list over BLE. It supports add, edit, delete, enable/disable, time selection, and weekday selection.
- Logs shows in-memory sensor readings, derived alerts, and collapsed feed history. Sensor logs can be cleared.
- `logs-more` displays full sensor, alert, or feed history based on a route parameter.
- `+not-found` is the standard Expo Router 404 screen.
- The current app does not have the provisioning route described by older documentation.

## BLE contract

Service UUID: `4fafc201-1fb5-459e-8fcc-c5c9c331914b`

| Characteristic | UUID suffix | Properties | Contract |
|---|---:|---|---|
| Command | `9141` | WRITE | JSON command envelope |
| Response | `9142` | NOTIFY | Command responses and errors |
| Telemetry | `9143` | NOTIFY | Sensor and motor updates |
| Status | `9144` | READ, NOTIFY | Device status |
| Schedules | `9145` | READ, WRITE | JSON list or chunked JSON writes |
| Config | `9146` | READ, WRITE | Geometry and sensor interval |
| Time | `9147` | WRITE | Four-byte little-endian Unix seconds |
| Feed log | `9148` | NOTIFY | Feed completion response |

Devices advertise as `FloydFeeder-{chipId}`. Existing command actions are `start_feed`, `stop_feed`, `clear_jam`, `get_sensors`, `set_sensor_interval`, `set_config`, `ping`, `get_schedules`, `set_schedules`, `switch_mode`, and `restart_provisioning`.

Commands use `{ action, parameters?, timestamp }`. `start_feed` accepts `augerSpeed`, `impellerSpeed`, `preSpinMs`, `feedMs`, and `postSpinMs`; `clear_jam` accepts `speed` and `duration`; schedule sync uses `parameters.schedules`.

Schedule writes prepend a four-byte little-endian chunk index and total count, followed by up to 480 bytes of UTF-8 JSON. The firmware buffer is 4096 bytes and stores at most 10 schedules.

Native reconnect behavior is two connection attempts with a 10-second timeout, service discovery, best-effort MTU 512, notification subscriptions, and up to three automatic reconnect scans over roughly 30 seconds after an unexpected disconnect. Manual disconnect returns to idle.

## Actual Wi-Fi behavior

The checked-in `ESP32_MQTT_Server.ino` has no HTTP server, WebSocket endpoint, CORS handling, or station-mode `WiFi.begin()` flow.

- Default mode disables Wi-Fi and starts BLE.
- AP mode starts an open `FloydFeeder-{chipId}` SoftAP and an embedded MQTT broker on raw TCP port 1883.
- MQTT topics are `floyd/devices/{chipId}/command`, `/telemetry`, `/status`, and `/response`.
- AP mode reboots to BLE after five minutes without MQTT traffic.
- The mobile app currently has no HTTP, WebSocket, or MQTT implementation; `useScheduleMQTT` is BLE-backed despite its name.

The older README and planning documents describe WiFiManager, mDNS, and home-Wi-Fi behavior that the current firmware does not implement. A browser cannot use the current raw MQTT TCP broker.

## Browser and native boundary

Native-only surfaces that must be replaced in the PWA include `react-native-ble-plx`, `react-native-quick-base64`, the React Native date picker, Android permissions, AppState, Linking, native animations, native haptics, and AsyncStorage.

Web Bluetooth requires a secure context and a user-initiated permission chooser. It does not provide the native continuous scan list or RSSI-based distance display, so the web connection UI must use the browser chooser and label signal distance as unavailable. MDN marks Web Bluetooth as limited availability: https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API

WebKit on iOS does not implement Web Bluetooth. Safari and Chrome on iOS therefore cannot perform BLE discovery, provisioning, or BLE recovery; they can only use a future browser-safe Wi-Fi path. Reference: https://bugs.webkit.org/show_bug.cgi?id=238049

## Proposed migration boundary

1. Keep `floyd-app` and the existing BLE UUIDs/JSON commands unchanged until web parity is verified.
2. Create an independent React/Vite/TypeScript PWA in `floyd-web-app` with a manifest and hand-written service worker. Cache only same-origin shell/static assets.
3. Reuse the pure protocol constants, schedule types, validation, alert rules, and command envelopes; do not import React Native hooks into the web bundle.
4. Use Web Bluetooth for supported Chromium browsers, with feature detection, secure-context checks, user activation, existing GATT characteristics, and explicit unsupported-browser messaging.
5. Add a browser Wi-Fi adapter only after firmware exposes a browser-safe HTTP/WebSocket API.

## Firmware change required for full Wi-Fi parity

This change is required by the requested browser architecture and has not been applied:

- Add HTTP/WebSocket transport for status, commands, schedules, telemetry, responses, time, and errors.
- Add CORS and `Cache-Control: no-store` for device data.
- Add Wi-Fi station/AP provisioning, likely through a BLE config extension carrying credentials directly to the ESP32; never persist credentials in the browser or service-worker cache.
- Preserve the existing BLE service and command envelope.
- Resolve the HTTPS/WSS boundary: an HTTPS-installed PWA cannot depend on insecure `http://` or `ws://` device URLs in production. The options are ESP32 HTTPS/WSS with a trusted certificate strategy or an explicitly approved trusted local relay.

## Verification still required

- Install dependencies, then run mobile lint/type/build checks without altering the mobile target.
- Add web unit and browser tests for supported/unsupported BLE, connection/disconnection/reconnect, provisioning, command errors, Wi-Fi timeout/offline/invalid-response/reconnect, manifest, and service-worker scope.
- Run browser tests in supported Chromium and an unsupported-BLE environment.
- Test the real ESP32 on Chrome desktop or Android Chrome. No hardware support should be claimed before that test.
- Report automated, browser, and real-hardware evidence separately, including the iOS BLE limitation.

## Approval gate

Before implementation, confirm this direction: pure PWA, Web Bluetooth on supported Chromium, Wi-Fi-only fallback on iOS, no native wrapper, and the documented ESP32 HTTP/WSS firmware extension.

## Suggested skills

- `brainstorming` — confirm the transport and iOS tradeoff before implementation.
- `writing-plans` — produce the approved multi-phase implementation plan.
- `test-driven-development` — add failing protocol/transport tests before implementation.
- `no-use-effect` — keep new React code free of direct `useEffect` usage.
- `verification-before-completion` — require runnable checks before claiming completion.
- `using-git-worktrees` — isolate implementation if the user requests parallel or branch-based work.
- `ponytail:ponytail` — keep the new target minimal and avoid speculative abstractions.
