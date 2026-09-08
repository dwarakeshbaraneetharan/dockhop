import { expect, test } from "@playwright/test";

import { emptyMapPoint, mockApi, STATIONS, waitForMap } from "./fixtures";

/**
 * The dock layer: what gets drawn, which one is singled out, and what a tap
 * tells you. Ranking itself is unit tested; this is about it reaching the map.
 */

test.beforeEach(async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await waitForMap(page);
});

type Page = import("@playwright/test").Page;

/** Feature properties for the rendered dock dots. */
async function renderedDocks(page: Page) {
  return page.evaluate(() => {
    const map = (window as unknown as {
      __dockhopMap?: { queryRenderedFeatures(o: unknown): Array<{ properties: Record<string, unknown> }> };
    }).__dockhopMap;
    return (map?.queryRenderedFeatures({ layers: ["station-dots"] }) ?? []).map((f) => f.properties);
  });
}

/** Dock data arrives after the style does, so clicks have to wait for it. */
async function waitForDocks(page: Page) {
  await expect
    .poll(async () => (await renderedDocks(page)).length, { timeout: 30_000 })
    .toBeGreaterThan(0);
}

/** Where a given station currently sits on screen. */
async function dockPoint(page: Page, station: { lat: number; lon: number }) {
  await waitForDocks(page);
  const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
  const point = await page.evaluate(
    ({ lat, lon }) => {
      const map = (window as unknown as {
        __dockhopMap?: { project(c: [number, number]): { x: number; y: number } };
      }).__dockhopMap!;
      return map.project([lon, lat]);
    },
    { lat: station.lat, lon: station.lon },
  );
  return { x: box.x + point.x, y: box.y + point.y };
}

test("draws every dock the endpoint returned and nothing more", async ({ page }) => {
  // The trimming happens server-side, so the map's job is to draw that set
  // faithfully rather than filter again.
  await expect.poll(async () => (await renderedDocks(page)).length, { timeout: 30_000 })
    .toBe(STATIONS.length);
});

test("singles out exactly one station, and it is one you can use", async ({ page }) => {
  await waitForDocks(page);

  const docks = await renderedDocks(page);
  const best = docks.filter((d) => d.best === true);
  expect(best).toHaveLength(1);
  expect(best[0].state).not.toBe("none");
  // The halo is what makes it read at a glance.
  const halo = await page.evaluate(() => {
    const map = (window as unknown as {
      __dockhopMap?: { queryRenderedFeatures(o: unknown): unknown[] };
    }).__dockhopMap;
    return map?.queryRenderedFeatures({ layers: ["station-best-halo"] }).length ?? 0;
  });
  expect(halo).toBe(1);
});

test("keeps a closer unusable station so the detour is explained", async ({ page }) => {
  await waitForDocks(page);

  const docks = await renderedDocks(page);
  const unusable = docks.filter((d) => d.state === "none");
  expect(unusable.length).toBeGreaterThan(0);

  // Every one of them is quicker to reach than the furthest recommendation.
  const furthest = Math.max(
    ...docks.filter((d) => d.state !== "none").map((d) => Number(d.minutes)),
  );
  for (const dock of unusable) expect(Number(dock.minutes)).toBeLessThan(furthest);
});

test("tapping a dock names it, times it and counts what is in it", async ({ page }) => {
  const target = STATIONS[0];
  const point = await dockPoint(page, target);
  await page.mouse.click(point.x, point.y);

  const popup = page.locator(".maplibregl-popup");
  await expect(popup).toBeVisible();
  await expect(popup).toContainText(target.name);
  await expect(popup).toContainText(`${target.minutes} min walk`);
  await expect(popup).toContainText(`${target.docks} free docks`);
  await expect(popup).toContainText(`${target.classic} classic bike`);
});

test("tapping a dock does not also drop a destination pin under the popup", async ({ page }) => {
  const point = await dockPoint(page, STATIONS[0]);

  const before = await page.locator(".maplibregl-marker").count();
  await page.mouse.click(point.x, point.y);

  await expect(page.locator(".maplibregl-popup")).toBeVisible();
  expect(await page.locator(".maplibregl-marker").count()).toBe(before);
});

test("tapping the map away from a dock still sets a destination", async ({ page }) => {
  const point = await emptyMapPoint(page);
  await page.mouse.click(point.x, point.y);

  await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Plan route" })).toBeEnabled();
});

test("a tap while placing a start point sets it even on top of a dock", async ({ page }) => {
  await page.getByRole("button", { name: "Change" }).click();

  const point = await dockPoint(page, STATIONS[0]);
  await page.mouse.click(point.x, point.y);

  // Placing a point is an explicit mode, so it outranks the dock popup.
  await expect(page.locator(".maplibregl-popup")).toHaveCount(0);
  await expect(page.getByText("Dropped pin")).toBeVisible();
});
