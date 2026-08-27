# Floyd Web PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone, installable React/Vite/TypeScript PWA that controls the existing Floyd feeder over Web Bluetooth, preserves the BLE contract, and clearly gates unsupported browser/iOS and not-yet-implemented Wi-Fi paths.

**Architecture:** Pure protocol modules define UUIDs, command envelopes, message parsing, schedule framing/validation, and alert rules. An injected `FeederTransport` interface separates the `WebBluetoothTransport` from the future Wi-Fi seam and a single external `FeederStore`; React reads that store with `useSyncExternalStore` and never calls `useEffect`. A hash-routed responsive shell renders dashboard, controls, schedules, logs, and connection/provisioning states.

**Tech Stack:** React 19, TypeScript 5.9, Vite 7, Vitest, jsdom, Playwright, ESLint 9, Web Bluetooth API, localStorage, hand-written service worker.

**Spec:** `docs/superpowers/specs/2026-08-27-floyd-web-pwa-design.md`

## Global Constraints

- Keep `floyd-app` and `floyd-app/ESP32_MQTT_Server.ino` unchanged.
- Preserve service UUID `4fafc201-1fb5-459e-8fcc-c5c9c331914b`, characteristic suffixes `9141`–`9148`, JSON command envelopes, and four-byte little-endian time writes.
- Use the Web Bluetooth chooser only from a user-initiated action; do not recreate native scan/RSSI UI or claim distance on web.
- Never call `useEffect` directly in React components; use `useSyncExternalStore`, event handlers, derived values, or module-level browser registration.
- Persist only `floydChipId` and feed logs; never persist Wi-Fi credentials or cache device/API responses in the service worker.
- Reject schedule payloads exceeding ten schedules or the firmware's 4096-byte JSON buffer before writing chunks of at most 480 UTF-8 bytes.
- Do not implement or advertise a Wi-Fi adapter until firmware exposes and documents a browser-safe HTTP/WebSocket API, CORS/no-store behavior, provisioning, and an approved HTTPS/WSS strategy.
- Use native semantic controls, visible `:focus-visible` states, keyboard-operable dialogs, inline validation, and stable live regions for status/error updates.

---

### Task 1: Create Vite React PWA toolchain

**Files:**
- Create: `package.json`
- Create: `package-lock.json` via `npm install`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `eslint.config.js`
- Create: `.gitignore`
- Create: `index.html`

**Interfaces:**
- Produces `npm run dev`, `npm run build`, `npm run preview`, `npm run test`, `npm run test:browser`, and `npm run lint` scripts.
- Produces Vite aliases for `@` → `src` and Vitest jsdom configuration for `src/**/*.test.ts` and `src/**/*.test.tsx`.

- [ ] **Step 1: Add package metadata and scripts**

```json
{
  "name": "floyd-web-app",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:browser": "playwright test",
    "lint": "eslint ."
  }
}
```

Add React/ReactDOM runtime dependencies and Vite, TypeScript, Vitest, jsdom, Testing Library, Playwright, ESLint 9, `@eslint/js`, `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`, `@vitejs/plugin-react`, `globals`, and the React type packages as development dependencies. Run `npm install` to create the lockfile.

- [ ] **Step 2: Configure strict TypeScript, Vite, Vitest, and ESLint**

Use strict TypeScript with `noEmit`, DOM/WebWorker libs, JSX `react-jsx`, and `@/*` path mapping. Configure Vite's React plugin and `resolve.alias`. Configure Vitest with the Vite config, `environment: "jsdom"`, `setupFiles: ["src/test/setup.ts"]`, and source test globs. Configure ESLint 9 flat config for TypeScript/TSX, React hooks, React refresh, browser globals, and ignored build output. Do not add a rule that permits direct `useEffect` calls.

- [ ] **Step 3: Add the HTML shell**

Create a viewport that does not cap zoom, a manifest link to `/manifest.webmanifest`, theme-color metadata, an accessible page title, and `<div id="root"></div>` with `/src/main.tsx` as the module entry.

- [ ] **Step 4: Run the toolchain smoke commands**

Run `npm run build`, `npm run test`, and `npm run lint` after the source files from later tasks exist. A test command that reports no tests is an environment gap, not a passing suite.

---

### Task 2: Implement pure BLE protocol helpers

**Files:**
- Create: `src/protocol/constants.ts`
- Create: `src/protocol/types.ts`
- Create: `src/protocol/codec.ts`
- Create: `src/protocol/schedules.ts`
- Create: `src/protocol/alerts.ts`
- Create: `src/protocol/index.ts`
- Test: `src/protocol/protocol.test.ts`
- Test: `src/protocol/alerts.test.ts`
- Create: `src/test/setup.ts`

**Interfaces:**
- `src/protocol/constants.ts` exports all `FLOYD_BLE_*` UUID constants, `FLOYD_DEVICE_NAME_PREFIX`, `CHUNK_PAYLOAD_MAX`, `MAX_SCHEDULES`, and `MAX_SCHEDULE_BUFFER_BYTES`.
- `chipIdFromDeviceName(name: string | null | undefined): string | null` extracts only non-empty `FloydFeeder-` suffixes.
- `createCommandEnvelope(action: CommandAction | string, parameters?: Record<string, unknown>, now?: number): CommandEnvelope` returns `{ action, parameters?, timestamp }`.
- `parseDeviceMessage(value: Uint8Array | ArrayBuffer | string, now?: number): DeviceMessage | null` decodes UTF-8 JSON and requires a string `type`.
- `encodeUnixSeconds(seconds: number): Uint8Array` emits four-byte little-endian unsigned seconds.
- `encodeScheduleChunks(schedules: Schedule[]): Uint8Array[]` validates the list, serializes UTF-8 JSON, prepends little-endian `uint16` chunk index/total, and rejects firmware-size violations.
- `validateSchedule(schedule: Schedule): string[]`, `daysStringToFlags(value: string): boolean[]`, `flagsToDaysString(flags: readonly boolean[]): string`, and `formatTimeDisplay(time: string): string` are pure schedule helpers.
- `generateAlerts(deviceData: DeviceData, connected: boolean, now?: Date): Alert[]` mirrors the mobile thresholds/ranges with deterministic injectable time.

- [ ] **Step 1: Write protocol RED tests**

Cover exact UUID/name parsing, command timestamps and optional parameters, invalid/unknown JSON messages returning `null`, four-byte little-endian time encoding, multibyte UTF-8 chunk boundaries, schedule chunk headers, empty/ten-schedule acceptance, eleven-schedule rejection, 4096-byte rejection, invalid schedule fields, weekday conversion, food/temperature threshold precedence, disconnected sensors, and disconnected transport producing no alerts.

- [ ] **Step 2: Run protocol tests and verify expected RED failures**

Run `npm run test -- src/protocol/protocol.test.ts src/protocol/alerts.test.ts`. The failures must identify missing protocol exports/behavior rather than test syntax or environment errors.

- [ ] **Step 3: Implement the smallest pure protocol modules**

Copy only the existing contract values and rules into typed, browser-neutral modules. Keep alert timestamps injectable, avoid `any`, validate finite numeric values, and use `TextEncoder`/`TextDecoder` for byte-accurate framing.

- [ ] **Step 4: Run protocol tests GREEN**

Run the same focused Vitest command and confirm all protocol and alert assertions pass.

- [ ] **Step 5: Refactor only after GREEN**

Keep constants/types/codec/schedule/alert responsibilities separate, re-export the public API from `src/protocol/index.ts`, and rerun the focused tests.

---

### Task 3: Implement Web Bluetooth transport

**Files:**
- Create: `src/transport/errors.ts`
- Create: `src/transport/transport.ts`
- Create: `src/transport/web-bluetooth.ts`
- Test: `src/transport/web-bluetooth.test.ts`

**Interfaces:**
- `FeederTransport` exposes `kind`, `support`, `deviceName`, `chipId`, `connect(options?: ConnectOptions): Promise<void>`, `disconnect(): Promise<void>`, `onMessage(listener): () => void`, `onDisconnect(listener): () => void`, `sendCommand(payload): Promise<void>`, `syncTime(seconds): Promise<void>`, `readSchedules(): Promise<Schedule[]>`, and `writeSchedules(schedules): Promise<void>`.
- `WebBluetoothTransport` accepts injected `BluetoothApiLike` and secure-context state for deterministic tests, and uses `requestDevice` only when `options.requestDevice !== false`.
- `TransportError` has stable `code` values including `unsupported`, `insecure_context`, `cancelled`, `permission_denied`, `connection_failed`, `not_connected`, and `invalid_response`.

- [ ] **Step 1: Write Web Bluetooth RED tests**

Use structural fake Bluetooth devices/services/characteristics, not production mocks. Test unsupported API and insecure context without calling the chooser; chooser filtering includes the Floyd service/name prefix; successful GATT discovery subscribes to response/telemetry/status/feed-log notifications; UTF-8 JSON notifications reach listeners; command/time/schedule writes use the expected characteristics and bytes; schedule reads reject invalid JSON; chooser cancellation maps to `cancelled`; GATT failure maps to `connection_failed`; and `gattserverdisconnected` emits exactly one unexpected-disconnect event while manual disconnect does not.

- [ ] **Step 2: Run transport tests and verify RED**

Run `npm run test -- src/transport/web-bluetooth.test.ts` and confirm failures are missing transport behavior, not DOM type/setup errors.

- [ ] **Step 3: Implement capability detection and error normalization**

Detect `navigator.bluetooth` and `window.isSecureContext` without assuming either global exists. Map browser exception names to `TransportError`; never write credentials or use Web Bluetooth from a worker.

- [ ] **Step 4: Implement GATT lifecycle and contract writes**

Request one device using the existing service/name filter, connect and discover all required characteristics, start notifications for response/telemetry/status/feed-log, parse incoming JSON, write command envelopes with response, encode time little-endian, read schedules as a JSON array, and write schedule chunks sequentially. Remove listeners and clear characteristic references on disconnect.

- [ ] **Step 5: Run transport tests GREEN**

Run `npm run test -- src/transport/web-bluetooth.test.ts` and confirm all assertions pass.

---

### Task 4: Define the future Wi-Fi seam and firmware boundary

**Files:**
- Modify: `src/transport/transport.ts`
- Create: `src/transport/wifi-boundary.ts`
- Test: `src/transport/wifi-boundary.test.ts`
- Create: `docs/wifi-transport-contract.md`

**Interfaces:**
- `TransportKind` includes `"bluetooth"` and reserved `"wifi"`, while the default factory returns only `WebBluetoothTransport`.
- `getWifiAvailability(): { available: false; reason: string }` returns a stable explanation that no Wi-Fi adapter is enabled until the firmware exposes a documented browser-safe HTTP/WebSocket API.
- `wifi-boundary.ts` contains no HTTP endpoint assumptions, socket implementation, credential fields, or storage writes.

- [ ] **Step 1: Write boundary RED tests**

Test that the default transport selection is Bluetooth-only, Wi-Fi availability is explicitly false with the current-firmware/raw-MQTT reason, and no boundary API accepts or persists credentials.

- [ ] **Step 2: Run boundary tests and verify RED**

Run `npm run test -- src/transport/wifi-boundary.test.ts` and confirm the reserved seam is not accidentally advertised as a working adapter.

- [ ] **Step 3: Implement the disabled seam**

Keep `FeederTransport` transport-neutral, expose the explicit unavailable result, and add the documented prerequisites: firmware HTTP/WebSocket endpoints, CORS, `Cache-Control: no-store`, station/AP provisioning, credentials transfer strategy, and approved HTTPS/WSS/trusted relay boundary.

- [ ] **Step 4: Run boundary tests GREEN**

Run `npm run test -- src/transport/wifi-boundary.test.ts` and confirm all assertions pass.

---

### Task 5: Implement external feeder state store and persistence

**Files:**
- Create: `src/storage/local-storage.ts`
- Create: `src/state/feeder-store.ts`
- Create: `src/state/feeder-context.tsx`
- Test: `src/state/feeder-store.test.ts`

**Interfaces:**
- `StorageLike` has `getItem`, `setItem`, and `removeItem`; the store uses keys `floydChipId` and `floyd-feedlogs` only.
- `FeederStore` implements `subscribe`, `getSnapshot`, `startConnection`, `connectToDevice`, `retryConnection`, `disconnectBle`, `forgetFeeder`, `requestSensorData`, `startFeed`, `stopFeed`, `clearJam`, `setSensorReadingInterval`, `reloadSchedules`, `publishScheduleSync`, `setAutoRefreshEnabled`, `setAutoRefreshInterval`, `setFeedLogs`, and `clearSensorLogs`.
- `FeederStoreProvider` provides an injected store through React context; `useFeederSnapshot()` calls `useSyncExternalStore` with the store's `subscribe/getSnapshot` methods.

- [ ] **Step 1: Write state/persistence RED tests**

Use a fake transport and memory storage. Test feed logs restore at construction and persist after a feed-complete notification; malformed storage is ignored; sensor logs are capped at 50 and clearable; sensor/status/control/schedule/error messages update the corresponding snapshot fields; commands are rejected while disconnected and transport failures become visible command errors; successful connection persists the selected chip ID; manual disconnect prevents reconnect; unexpected disconnect attempts at most three times within roughly 30 seconds and then exposes `connection_lost`; retry resets the window; and schedule sync delegates validated chunks. Provisioning remains informational only because the current firmware's `restart_provisioning` drops BLE into an incompatible raw-MQTT SoftAP.

- [ ] **Step 2: Run state tests and verify RED**

Run `npm run test -- src/state/feeder-store.test.ts` and confirm missing store behavior causes the failures.

- [ ] **Step 3: Implement storage guards and immutable external snapshots**

Load only valid feed-log arrays, write a bounded journal after every update, replace the snapshot object on state transitions, and notify subscribers synchronously. Keep sensor logs in memory and never call browser storage with Wi-Fi credentials.

- [ ] **Step 4: Implement connection state machine and reconnect timers**

Use the transport's support state before the chooser, distinguish scanning/chooser, connecting, connected, idle, and error, preserve last-known device values after disconnect, schedule three known-device reconnect attempts within a 30-second window, cancel timers on manual actions, and sync device time on successful connect/visible foreground.

- [ ] **Step 5: Implement message routing, commands, schedules, and auto-refresh**

Route typed device messages, derive alerts from current data in the UI, append sensor/feed journals, wrap all commands in the exact envelope, enforce connected checks, refresh schedules, and run the optional sensor interval from the store rather than a component effect.

- [ ] **Step 6: Run state tests GREEN and inspect the hook boundary**

Run `npm run test -- src/state/feeder-store.test.ts`. Confirm the context/hook contains no direct `useEffect` call and only exposes external-store subscription behavior.

---

### Task 6: Build accessible responsive application shell

**Files:**
- Create: `src/main.tsx`
- Create: `src/App.tsx`
- Create: `src/hooks/use-hash-route.ts`
- Create: `src/components/AppShell.tsx`
- Create: `src/components/ConnectionPanel.tsx`
- Create: `src/components/StatusBanner.tsx`
- Create: `src/styles.css`
- Test: `src/components/app-shell.test.tsx`

**Interfaces:**
- `navigate(route: AppRoute): void` writes a hash route; `useHashRoute(): AppRoute` subscribes to `hashchange` through `useSyncExternalStore`.
- `AppShell` renders skip link, sidebar/bottom navigation, one primary `<main>`, current route heading, connection indicator, and live status region.
- `ConnectionPanel` renders chooser connect/retry, disconnect, forget, unsupported/insecure messages, no-RSSI notice, and the provisioning limitation without credential inputs.

- [ ] **Step 1: Write shell RED tests**

Render the shell with a fake store and assert one main landmark, keyboard-accessible links/buttons, route changes through hash navigation, unsupported-BLE text when capability is unavailable, connected/disconnected status text, and no Wi-Fi credential input or storage call in the provisioning panel.

- [ ] **Step 2: Run shell tests and verify RED**

Run `npm run test -- src/components/app-shell.test.tsx` and confirm failures come from missing components.

- [ ] **Step 3: Implement entry point, provider, route subscription, and shell**

Register no transport chooser at module scope; render `FeederStoreProvider`, use native anchors for navigation, provide a skip link, and use `aria-live="polite"`/`role="alert"` for transport updates. Do not import or call `useEffect`.

- [ ] **Step 4: Implement responsive CSS and focus behavior**

Use the existing marine-green palette (`#0D9488`, `#10B981`, `#F59E0B`, mint/dark surfaces), simple borders/radii, a 240px desktop rail, a compact mobile navigation, 320px reflow, visible focus rings, 40px minimum interactive targets, and reduced-motion-safe transitions. Avoid gradients, decorative glows, oversized cards, and fake RSSI/distance visuals.

- [ ] **Step 5: Run shell tests GREEN**

Run `npm run test -- src/components/app-shell.test.tsx` and confirm keyboard/name/status assertions pass.

---

### Task 7: Build dashboard, controls, schedules, and logs

**Files:**
- Create: `src/components/DashboardView.tsx`
- Create: `src/components/ControlsView.tsx`
- Create: `src/components/ScheduleView.tsx`
- Create: `src/components/LogsView.tsx`
- Create: `src/components/MetricCard.tsx`
- Create: `src/components/AlertList.tsx`
- Test: `src/components/controls.test.tsx`
- Test: `src/components/schedule.test.tsx`

**Interfaces:**
- `DashboardView` consumes `FeederSnapshot` and pure `generateAlerts`, showing connection, valid sensor values, motor state, capacity, active alerts, and recent feed logs.
- `ControlsView` keeps local draft values, clamps speeds to 0–100 and duration to 0–30 seconds, converts speeds using `Math.round(value * 10.23)`, and calls store actions from user handlers.
- `ScheduleView` edits exact `Schedule` objects, validates label/time/day choices before sync, and displays sync errors without closing the dialog.
- `LogsView` switches sensor/alerts/feed sections, displays latest previews and full lists, and clears only sensor logs.

- [ ] **Step 1: Write view RED tests**

Test that disconnected controls are unavailable, FEED emits the exact PWM/millisecond payload, STOP and CLEAR JAM actions are reachable, invalid duration is rejected, schedule add/edit/delete/toggle operations send complete lists, schedule validation keeps the dialog open on errors, logs render feed/sensor/alert entries, and dashboard suppresses invalid sensor values while showing last-known state after disconnect.

- [ ] **Step 2: Run view tests and verify RED**

Run `npm run test -- src/components/controls.test.tsx src/components/schedule.test.tsx` and confirm missing UI behavior causes expected failures.

- [ ] **Step 3: Implement dashboard and controls**

Use semantic sections/headings and plain CSS grids. Render progress using a native-accessible `progressbar`, show `--` for unavailable readings, surface command errors, disable motor speed drafts while active, and use an inline clear-jam confirmation rather than an unlabelled browser alert.

- [ ] **Step 4: Implement schedule editor**

Use a native time input, seven labeled checkbox controls for weekdays, a native dialog with `autoFocus`, inline field errors linked by `aria-describedby`, complete default motor timings, stable IDs, and optimistic UI only after `publishScheduleSync` succeeds.

- [ ] **Step 5: Implement logs and full section views**

Show bounded sensor history, derived active alerts, feed completion status/errors, timestamps, connection logging state, clear sensor action, and empty states. Keep alerts derived from current device data rather than duplicating alert state.

- [ ] **Step 6: Run view tests GREEN**

Run `npm run test -- src/components/controls.test.tsx src/components/schedule.test.tsx` and confirm all interaction assertions pass.

---

### Task 8: Add manifest and hand-written service worker

**Files:**
- Create: `public/manifest.webmanifest`
- Create: `public/icon-192.svg`
- Create: `public/icon-512.svg`
- Create: `public/sw.js`
- Test: `tests/browser/pwa.spec.ts`
- Create: `playwright.config.ts`

**Interfaces:**
- Manifest is same-origin, standalone, installable, and references both SVG icons.
- `/sw.js` caches only same-origin shell/static requests, never API/device responses, credentials, or cross-origin requests; its registration scope is `/`.
- Playwright config starts the Vite dev server on localhost and exposes `npm run test:browser`.

- [ ] **Step 1: Write browser RED tests**

Add Playwright tests for manifest fields/icons, service-worker registration scope `/`, app-shell offline response after initial load, unsupported-BLE messaging with `navigator.bluetooth` removed, and keyboard navigation from Dashboard to Controls and Logs.

- [ ] **Step 2: Run browser tests and verify RED**

Run `npm run test:browser`; failures should identify missing manifest/service-worker/UI behavior or a missing local browser executable, not invalid test syntax.

- [ ] **Step 3: Implement manifest/icons/service worker**

Use a same-origin cache name, precache `/`, `/index.html`, `/manifest.webmanifest`, and icon assets, delete old cache versions on activate, bypass non-GET/cross-origin/empty-destination device requests, and use network-first navigation with cached shell fallback. Register only from `main.tsx`.

- [ ] **Step 4: Run browser tests GREEN where the local browser is available**

Run `npm run test:browser`. Record any environment-only missing Chromium executable separately; do not convert that gap into a false pass.

---

### Task 9: Run complete verification and close the migration

**Files:**
- Modify: `docs/superpowers/specs/2026-08-27-floyd-web-pwa-design.md` only if observed implementation boundaries need clarification.
- Modify: `docs/superpowers/plans/2026-08-27-floyd-web-pwa-plan.md` to mark completed steps if this plan is used as the execution record.

**Interfaces:**
- No new runtime interface; this task produces evidence for all prior contracts.

- [ ] **Step 1: Run the complete automated suite**

Run `npm run test`, `npm run lint`, and `npm run build` from `floyd-web-app`. Record exact counts and exit codes.

- [ ] **Step 2: Run browser smoke verification**

Run `npm run test:browser` against the local Vite server. Verify manifest discovery, service-worker scope, offline shell fallback, unsupported Web Bluetooth messaging, keyboard navigation, and no direct `useEffect` occurrence in `src`.

- [ ] **Step 3: Run the actual app smoke path**

Run `npm run dev -- --host 127.0.0.1`, open the app in a supported Chromium browser, exercise connect chooser, disconnect/retry, dashboard refresh, FEED/STOP/CLEAR JAM, schedule sync, logs clearing, and the unsupported/provisioning messages. If no real feeder is available, report hardware behavior as unverified.

- [ ] **Step 4: Report evidence separately**

Separate automated test/lint/build results, browser results, and real ESP32 results. Explicitly state that Web Bluetooth is unavailable on iOS Safari/Chrome and that the current firmware's raw MQTT SoftAP cannot be used by the PWA until the HTTP/WebSocket firmware extension and HTTPS/WSS strategy exist.
