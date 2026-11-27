import { devices, expect, test } from "@playwright/test";

const service = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
const uuid = (suffix: string) => "4fafc201-1fb5-459e-8fcc-c5c9c331" + suffix;
const phone = (name: "Pixel 7" | "iPhone 13") => {
  const { viewport, userAgent, deviceScaleFactor, hasTouch, isMobile } = devices[name];
  return { viewport, userAgent, deviceScaleFactor, hasTouch, isMobile };
};
const schedule = (label: string) => ({
  id: label,
  label,
  time: "08:00",
  daysOfWeek: "1",
  augerSpeed: 768,
  impellerSpeed: 1023,
  preSpinMs: 1500,
  feedMs: 3000,
  postSpinMs: 1500,
  enabled: true,
});

test.describe("Android Chrome layout and Web Bluetooth", () => {
  test.use({ ...phone("Pixel 7"), serviceWorkers: "block" });

  test("protects a feeder's schedules after a read failure and a rejected save", async ({ page }, testInfo) => {
    await page.addInitScript(({ first, second }) => {
      const storage = { AAAAAA: [first], BBBBBB: [second] };
      let next: keyof typeof storage = "AAAAAA";
      let unavailable = true;
      let unsynced = true;
      let rejectWrite: (() => void) | undefined;
      let holdWrite = false;
      let completeWrite: (() => void) | undefined;
      const encode = (value: unknown) => new DataView(new TextEncoder().encode(JSON.stringify(value)).buffer);

      Object.defineProperty(window, "feederFixture", { value: {
        chooseSecond: () => { next = "BBBBBB"; },
        allowRead: () => { unavailable = false; },
        allowClock: () => { unsynced = false; },
        rejectWrite: () => rejectWrite?.(),
        holdWrite: () => { holdWrite = true; },
        finishWrite: () => { holdWrite = false; completeWrite?.(); },
        saved: () => storage.BBBBBB.map((item) => [item.label, item.enabled]),
      } });

      Object.defineProperty(navigator, "bluetooth", { value: {
        requestDevice: async () => {
          const id = next;
          const device = new EventTarget();
          const notifications = new Map<string, (value: unknown) => void>();
          const gatt = {
            connected: true,
            disconnect: () => { gatt.connected = false; },
            async getPrimaryService() {
              return {
                async getCharacteristic(characteristicUuid: string) {
                  const suffix = characteristicUuid.slice(-4);
                  const characteristic = new EventTarget();
                  const api = Object.assign(characteristic, {
                    value: null as DataView | null,
                    async startNotifications() { return this; },
                    async readValue() {
                      if (id === "BBBBBB" && unavailable) throw new Error("Read failed");
                      return encode(storage[id]);
                    },
                    async writeValueWithResponse(buffer: ArrayBuffer) {
                      if (suffix === "9147") {
                        notifications.get("9144")?.({ type: "status", data: { timeSynced: !unsynced } });
                        if (unsynced) throw new Error("Clock sync failed");
                      }
                      if (suffix !== "9145") return;

                      const nextSchedules = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4)));
                      if (nextSchedules.some((item: typeof first) => item.label === "Evening feed")) {
                        rejectWrite = () => notifications.get("9142")?.({
                          type: "error", data: { action: "set_schedules", message: "Flash write failed." },
                        });
                        return;
                      }
                      completeWrite = () => {
                        storage[id] = nextSchedules;
                        notifications.get("9142")?.({
                          type: "control_response", data: { action: "set_schedules", success: true },
                        });
                      };
                      if (!holdWrite) completeWrite();
                    },
                  });
                  notifications.set(suffix, (value) => {
                    api.value = encode(value);
                    api.dispatchEvent(new Event("characteristicvaluechanged"));
                  });
                  return api;
                },
              };
            },
          };
          return Object.assign(device, { name: "FloydFeeder-" + id, gatt });
        },
      } });
    }, { first: schedule("First feeder breakfast"), second: schedule("Second feeder breakfast") });

    const fixture = (action: "chooseSecond" | "allowRead" | "allowClock" | "rejectWrite" | "holdWrite" | "finishWrite" | "saved") =>
      page.evaluate((name) => (window as unknown as {
        feederFixture: Record<typeof name, () => unknown>;
      }).feederFixture[name](), action);

    await page.goto("/#schedule");
    await page.getByRole("button", { name: "Connect feeder" }).tap();
    await expect(page.getByRole("heading", { name: "First feeder breakfast" })).toBeVisible();
    await page.getByRole("button", { name: "Disconnect" }).tap();

    await fixture("chooseSecond");
    await page.getByRole("button", { name: "Connect feeder" }).tap();
    await expect(page.getByRole("alert")).toHaveText(/invalid schedule response/i);
    await expect(page.getByRole("heading", { name: "First feeder breakfast" })).toHaveCount(0);
    const add = page.getByRole("button", { name: "Add schedule" });
    await expect(add).toBeDisabled();
    expect(await fixture("saved")).toEqual([["Second feeder breakfast", true]]);

    await fixture("allowRead");
    await page.getByRole("button", { name: "Reload schedules" }).tap();
    await expect(page.getByRole("heading", { name: "Second feeder breakfast" })).toBeVisible();
    await expect(page.getByText(/scheduled feeds may not run/i)).toBeVisible();
    await fixture("allowClock");
    await page.getByRole("button", { name: "Retry clock sync" }).tap();
    await expect(page.getByText(/scheduled feeds may not run/i)).toHaveCount(0);

    await add.tap();
    const editor = page.getByRole("dialog");
    await editor.getByLabel("Label", { exact: true }).fill("Evening feed");
    await editor.getByLabel("Monday", { exact: true }).tap();
    await expect(editor.getByLabel("Label", { exact: true })).toHaveCSS("font-size", "16px");
    await page.screenshot({ path: testInfo.outputPath("android-schedule-editor.png"), scale: "css" });
    await editor.getByRole("button", { name: "Save schedule" }).tap();
    await expect(editor.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(page.getByRole("heading", { name: "Evening feed" })).toHaveCount(0);
    await fixture("rejectWrite");
    await expect(editor.getByRole("alert")).toContainText("Flash write failed.");
    expect(await fixture("saved")).toEqual([["Second feeder breakfast", true]]);

    await editor.getByRole("button", { name: "Reload schedules" }).tap();
    await editor.getByLabel("Label", { exact: true }).fill("Dinner");
    await editor.getByRole("button", { name: "Save schedule" }).tap();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Dinner" })).toBeVisible();
    expect(await fixture("saved")).toEqual([["Second feeder breakfast", true], ["Dinner", true]]);

    const breakfast = page.getByRole("article").filter({ hasText: "Second feeder breakfast" }).getByRole("checkbox");
    const dinner = page.getByRole("article").filter({ hasText: "Dinner" }).getByRole("checkbox");
    await fixture("holdWrite");
    await breakfast.tap();
    await expect(dinner).toBeDisabled();
    await fixture("finishWrite");
    await expect(breakfast).not.toBeChecked();
    await dinner.tap();
    await expect(dinner).not.toBeChecked();
    expect(await fixture("saved")).toEqual([["Second feeder breakfast", false], ["Dinner", false]]);
  });
});

test.describe("iPhone layout and native Bluetooth bridge", () => {
  test.use(phone("iPhone 13"));

  test("discovers the feeder and runs a feed through the Capacitor bridge", async ({ page }, testInfo) => {
    await page.addInitScript(({ service, characteristics }) => {
      Object.defineProperty(navigator, "bluetooth", { value: undefined });
      Object.defineProperty(window, "webkit", { value: { messageHandlers: { bridge: {} } } });
      const deviceId = "named-feeder";
      const listeners = new Map<string, (data: unknown) => void>();
      const encode = (value: unknown) => Array.from(new TextEncoder().encode(JSON.stringify(value)))
        .map((byte) => byte.toString(16).padStart(2, "0")).join("");
      const notify = (suffix: string, value: unknown) => {
        const characteristic = characteristics.find((value) => value.endsWith(suffix));
        listeners.get(`notification|${deviceId}|${service}|${characteristic}`)?.({ value: encode(value) });
      };
      const methods = ["initialize", "requestDevice", "connect", "getServices", "startNotifications", "read", "write", "removeListener", "disconnect"];
      Object.defineProperty(window, "Capacitor", { writable: true, value: {
        PluginHeaders: [{ name: "BluetoothLe", methods: [
          ...methods.map((name) => ({ name, rtype: "promise" })),
          { name: "addListener" },
        ] }],
        nativeCallback(_plugin: string, _method: string, options: { eventName: string }, callback: (data: unknown) => void) {
          listeners.set(options.eventName, callback);
          return options.eventName;
        },
        async nativePromise(plugin: string, method: string, options: { services?: string[]; characteristic?: string; value?: string }) {
          if (plugin !== "BluetoothLe") throw new Error("Unexpected native plugin");
          if (method === "requestDevice") {
            if (options.services?.[0] !== service) throw new Error("Missing Floyd service filter");
            return { deviceId, name: "FloydFeeder-AAAAAA" };
          }
          if (method === "getServices") {
            return { services: [{ uuid: service, characteristics: characteristics.map((uuid) => ({ uuid })) }] };
          }
          if (method === "read") return { value: encode([]) };
          if (method === "write" && options.characteristic?.endsWith("9147")) {
            notify("9144", { type: "status", data: { timeSynced: true } });
          }
          if (method === "write" && options.characteristic?.endsWith("9141")) {
            const bytes = Uint8Array.from(options.value?.match(/[\da-f]{2}/gi) ?? [], (hex) => parseInt(hex, 16));
            const { action } = JSON.parse(new TextDecoder().decode(bytes));
            if (action !== "start_feed") return;
            notify("9142", { type: "control_response", data: { action, success: true, motorState: "pre_spin" } });
          }
        },
      } });
    }, { service, characteristics: ["9141", "9142", "9143", "9144", "9145", "9147", "9148"].map(uuid) });

    await page.goto("/#schedule");
    await page.getByRole("button", { name: "Connect feeder" }).tap();
    await expect(page.getByRole("button", { name: "Add schedule" })).toBeEnabled();
    await expect(page.getByText(/scheduled feeds may not run/i)).toHaveCount(0);
    await page.getByRole("link", { name: "Controls" }).tap();
    await page.getByRole("button", { name: "FEED", exact: true }).tap();
    await expect(page.getByRole("button", { name: "STOP", exact: true })).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth === window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("iphone-feeding.png"), scale: "css", fullPage: true });
    await page.getByRole("button", { name: "Disconnect" }).tap();
    await expect(page.getByRole("button", { name: "FEED", exact: true })).toBeDisabled();
  });
});
