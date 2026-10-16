import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function emitOrientation(page: import("@playwright/test").Page, beta: number, gamma: number) {
  await page.evaluate(({ beta, gamma }) => {
    const event = new Event("deviceorientation");
    Object.defineProperties(event, { beta: { value: beta }, gamma: { value: gamma } });
    window.dispatchEvent(event);
  }, { beta, gamma });
}

test("laptop motion completes calibration, challenge, redemption, and purchase", async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, "DeviceOrientationEvent", { value: class DeviceOrientationEvent extends Event {} }); });
  await page.goto("/");
  await page.getByRole("button", { name: "Purchase demo item" }).click();
  await page.getByRole("button", { name: "Start physical check" }).click();
  await emitOrientation(page, 0, 0);
  await expect(page.getByRole("heading", { name: "Hold comfortably still" })).toBeVisible();
  for (let index = 0; index < 12; index++) { await emitOrientation(page, 0, 0); await page.waitForTimeout(12); }
  await expect(page.getByRole("heading", { name: "Gentle tilt" })).toBeVisible();
  for (let step = 0; step < 3; step++) {
    await expect(page.locator("#progress")).toHaveText(`Target ${step + 1} of 3`);
    const position = await page.locator(".goal").evaluate((element) => ({ left: parseFloat((element as HTMLElement).style.left), top: parseFloat((element as HTMLElement).style.top) }));
    const gamma = (position.left - 50) / 4, beta = (position.top - 50) / 4;
    await emitOrientation(page, beta, gamma); await page.waitForTimeout(150); await emitOrientation(page, beta, gamma);
  }
  await expect(page.getByRole("heading", { name: "Confirmed" })).toBeVisible();
  await expect(page.getByText("completed exactly once")).toBeVisible();
});

test("merchant can complete the motion-independent route", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Purchase demo item" }).click();
  await expect(page.getByRole("heading", { name: "Quick physical check" })).toBeFocused();
  await page.getByRole("button", { name: "Use another verification method" }).click();
  await expect(page.getByText("does not issue or reveal that code")).toBeVisible();
  await page.getByLabel("One-time support code").fill("test-only-code");
  await page.getByRole("button", { name: "Verify code" }).click();
  await expect(page.getByRole("heading", { name: "Confirmed" })).toBeVisible();
  await expect(page.getByText("completed exactly once")).toBeVisible();
});

test("laptop without motion sensors receives phone and alternative routes", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Purchase demo item" }).click();
  await page.getByRole("button", { name: "Start physical check" }).click();
  await expect(page.getByRole("heading", { name: "Use another route" })).toBeVisible({ timeout: 4_000 });
  await expect(page.getByRole("button", { name: "Use my phone" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use another verification method" })).toBeVisible();
});

test("QR handoff UI explains its scope and keeps bearer out of document text", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Purchase demo item" }).click();
  await page.getByRole("button", { name: "Use my phone" }).click();
  await expect(page.getByRole("heading", { name: "Use your phone" })).toBeVisible();
  await expect(page.getByAltText("QR code for one-time phone link")).toBeVisible();
  const href = await page.getByRole("link", { name: "Open one-time link" }).getAttribute("href");
  expect(new URL(href!).hash.length).toBeGreaterThan(20);
  expect(await page.locator("body").innerText()).not.toContain(new URL(href!).hash.slice(1));
});

test("primary screen has no serious automated accessibility violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Purchase demo item" }).click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});
