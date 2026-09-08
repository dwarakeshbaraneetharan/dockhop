import type { Page } from "@playwright/test";

/**
 * Fixed API responses so UI tests assert on the app rather than on whatever
 * Citi Bike happens to be doing. Live-data coverage lives in live.spec.ts.
 */

export const HOME = { lat: 40.8075, lon: -73.9626 };

/**
 * Spread tightly enough that the whole set is inside the map at zoom 14 on the
 * narrowest viewport under test, and far enough apart that a tap lands on the
 * dock it was aimed at. About 165 m between neighbours, or 23 screen pixels.
 */
function station(i: number, over: Partial<Record<string, unknown>> = {}) {
  return {
    id: `st-${i}`,
    name: `Test Station ${i}`,
    lat: HOME.lat - i * 0.0015,
    lon: HOME.lon + i * 0.0008,
    docks: 8,
    classic: 5,
    ebikes: 1,
    capacity: 20,
    // Routed rather than straight-line, so it need not agree with the geometry.
    meters: 120 + i * 400,
    minutes: 3 + i * 4,
    state: "ok",
    best: false,
    routed: true,
    ...over,
  };
}

/**
 * Already trimmed and ranked, which is what the endpoint now returns: the few
 * quickest usable stations, plus any nearer ones that cannot be used.
 */
export const STATIONS = [
  // Nearer than anything recommended and unusable, which is why it is drawn.
  station(1, { name: "W 110 St & Amsterdam Ave", classic: 0, state: "none", meters: 80, minutes: 1 }),
  station(2, { name: "Central Park West & W 102 St", classic: 2, state: "low", meters: 150, minutes: 2 }),
  station(0, { name: "Amsterdam Ave & W 119 St", meters: 250, minutes: 3, best: true }),
  ...Array.from({ length: 4 }, (_, k) => station(k + 3)),
];

export const PLAN = {
  feasible: true,
  mode: "member",
  swaps: [
    {
      stationId: "st-6",
      name: "Swap Dock: 5 Ave & E 78 St",
      lat: 40.7755,
      lon: -73.9626,
      arrivesAtMinute: 33,
      legMinutes: 33,
      docks: 11,
    },
  ],
  start: { id: "st-0", name: "Amsterdam Ave & W 119 St", lat: HOME.lat, lon: HOME.lon },
  end: { id: "st-9", name: "Broadway & W 41 St", lat: 40.7566, lon: -73.9863 },
  legs: [
    {
      kind: "walk",
      from: { ...HOME, name: "You" },
      to: { lat: HOME.lat, lon: HOME.lon, name: "Amsterdam Ave & W 119 St" },
      minutes: 2,
      meters: 90,
    },
    {
      kind: "ride",
      from: { lat: HOME.lat, lon: HOME.lon, name: "Amsterdam Ave & W 119 St" },
      to: { lat: 40.7755, lon: -73.9626, name: "Swap Dock: 5 Ave & E 78 St" },
      minutes: 33,
      meters: 3600,
    },
    {
      kind: "ride",
      from: { lat: 40.7755, lon: -73.9626, name: "Swap Dock: 5 Ave & E 78 St" },
      to: { lat: 40.7566, lon: -73.9863, name: "Broadway & W 41 St" },
      minutes: 18,
      meters: 2400,
    },
  ],
  totalMinutes: 53,
  ridingMinutes: 51,
  walkingMinutes: 2,
  longestLegMinutes: 33,
  savingsUsd: 1.7,
  overageMinutesAvoided: 6,
  fetchedAt: Date.now(),
};

/**
 * Ranked, not sorted by distance. The first is further and slower than the
 * second and still wins, because the second is nearly full: the exact ordering
 * that looks like a bug until the list says why.
 */
export const DOCK_OPTIONS = [
  { id: "st-0", name: "Amsterdam Ave & W 119 St", lat: HOME.lat, lon: HOME.lon, docks: 8, meters: 545, minutes: 2, tight: false },
  { id: "st-4", name: "W 116 St & Broadway", lat: 40.8045, lon: -73.9645, docks: 2, meters: 323, minutes: 1, tight: true },
  { id: "st-5", name: "Lincoln Ave & E 138 St", lat: 40.8025, lon: -73.9265, docks: 6, meters: 840, minutes: 3, tight: false },
];

interface MockOptions {
  stations?: unknown;
  plan?: unknown;
  dockOptions?: unknown;
  planStatus?: number;
}

/** Intercepts every DockHop endpoint. Map tiles still come from the network. */
export async function mockApi(page: Page, options: MockOptions = {}) {
  const json = (body: unknown, status = 200) => ({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

  await page.route("**/api/stations**", (route) =>
    route.fulfill(json({ stations: options.stations ?? STATIONS, fetchedAt: Date.now() })),
  );
  await page.route("**/api/plan**", (route) =>
    route.fulfill(json(options.plan ?? PLAN, options.planStatus ?? 200)),
  );
  await page.route("**/api/dock-now**", (route) =>
    route.fulfill(json({ options: options.dockOptions ?? DOCK_OPTIONS })),
  );
  await page.route("**/api/geocode**", (route) =>
    route.fulfill(
      json({
        results: [
          { label: "Bryant Park, Manhattan", lat: 40.7536, lon: -73.9832 },
          { label: "Bryant Park Cafe, Manhattan", lat: 40.7538, lon: -73.983 },
        ],
      }),
    ),
  );
}

/**
 * A point on the canvas with no dock under it.
 *
 * Tapping a dock opens its popup rather than dropping a pin, so any test about
 * pin placement has to aim somewhere empty. The mocked stations all run south
 * and east of centre, which leaves the north-west quadrant clear.
 */
export async function emptyMapPoint(page: Page) {
  const box = (await page.locator(".maplibregl-canvas").boundingBox())!;
  return { x: box.x + box.width * 0.25, y: box.y + box.height * 0.3 };
}

/** Resolves once MapLibre has a style up and has stopped loading tiles. */
export async function waitForMap(page: Page) {
  // Checked first so a machine without WebGL reports that, rather than every
  // test in the suite silently burning its full timeout.
  const webgl = await page.evaluate(() => {
    const probe = document.createElement("canvas");
    return Boolean(probe.getContext("webgl2") ?? probe.getContext("webgl"));
  });
  if (!webgl) throw new Error("no WebGL in this browser: MapLibre cannot render here");

  await page.waitForFunction(
    () => {
      const m = (window as unknown as { __dockhopMap?: { isStyleLoaded(): boolean } }).__dockhopMap;
      return Boolean(m?.isStyleLoaded());
    },
    undefined,
    { timeout: 45_000 },
  );
}
