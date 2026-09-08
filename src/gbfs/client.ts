import type { Station } from "../planner/types";

import type { GbfsFeed, GbfsStationInformation, GbfsStationStatus } from "./types";

export const GBFS = {
  stationInformation: "https://gbfs.lyft.com/gbfs/1.1/bkn/en/station_information.json",
  stationStatus: "https://gbfs.lyft.com/gbfs/1.1/bkn/en/station_status.json",
} as const;

/**
 * Where a station sits is effectively static; how full it is changes constantly.
 * Splitting the cache lifetimes means the common request only moves the small feed.
 *
 * GBFS asks consumers not to poll faster than every 30 seconds. Caching status
 * at the edge for 30 seconds keeps the origin at one request per half minute no
 * matter how many riders are navigating, so the app stays a good citizen of a
 * feed that is published for free.
 */
export const CACHE_SECONDS = {
  stationInformation: 21_600,
  stationStatus: 30,
} as const;

export type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

export interface StationSnapshot {
  stations: Station[];
  fetchedAt: number;
  /** Oldest last_reported in the feed, in seconds. A staleness canary. */
  oldestReportAgeSeconds: number;
}

const truthy = (value: number | boolean): boolean => value === true || value === 1;

async function getFeed<T>(url: string, ttl: number, fetcher: Fetcher): Promise<GbfsFeed<T>> {
  const response = await fetcher(url, {
    // Honoured by the Workers runtime; ignored elsewhere, which is fine in tests.
    cf: { cacheTtl: ttl, cacheEverything: true },
    headers: { accept: "application/json" },
  } as RequestInit);

  if (!response.ok) {
    throw new Error(`GBFS ${url} responded ${response.status}`);
  }
  return (await response.json()) as GbfsFeed<T>;
}

/**
 * Join the static and live feeds into the shape the planner consumes.
 *
 * Stations present in one feed but not the other are dropped rather than
 * defaulted. A station with no status is one we know nothing about, and guessing
 * that it has docks is exactly the guess that strands a rider.
 */
export function mergeStations(
  information: GbfsStationInformation[],
  status: GbfsStationStatus[],
): Station[] {
  const byId = new Map(information.map((s) => [s.station_id, s]));
  const stations: Station[] = [];

  for (const live of status) {
    const info = byId.get(live.station_id);
    if (!info) continue;

    const ebikes = live.num_ebikes_available ?? 0;
    stations.push({
      id: live.station_id,
      name: info.name,
      lat: info.lat,
      lon: info.lon,
      capacity: info.capacity ?? 0,
      docksAvailable: Math.max(0, live.num_docks_available),
      classicAvailable: Math.max(0, live.num_bikes_available - ebikes),
      ebikesAvailable: ebikes,
      operational:
        truthy(live.is_installed) && truthy(live.is_renting) && truthy(live.is_returning),
      lastReported: live.last_reported,
    });
  }
  return stations;
}

export async function fetchStations(fetcher: Fetcher = fetch): Promise<StationSnapshot> {
  const [information, status] = await Promise.all([
    getFeed<{ stations: GbfsStationInformation[] }>(
      GBFS.stationInformation,
      CACHE_SECONDS.stationInformation,
      fetcher,
    ),
    getFeed<{ stations: GbfsStationStatus[] }>(
      GBFS.stationStatus,
      CACHE_SECONDS.stationStatus,
      fetcher,
    ),
  ]);

  const stations = mergeStations(information.data.stations, status.data.stations);
  const now = Math.floor(Date.now() / 1000);
  const newest = stations.reduce((max, s) => Math.max(max, s.lastReported), 0);

  return {
    stations,
    fetchedAt: now,
    oldestReportAgeSeconds: newest > 0 ? Math.max(0, now - newest) : 0,
  };
}
