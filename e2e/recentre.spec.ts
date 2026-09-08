import { expect, test } from "@playwright/test";

import { emptyMapPoint, HOME, mockApi, waitForMap } from "./fixtures";

/** The corner button that snaps the map back to the rider. */

type Page = import("@playwright/test").Page;

async function camera(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as {
      __dockhopMap?: { getCenter(): { lat: number; lng: number }; getZoom(): number };
    }).__dockhopMap!;
    const centre = map.getCenter();
    return { lat: centre.lat, lon: centre.lng, zoom: map.getZoom() };
  });
}

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await waitForMap(page);
});

test("brings the map back after panning away", async ({ page }) => {
  const button = page.getByRole("button", { name: "Centre on my location" });
  await expect(button).toBeEnabled();

  await page.evaluate(() => {
    const map = (window as unknown as {
      __dockhopMap?: { jumpTo(o: unknown): void };
    }).__dockhopMap!;
    map.jumpTo({ center: [-73.85, 40.68], zoom: 11 });
  });
  expect((await camera(page)).lat).toBeLessThan(40.7);

  await button.click();
  await expect
    .poll(async () => Math.abs((await camera(page)).lat - HOME.lat) < 0.002, { timeout: 10_000 })
    .toBe(true);

  const after = await camera(page);
  expect(Math.abs(after.lon - HOME.lon)).toBeLessThan(0.002);
  // Zoomed in, not just re-centred at whatever zoom it was left at.
  expect(after.zoom).toBeGreaterThan(15);
});

test("sits above the sheet rather than under it", async ({ page }) => {
  const button = page.getByRole("button", { name: "Centre on my location" });
  const sheet = page.getByRole("button", { name: "Dock now" });

  const buttonBox = (await button.boundingBox())!;
  const sheetBox = (await sheet.boundingBox())!;
  expect(buttonBox.y + buttonBox.height).toBeLessThanOrEqual(sheetBox.y);

  // And it is actually clickable there, not covered by an invisible layer.
  await expect(button).toBeVisible();
  await button.click();
});

test("stays out of the way of tapping the map", async ({ page }) => {
  // The column it lives in must not swallow taps meant for the map behind it.
  const point = await emptyMapPoint(page);
  await page.mouse.click(point.x, point.y);
  await expect(page.getByRole("button", { name: "Plan route" })).toBeEnabled();
});

test("is still there during a ride, when it matters most", async ({ page }) => {
  await page.getByPlaceholder("Where to? Or tap the map").fill("Bryant Park");
  await page.getByRole("button", { name: "Bryant Park, Manhattan" }).click();
  await page.getByRole("button", { name: "Plan route" }).click();
  await page.getByRole("button", { name: "Start ride" }).click();
  await expect(page.getByText("until you should dock")).toBeVisible();

  await expect(page.getByRole("button", { name: "Centre on my location" })).toBeVisible();
});
