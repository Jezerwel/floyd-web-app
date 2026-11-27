import { expect, test } from "@playwright/test";

test("loads the dashboard and navigates the accessible shell", async ({ page }) => {
  await page.goto("/#dashboard");

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Controls" })).toHaveAttribute("href", "#controls");

  const bluetoothSupported = await page.evaluate(() =>
    "bluetooth" in navigator && window.isSecureContext,
  );
  const connectButton = page.getByRole("button", { name: "Connect feeder" });
  if (bluetoothSupported) {
    await expect(connectButton).toBeEnabled();
  } else {
    await expect(connectButton).toBeDisabled();
    await expect(page.getByText(/Web Bluetooth is unavailable|does not support Web Bluetooth/i)).toBeVisible();
  }

  await page.getByRole("link", { name: "Controls" }).click();
  await expect(page).toHaveURL(/#controls$/);
  await expect(page.getByRole("heading", { name: "Controls" })).toBeVisible();
  await expect(page.getByRole("button", { name: "FEED", exact: true })).toBeDisabled();
  await expect(page.getByText(/Wi.?Fi credentials are not collected/i)).toBeVisible();
  await page.getByRole("link", { name: "Logs" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#logs$/);
  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
  await page.getByRole("link", { name: "Skip to content" }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#logs$/);
  await expect(page.getByRole("heading", { name: "Logs" })).toBeFocused();
});

test("serves install metadata and an offline shell", async ({ page, request }) => {
  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  expect(manifest.name).toBe("Floyd Feeder");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/#dashboard");
  expect(manifest.icons).toEqual([
    expect.objectContaining({ src: "/icon-192.svg", sizes: "192x192" }),
    expect.objectContaining({ src: "/icon-512.svg", sizes: "512x512" }),
  ]);

  await page.goto("/#dashboard");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return { scope: ready.scope, controlled: Boolean(navigator.serviceWorker.controller) };
  });
  expect(registration.scope).toBe("http://127.0.0.1:4173/");
  expect(registration.controlled).toBe(true);

  await page.context().setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("link", { name: "Logs" }).click();
  await expect(page.getByRole("heading", { name: "Logs" })).toBeVisible();
});

test("explains the unsupported Bluetooth boundary", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "bluetooth", {
      configurable: true,
      value: undefined,
    });
  });
  await page.goto("/#dashboard");

  await expect(page.getByRole("button", { name: "Connect feeder" })).toBeDisabled();
  await expect(page.getByText(/does not support Web Bluetooth/i)).toBeVisible();
  await expect(page.getByText(/raw MQTT/i)).toBeVisible();
  await expect(page.getByText(/credentials are not collected/i)).toBeVisible();
});
