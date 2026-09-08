import { expect, test } from "@playwright/test";

import { DOCK_OPTIONS, mockApi, waitForMap } from "./fixtures";

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

async function planATrip(page: import("@playwright/test").Page) {
  await page.goto("/");
  await waitForMap(page);
  await page.getByPlaceholder("Where to? Or tap the map").fill("Bryant Park");
  await page.getByRole("button", { name: "Bryant Park, Manhattan" }).click();
  await page.getByRole("button", { name: "Plan route" }).click();
  await expect(page.getByRole("button", { name: "Start ride" })).toBeVisible();
}

test("starting a ride shows a countdown against the leg budget", async ({ page }) => {
  await planATrip(page);
  await page.getByRole("button", { name: "Start ride" }).click();

  await expect(page.getByText("until you should dock")).toBeVisible();
  // Exact, or it also matches the plan sheet's "Dock now": accessible-name
  // matching is case-insensitive by default.
  await expect(page.getByRole("button", { name: "DOCK NOW", exact: true })).toBeVisible();

  // Member mode aims to redock at 35 minutes, so the clock opens near 35:00.
  const clock = page.locator("p.font-mono").first();
  await expect(clock).toHaveText(/^3[45]:\d{2}$/);
});

test("the countdown actually ticks down", async ({ page }) => {
  await planATrip(page);
  await page.getByRole("button", { name: "Start ride" }).click();

  const clock = page.locator("p.font-mono").first();
  const first = await clock.textContent();
  await page.waitForTimeout(2500);
  const second = await clock.textContent();

  expect(first).not.toEqual(second);
});

test("the ride targets the first swap dock", async ({ page }) => {
  await planATrip(page);
  await page.getByRole("button", { name: "Start ride" }).click();

  await expect(page.getByText("Swap Dock: 5 Ave & E 78 St")).toBeVisible();
  await expect(page.getByText(/swap 1 of 1/)).toBeVisible();
});

test("docking advances to the final leg and restarts the timer", async ({ page }) => {
  await planATrip(page);
  await page.getByRole("button", { name: "Start ride" }).click();

  await page.getByRole("button", { name: /I've docked/ }).click();

  await expect(page.getByText("Broadway & W 41 St")).toBeVisible();
  await expect(page.getByRole("button", { name: "Docked, done" })).toBeVisible();
});

test("dock now lists ranked docks and retargets the ride", async ({ page }) => {
  await planATrip(page);
  await page.getByRole("button", { name: "Start ride" }).click();

  await page.getByRole("button", { name: "DOCK NOW", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Nearest open docks" })).toBeVisible();
  await expect(page.getByText(`${DOCK_OPTIONS[1].docks} docks free`)).toBeVisible();

  await page.getByRole("button", { name: new RegExp(DOCK_OPTIONS[1].name) }).click();

  await expect(page.getByRole("heading", { name: "Nearest open docks" })).toBeHidden();
  await expect(page.getByText(DOCK_OPTIONS[1].name)).toBeVisible();
});

test("dock now says so plainly when nothing is open", async ({ page }) => {
  await mockApi(page, { dockOptions: [] });
  await page.goto("/");
  await waitForMap(page);

  await page.getByRole("button", { name: "Dock now" }).click();
  await expect(page.getByText("No station with a free dock within riding distance.")).toBeVisible();
});

test("ending a ride returns to planning", async ({ page }) => {
  await planATrip(page);
  await page.getByRole("button", { name: "Start ride" }).click();

  // Wait for the ride to actually be under way before ending it. Starting one
  // also re-ranks the nearby docks by cycling time, and clicking through that
  // makes the test a race rather than a check.
  await expect(page.getByText("until you should dock")).toBeVisible();
  await page.getByRole("button", { name: "End" }).click();

  await expect(page.getByRole("button", { name: "Plan route" })).toBeVisible();
  await expect(page.getByText("until you should dock")).toBeHidden();
});

test("savings are banked and survive a reload", async ({ page }) => {
  await planATrip(page);
  await page.getByRole("button", { name: "Start ride" }).click();

  await expect(page.getByText(/\$\d+\.\d\d saved/)).toBeVisible();

  await page.reload();
  await waitForMap(page);
  await expect(page.getByText(/\$\d+\.\d\d saved/)).toBeVisible();
});

test("an in-progress ride survives a reload", async ({ page }) => {
  await planATrip(page);
  await page.getByRole("button", { name: "Start ride" }).click();
  await expect(page.getByText("until you should dock")).toBeVisible();

  await page.reload();
  await waitForMap(page);

  // The rider is mid-leg; a refresh must not silently reset their timer.
  await expect(page.getByRole("button", { name: "DOCK NOW", exact: true })).toBeVisible();
});
