import { expect, test } from "@playwright/test";

import { emptyMapPoint, HOME, mockApi, PLAN, waitForMap } from "./fixtures";

/**
 * Desktop browsers locate by WiFi and IP and can be miles out, which produced a
 * route starting in the Bronx for a rider in Morningside Heights. The start now
 * has to be visible and correctable.
 */

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("states where the route will start from", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  await expect(page.getByText("From", { exact: true })).toBeVisible();
  await expect(page.getByText("Your location")).toBeVisible();
});

test("shows the accuracy of the fix", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  await expect(page.getByText(/±\d+ m/)).toBeVisible();
});

test("the start can be moved by tapping the map", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  await page.getByRole("button", { name: "Change" }).click();
  await expect(page.getByText("Tap the map to set your start")).toBeVisible();

  const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 3);

  await expect(page.getByText("Dropped pin")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use my location" })).toBeVisible();
});

test("a dropped start is used for planning", async ({ page }) => {
  let plannedFrom: { lat: string | null; lon: string | null } | null = null;
  await page.route("**/api/plan**", async (route) => {
    const url = new URL(route.request().url());
    plannedFrom = { lat: url.searchParams.get("fromLat"), lon: url.searchParams.get("fromLon") };
    // Answered from the fixture, not continued. This handler is registered after
    // the one in mockApi and so wins, and continuing would reach the real
    // planner: a test about which coordinates get sent would then sit waiting on
    // live GBFS and Valhalla, and fail whenever they are slow.
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(PLAN),
    });
  });

  await page.goto("/");
  await waitForMap(page);

  await page.getByRole("button", { name: "Change" }).click();
  const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 4);
  await expect(page.getByText("Dropped pin")).toBeVisible();

  await page.getByPlaceholder("Where to? Or tap the map").fill("Bryant Park");
  await page.getByRole("button", { name: "Bryant Park, Manhattan" }).click();
  await page.getByRole("button", { name: "Plan route" }).click();
  await expect(page.getByRole("button", { name: "Start ride" })).toBeVisible();

  expect(plannedFrom).not.toBeNull();
  // The tap was north of the fix, so the planned start must differ from it.
  expect(Number(plannedFrom!.lat)).not.toBeCloseTo(HOME.lat, 4);
});

test("the rider can hand the start back to the browser", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  await page.getByRole("button", { name: "Change" }).click();
  const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 4);
  await expect(page.getByText("Dropped pin")).toBeVisible();

  await page.getByRole("button", { name: "Use my location" }).click();
  await expect(page.getByText("Your location")).toBeVisible();
});

test("picking a start can be cancelled", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  await page.getByRole("button", { name: "Change" }).click();
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(page.getByText("Tap the map to set your start")).toBeHidden();

  // A tap now sets the destination again, not the start.
  const point = await emptyMapPoint(page);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByText("Your location")).toBeVisible();
  await expect(page.getByRole("button", { name: "Plan route" })).toBeEnabled();
});

test("the start is pinned on the map before planning", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  // Generous: CI renders through software WebGL, which is far slower than a GPU.
  await expect
    .poll(() => page.locator(".maplibregl-marker").count(), { timeout: 30_000 })
    .toBeGreaterThan(0);
});
