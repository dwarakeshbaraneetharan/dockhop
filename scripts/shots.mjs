/** Screenshots of the real app against live data, for the README and for eyeballing. */

import { chromium, devices } from "@playwright/test";
import { mkdirSync } from "node:fs";

const URL = process.argv[2] ?? "http://localhost:3100";
mkdirSync("data/shots", { recursive: true });

const browser = await chromium.launch();

async function shot(name, deviceName, steps) {
  const context = await browser.newContext({
    ...devices[deviceName],
    permissions: ["geolocation"],
    geolocation: { latitude: 40.8075, longitude: -73.9626 },
    locale: "en-US",
  });
  const page = await context.newPage();
  await page.goto(URL, { waitUntil: "load" });
  await page
    .waitForFunction(() => window.__dockhopMap?.isStyleLoaded?.(), undefined, { timeout: 45_000 })
    .catch(() => {});
  await page.waitForTimeout(4000);

  if (steps) await steps(page);

  await page.screenshot({ path: `data/shots/${name}.png` });
  console.log(`data/shots/${name}.png`);
  await context.close();
}

await shot("home-mobile", "iPhone 13");
await shot("home-desktop", "Desktop Chrome");

await shot("plan-mobile", "iPhone 13", async (page) => {
  await page.getByPlaceholder("Where to? Or tap the map").fill("Brooklyn Bridge");
  await page.waitForTimeout(1800);
  const option = page.getByRole("button", { name: /Brooklyn Bridge/ }).first();
  if (await option.isVisible().catch(() => false)) {
    await option.click();
  } else {
    // Geocoder unavailable: drop a far pin instead so the shot still shows a route.
    const box = (await page.locator(".maplibregl-canvas").boundingBox());
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 40);
  }
  await page.getByRole("button", { name: "Plan route" }).click();
  await page.getByRole("button", { name: "Start ride" }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(2500);
});

// The docks around the start, ranked by routed walking time, with the pick ringed
// and one opened to show what a tap gives you.
await shot("docks-mobile", "iPhone 13", async (page) => {
  const best = await page.evaluate(() => {
    const map = window.__dockhopMap;
    const [feature] = map.querySourceFeatures("stations", {
      filter: ["==", ["get", "best"], true],
    });
    if (!feature) return null;
    const point = map.project(feature.geometry.coordinates);
    return { x: point.x, y: point.y };
  });
  if (best) {
    await page.mouse.click(best.x, best.y);
    await page.waitForTimeout(1200);
  }
});

// The ranked list, which is the screenshot that earns the paragraph about a
// further dock outranking a nearer one.
await shot("docknow-mobile", "iPhone 13", async (page) => {
  await page.getByRole("button", { name: "Dock now" }).click();
  await page.getByRole("heading", { name: "Nearest open docks" }).waitFor({ timeout: 20_000 });
  await page.waitForTimeout(1200);
});

await shot("ride-mobile", "iPhone 13", async (page) => {
  await page.getByPlaceholder("Where to? Or tap the map").fill("Brooklyn Bridge");
  await page.waitForTimeout(1800);
  const option = page.getByRole("button", { name: /Brooklyn Bridge/ }).first();
  if (await option.isVisible().catch(() => false)) await option.click();
  else {
    const box = await page.locator(".maplibregl-canvas").boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 40);
  }
  await page.getByRole("button", { name: "Plan route" }).click();
  await page.getByRole("button", { name: "Start ride" }).click();
  await page.waitForTimeout(2500);
});

await browser.close();
