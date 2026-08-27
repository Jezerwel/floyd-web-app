# Browser Wi-Fi boundary

The PWA does not implement a Wi-Fi adapter yet. The checked-in ESP32 firmware exposes an open SoftAP with a raw MQTT broker on TCP port 1883, not a browser-safe HTTP/WebSocket API. A browser cannot use that MQTT socket directly, and an HTTPS-installed PWA cannot depend on insecure `http://` or `ws://` device URLs.

A later transport can be enabled only after the firmware documents and implements:

- HTTP/WebSocket endpoints for status, commands, schedules, telemetry, responses, time, and errors.
- CORS policy and `Cache-Control: no-store` on device data.
- Station/AP provisioning with a defined credential transfer path that does not persist credentials in the browser or service-worker cache.
- HTTPS/WSS on the device with a trusted certificate strategy, or an explicitly approved trusted local relay.
- A stable JSON message and error contract that preserves the existing BLE command envelope where practical.

Until those prerequisites exist, iOS Safari/Chrome and unsupported Chromium browsers receive an explanatory unsupported message. The UI does not collect Wi-Fi credentials and never calls `restart_provisioning`, because the current command drops BLE into the incompatible raw-MQTT SoftAP.
