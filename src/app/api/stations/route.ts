import { haversineMeters } from "@/planner/geo";
import { selectNearbyDocks, type DockNeed } from "@/planner/nearby";
import { travelMatrix, type RouteProfile, type RoutedLeg } from "@/planner/routing";
import { walkingSeconds } from "@/planner/travel";
import { DEFAULT_PLAN_OPTIONS } from "@/planner/types";

import { badRequest, coord, LIVE_CACHE_HEADER, loadStations } from "../_shared";

export const dynamic = "force-dynamic";

const MAX_RADIUS_METERS = 5_000;

/**
 * How many docks to route before ranking. Valhalla's matrix latency is nearly
 * flat in target count, so this is bounded by politeness rather than speed.
 */
const ROUTE_CANDIDATES = 40;

/**
 * Docks worth showing near a point, ranked by how long it actually takes to
 * reach them.
 *
 * Straight-line ranking is wrong often enough in New York to matter: rivers,
 * rail cuts and closed campuses regularly turn the nearest dot on the map into
 * the longest walk on the block. Routing the shortlist and sorting on the
 * result is the difference between a dock suggestion and a good one.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = coord(params, "lat");
  const lon = coord(params, "lon");
  if (lat === null || lon === null) return badRequest("lat and lon are required");

  const radius = Math.min(coord(params, "radius") ?? 1500, MAX_RADIUS_METERS);
  // Riding once the trip is under way, walking before it starts. Which also
  // decides what counts as a usable station: somewhere to pick a bike up, or
  // somewhere to put one back.
  const riding = params.get("profile") === "bicycle";
  const profile: RouteProfile = riding ? "bicycle" : "pedestrian";
  const need: DockNeed = riding ? "dock" : "bike";

  const snapshot = await loadStations();
  if (snapshot instanceof Response) return snapshot;

  const origin = { lat, lon };
  const shortlist = snapshot.stations
    .filter((s) => s.operational)
    .map((station) => ({ station, meters: haversineMeters(origin, station) }))
    .filter((entry) => entry.meters <= radius)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, ROUTE_CANDIDATES);

  const matrix = await travelMatrix(
    origin,
    shortlist.map((entry) => entry.station),
    profile,
  );

  const entries = shortlist.map((entry, index) => {
    const routed = matrix?.[index] ?? null;
    const travel: RoutedLeg = routed ?? {
      // Bikes are not the point of this fallback; it exists so a routing
      // outage degrades the ranking rather than emptying the map.
      seconds: walkingSeconds(entry.meters, DEFAULT_PLAN_OPTIONS.walkSpeedMps),
      meters: entry.meters,
    };
    return { station: entry.station, travel, routed: routed !== null };
  });

  const docks = selectNearbyDocks(entries, need).map((dock) => ({
    id: dock.station.id,
    name: dock.station.name,
    lat: dock.station.lat,
    lon: dock.station.lon,
    docks: dock.station.docksAvailable,
    classic: dock.station.classicAvailable,
    ebikes: dock.station.ebikesAvailable,
    capacity: dock.station.capacity,
    meters: Math.round(dock.travel.meters),
    minutes: Math.max(1, Math.round(dock.travel.seconds / 60)),
    state: dock.state,
    best: dock.best,
    routed: dock.routed,
  }));

  return Response.json(
    { stations: docks, profile, need, routed: matrix !== null, fetchedAt: snapshot.fetchedAt },
    { headers: LIVE_CACHE_HEADER },
  );
}
