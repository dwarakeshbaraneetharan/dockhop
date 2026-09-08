import type { LatLon, Station } from "@/planner/types";

/** Roughly Columbia's campus and the Brooklyn Bridge, about 11 km apart. */
export const MORNINGSIDE: LatLon = { lat: 40.8075, lon: -73.9626 };
export const BROOKLYN_BRIDGE: LatLon = { lat: 40.7061, lon: -73.9969 };

export function makeStation(
  id: string,
  lat: number,
  lon: number,
  overrides: Partial<Station> = {},
): Station {
  return {
    id,
    name: `Station ${id}`,
    lat,
    lon,
    capacity: 30,
    docksAvailable: 15,
    classicAvailable: 10,
    ebikesAvailable: 2,
    operational: true,
    lastReported: 1_756_000_000,
    ...overrides,
  };
}

/**
 * Stations spaced along the line from `a` to `b`, with a lateral jitter so the
 * corridor filter has something to reject.
 */
export function stationsAlong(
  a: LatLon,
  b: LatLon,
  count: number,
  overrides: Partial<Station> = {},
): Station[] {
  const stations: Station[] = [];
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const wobble = (i % 3) - 1;
    stations.push(
      makeStation(
        `s${i}`,
        a.lat + (b.lat - a.lat) * t + wobble * 0.0009,
        a.lon + (b.lon - a.lon) * t + wobble * 0.0009,
        overrides,
      ),
    );
  }
  return stations;
}

/** Deterministic PRNG so a failing property test can be replayed. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}
