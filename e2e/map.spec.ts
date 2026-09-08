import { expect, test } from "@playwright/test";

import { HOME, mockApi, waitForMap } from "./fixtures";

/**
 * These guard three failures that all presented as "the map is blank" and none
 * of which raised a console error:
 *
 *  1. MapLibre's stylesheet loads after Tailwind and sets
 *     `.maplibregl-map { position: relative }`, which beat `absolute inset-0`
 *     at equal specificity and collapsed the container to zero height.
 *  2. Next.js could not emit MapLibre v6's module worker, so vector tiles were
 *     never requested and the style never finished loading.
 *  3. Data effects gated on a ref that never re-ran, so stations that arrived
 *     before the style finished loading were dropped for good.
 */

test.beforeEach(async ({ page }) => {
  await mockApi(page);
});

test("map canvas fills the viewport", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  const size = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>(".maplibregl-canvas");
    return canvas ? { w: canvas.clientWidth, h: canvas.clientHeight } : null;
  });
  const viewport = page.viewportSize()!;

  expect(size).not.toBeNull();
  // The collapse bug left the element in place with a height of exactly 0.
  expect(size!.h).toBeGreaterThan(viewport.height * 0.5);
  expect(size!.w).toBeGreaterThan(viewport.width * 0.5);
});

test("vector tiles are requested, so the worker is wired up", async ({ page }) => {
  const tiles: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes(".pbf")) tiles.push(r.url());
  });

  await page.goto("/");
  await waitForMap(page);

  // A broken worker leaves this at zero indefinitely.
  await expect.poll(() => tiles.length, { timeout: 30_000 }).toBeGreaterThan(0);
});

test("station dots render despite arriving before the style loads", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const m = (window as unknown as {
            __dockhopMap?: { queryRenderedFeatures(o: unknown): unknown[] };
          }).__dockhopMap;
          return m?.queryRenderedFeatures({ layers: ["station-dots"] }).length ?? 0;
        }),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
});

test("opens centred on the rider rather than a hardcoded default", async ({ page }) => {
  await page.goto("/");
  await waitForMap(page);

  await expect
    .poll(async () => {
      const centre = await page.evaluate(() => {
        const m = (window as unknown as {
          __dockhopMap?: { getCenter(): { lat: number; lng: number } };
        }).__dockhopMap;
        const c = m?.getCenter();
        return c ? { lat: c.lat, lon: c.lng } : null;
      });
      return centre ? Math.hypot(centre.lat - HOME.lat, centre.lon - HOME.lon) : 999;
    })
    .toBeLessThan(0.01);
});

test("loads with a clean console", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));

  await page.goto("/");
  await waitForMap(page);
  await page.waitForTimeout(3000);

  expect(errors).toEqual([]);
});
