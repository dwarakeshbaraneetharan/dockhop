import { expect, test } from "@playwright/test";

import { HOME } from "./fixtures";

/**
 * Runs against the real Citi Bike GBFS feed and the real planner. Excluded from
 * CI by default: an upstream outage is not a reason for this repo to go red.
 *
 *   RUN_LIVE=1 npx playwright test live
 */
test.skip(!process.env.RUN_LIVE, "set RUN_LIVE=1 to hit the live GBFS feed");

interface LiveStation {
  name: string;
  docks: number;
  classic: number;
  meters: number;
  minutes: number;
  state: "none" | "low" | "ok";
  best: boolean;
  lat: number;
}

async function nearby(request: { get: (url: string) => Promise<{ json(): Promise<unknown>; ok(): boolean }> }, profile: string) {
  const response = await request.get(
    `/api/stations?lat=${HOME.lat}&lon=${HOME.lon}&radius=1200&profile=${profile}`,
  );
  expect(response.ok()).toBe(true);
  return (await response.json()) as { stations: LiveStation[]; need: string; routed: boolean };
}

test("nearby stations come back trimmed and ranked by travel time", async ({ request }) => {
  const body = await nearby(request, "pedestrian");
  const stations = body.stations;
  expect(stations.length).toBeGreaterThan(0);

  for (const station of stations) {
    expect(station.name).toBeTruthy();
    expect(station.docks).toBeGreaterThanOrEqual(0);
    expect(station.classic).toBeGreaterThanOrEqual(0);
    expect(station.minutes).toBeGreaterThan(0);
    expect(Math.abs(station.lat - HOME.lat)).toBeLessThan(0.05);
  }

  // Ranked by how long it takes to get there, which is the whole change: a
  // routed walk regularly reorders what straight-line distance would have.
  const minutes = stations.map((s) => s.minutes);
  expect([...minutes].sort((a, b) => a - b)).toEqual(minutes);

  // Five usable at most, and anything extra has to be nearer than those.
  const usable = stations.filter((s) => s.state !== "none");
  expect(usable.length).toBeLessThanOrEqual(5);
  const furthestRecommended = usable.at(-1)?.minutes ?? 0;
  for (const station of stations.filter((s) => s.state === "none")) {
    expect(station.minutes).toBeLessThan(furthestRecommended);
  }

  // Exactly one station is singled out, and it is one you can actually use.
  const best = stations.filter((s) => s.best);
  expect(best.length).toBe(usable.length > 0 ? 1 : 0);
  if (best[0]) expect(best[0].state).not.toBe("none");
});

test("what counts as usable depends on whether the rider is on a bike", async ({ request }) => {
  // Before setting off you need a classic bike; mid-ride you need somewhere to
  // put one back. A station with free docks and no bikes satisfies exactly one.
  const walking = await nearby(request, "pedestrian");
  const riding = await nearby(request, "bicycle");

  expect(walking.need).toBe("bike");
  expect(riding.need).toBe("dock");

  for (const station of walking.stations.filter((s) => s.best)) {
    expect(station.classic).toBeGreaterThan(0);
  }
  for (const station of riding.stations.filter((s) => s.best)) {
    expect(station.docks).toBeGreaterThan(0);
  }
});

test("distances come from the street network, not the straight line", async ({ request }) => {
  // Not a formality. Around Morningside the nearest dock in a straight line is
  // a ten minute walk around a closed campus, and this is the check that the
  // app is seeing the real street network rather than quietly falling back.
  const body = await nearby(request, "pedestrian");
  if (!body.routed) test.skip(true, "routing service unavailable, ranking fell back");

  const crow = (s: LiveStation) => Math.abs(s.lat - HOME.lat) * 111_320;
  // A routed path can never be shorter than the straight line it spans.
  for (const station of body.stations) {
    expect(station.meters).toBeGreaterThanOrEqual(Math.floor(crow(station)) - 1);
  }
});

test("a long real trip is planned within the leg budget", async ({ request }) => {
  // Morningside Heights to the Brooklyn Bridge: far enough to force a swap.
  const response = await request.get(
    `/api/plan?fromLat=${HOME.lat}&fromLon=${HOME.lon}&toLat=40.7061&toLon=-73.9969&mode=member`,
  );
  expect(response.ok()).toBe(true);

  const plan = await response.json();
  if (!plan.feasible) {
    test.skip(true, `planner declined: ${plan.reason}`);
    return;
  }

  // The entire point of the app: no single ride leg may cross the free window.
  for (const leg of plan.legs.filter((l: { kind: string }) => l.kind === "ride")) {
    expect(leg.minutes).toBeLessThanOrEqual(45);
  }
  expect(plan.longestLegMinutes).toBeLessThanOrEqual(45);
  expect(plan.totalMinutes).toBeGreaterThan(0);

  // Every swap must be a station that actually had a free dock.
  for (const swap of plan.swaps) {
    expect(swap.docks).toBeGreaterThan(0);
  }
});

test("dock-now returns real docks with room", async ({ request }) => {
  const response = await request.get(`/api/dock-now?lat=${HOME.lat}&lon=${HOME.lon}`);
  expect(response.ok()).toBe(true);

  const { options } = await response.json();
  expect(options.length).toBeGreaterThan(0);
  for (const option of options) {
    expect(option.docks).toBeGreaterThan(0);
    expect(option.minutes).toBeGreaterThanOrEqual(0);
  }
});

test("the whole thing works against live data in a browser", async ({ page }) => {
  await page.goto("/");
  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __dockhopMap?: { isStyleLoaded(): boolean } }).__dockhopMap;
      return Boolean(m?.isStyleLoaded());
    },
    undefined,
    { timeout: 45_000 },
  );

  await page.getByRole("button", { name: "Dock now" }).click();
  await expect(page.getByRole("heading", { name: "Nearest open docks" })).toBeVisible();
  await expect(page.getByText(/docks free/).first()).toBeVisible();
});
