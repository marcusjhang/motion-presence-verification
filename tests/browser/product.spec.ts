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
  await page.getByRole("button", { name: "Confirm purchase" }).click();
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
  await page.getByRole("button", { name: "Confirm purchase" }).click();
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
  await page.getByRole("button", { name: "Confirm purchase" }).click();
  await page.getByRole("button", { name: "Start physical check" }).click();
  await expect(page.getByRole("heading", { name: "Use another route" })).toBeVisible({ timeout: 4_000 });
  await expect(page.getByRole("button", { name: "Use my phone" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use another verification method" })).toBeVisible();
});

test("QR handoff UI explains its scope and keeps bearer out of document text", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Confirm purchase" }).click();
  await page.getByRole("button", { name: "Use my phone" }).click();
  await expect(page.getByRole("heading", { name: "Use your phone" })).toBeVisible();
  await expect(page.getByAltText("QR code for one-time phone link")).toBeVisible();
  const href = await page.getByRole("link", { name: "Open one-time link" }).getAttribute("href");
  expect(new URL(href!).hash.length).toBeGreaterThan(20);
  expect(await page.locator("body").innerText()).not.toContain(new URL(href!).hash.slice(1));
});

test("primary screen has no serious automated accessibility violations", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Confirm purchase" }).click();
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => ["serious", "critical"].includes(violation.impact ?? ""))).toEqual([]);
});

test("QR phone completes motion and advances the waiting desktop", async ({ page, context }) => {
  await page.goto("/"); await page.getByRole("button", { name: "Confirm purchase" }).click(); await page.getByRole("button", { name: "Use my phone" }).click();
  const href = await page.getByRole("link", { name: "Open one-time link" }).getAttribute("href");
  const phone = await context.newPage(); await phone.addInitScript(() => { Object.defineProperty(window, "DeviceOrientationEvent", { value: class DeviceOrientationEvent extends Event {} }); });
  await phone.goto(href!); await phone.getByRole("button", { name: "Connect phone" }).click(); await phone.getByRole("button", { name: "Start physical check" }).click(); await emitOrientation(phone, 0, 0);
  await expect(phone.getByRole("heading", { name: "Hold comfortably still" })).toBeVisible();
  for (let index = 0; index < 12; index++) { await emitOrientation(phone, 0, 0); await phone.waitForTimeout(12); }
  await expect(phone.getByRole("heading", { name: "Gentle tilt" })).toBeVisible();
  for (let step = 0; step < 3; step++) { const position = await phone.locator(".goal").evaluate((element) => ({ left: parseFloat((element as HTMLElement).style.left), top: parseFloat((element as HTMLElement).style.top) })); const gamma = (position.left - 50) / 4, beta = (position.top - 50) / 4; await emitOrientation(phone, beta, gamma); await phone.waitForTimeout(150); await emitOrientation(phone, beta, gamma); }
  await expect(phone.getByText("return to your computer")).toBeVisible(); await expect(page.getByText("completed exactly once")).toBeVisible({ timeout: 5_000 });
});

test("embeddable element emits only an opaque completion result", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => { (window as any).widgetResult = null; const widget = document.createElement("motion-presence") as any; widget.setAttribute("site-key", "pk_local_demo"); widget.setAttribute("action", "demo_purchase"); widget.setAttribute("action-description", "Confirm embedded purchase"); widget.addEventListener("motion-presence-complete", (event: Event) => { (window as any).widgetResult = (event as CustomEvent).detail; }); document.body.append(widget); widget.start(); });
  await expect.poll(() => page.frames().some((candidate) => candidate.url().includes("widget=1"))).toBe(true);
  const frame = page.frames().find((candidate) => candidate.url().includes("widget=1"))!; await frame.getByRole("button", { name: "Use another verification method" }).click(); await frame.getByLabel("One-time support code").fill("test-only-code"); await frame.getByRole("button", { name: "Verify code" }).click();
  await expect.poll(() => page.evaluate(() => (window as any).widgetResult)).toEqual({ resultToken: expect.any(String) });
  const result = await page.evaluate(() => (window as any).widgetResult); expect(Object.keys(result)).toEqual(["resultToken"]); expect(result.resultToken.length).toBeGreaterThan(20);
});

test("operator view reports aggregate activity without identifiers", async ({ page }) => {
  await page.goto("/operator"); await expect(page.getByRole("heading", { name: "Verification activity, without surveillance." })).toBeVisible(); await expect(page.getByText("Sessions started")).toBeVisible();
  const text = await page.locator("body").innerText(); expect(text).not.toContain("resultToken"); expect(text).not.toContain("sessionId");
});
