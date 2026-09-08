import type { LatLon } from "./types";

/**
 * Routed travel times, for the decisions where a straight line lies.
 *
 * Straight-line distance picks the wrong dock surprisingly often in New York.
 * From Morningside Heights the nearest station by straight line is 148 m away
 * and an 861 m walk, because Columbia's campus sits between the two, while a
 * station 179 m away is a 250 m walk. Crow flies sends the rider on a ten
 * minute detour to reach the dock that looked closer.
 *
 * Only used where the number of routes is small: which dock to walk to at each
 * end of a trip, and which dock to ride to when one is needed mid-ride. The
 * planner's interior ride edges stay on the fitted model, because the search
 * evaluates thousands of them and no free routing service would survive that.
 */

export type RouteProfile = "pedestrian" | "bicycle";

export interface RoutedLeg {
  seconds: number;
  meters: number;
}

/** FOSSGIS's public Valhalla. No key, and it has real foot and bike profiles. */
const ENDPOINT = "https://valhalla1.openstreetmap.de/sources_to_targets";

/** Its matrix latency is nearly flat in target count, about 350 ms at 60. */
export const MAX_TARGETS = 60;

const TIMEOUT_MS = 4_000;

/** Street layouts do not change, so a hit here is as good as a fresh call. */
const CACHE_SECONDS = 21_600;

/**
 * Snapped so a stationary phone whose GPS drifts by a few metres keeps hitting
 * the same cache entry instead of asking a community server to recompute the
 * same matrix. Four decimals is about 11 m, well inside walking noise.
 */
function snap(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

interface ValhallaTarget {
  time?: number | null;
  distance?: number | null;
}

/**
 * Keep the point off ferry routes when it is matched to the network.
 *
 * A coordinate on the waterfront will happily snap to a ferry line, and the
 * router then answers as though the rider were aboard. Asking for a walk from
 * the Brooklyn Bridge to a dock 615 m away came back as 10.9 km along the
 * Seastreak route to New Jersey; excluding ferry edges from the match returns
 * 2.1 km on foot. Every inland case is unchanged by it.
 */
const LAND_ONLY = { search_filter: { exclude_ferry: true } };

/**
 * One-to-many travel times. Resolves to null if the service cannot be reached,
 * and to null per target for anywhere it cannot route to, so every caller has
 * to carry a straight-line fallback. Routing is an improvement here, never a
 * dependency: a rider should still get a plan when Valhalla is down.
 */
export async function travelMatrix(
  origin: LatLon,
  targets: LatLon[],
  profile: RouteProfile,
  fetcher: typeof fetch = fetch,
): Promise<Array<RoutedLeg | null> | null> {
  if (targets.length === 0) return [];
  if (targets.length > MAX_TARGETS) targets = targets.slice(0, MAX_TARGETS);

  const payload = {
    sources: [{ lat: snap(origin.lat), lon: snap(origin.lon), ...LAND_ONLY }],
    targets: targets.map((t) => ({ lat: t.lat, lon: t.lon, ...LAND_ONLY })),
    costing: profile,
  };

  try {
    const response = await fetcher(
      `${ENDPOINT}?json=${encodeURIComponent(JSON.stringify(payload))}`,
      {
        headers: { accept: "application/json", "user-agent": "dockhop (github.com/dockhop)" },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        // Honoured by the Workers runtime, ignored elsewhere.
        cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
      } as RequestInit,
    );
    if (!response.ok) return null;

    const body = (await response.json()) as {
      sources_to_targets?: ValhallaTarget[][];
    };
    const row = body.sources_to_targets?.[0];
    if (!row) return null;

    return targets.map((_, index) => {
      const cell = row[index];
      if (!cell || cell.time == null || cell.distance == null) return null;
      // Valhalla reports distance in kilometres.
      return { seconds: cell.time, meters: cell.distance * 1000 };
    });
  } catch {
    // Timeout, network error, malformed body: all mean "no routing this time".
    return null;
  }
}
