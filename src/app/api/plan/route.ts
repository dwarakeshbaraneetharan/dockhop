import { haversineMeters } from "@/planner/geo";
import { getMode } from "@/planner/modes";
import { planTrip, type RoutedWalks } from "@/planner/plan";
import { travelMatrix, type RoutedLeg } from "@/planner/routing";
import { DEFAULT_TRAVEL_MODEL } from "@/planner/travel";
import { DEFAULT_PLAN_OPTIONS, type LatLon, type Station } from "@/planner/types";

import { badRequest, coord, LIVE_CACHE_HEADER, loadStations } from "../_shared";

export const dynamic = "force-dynamic";

/** Per end of the trip. Two matrix calls per plan, each one cheap. */
const WALK_CANDIDATES = 25;

/**
 * Real walking routes to the docks at either end.
 *
 * Only the ends are routed. The interior of the search evaluates thousands of
 * ride edges and stays on the fitted travel model, which is what keeps this
 * inside a free tier. The ends are where the straight line does its damage
 * anyway, because that is where somebody is on foot and a river or a closed
 * campus turns two hundred metres into a ten minute walk.
 */
async function routedWalks(
  origin: LatLon,
  destination: LatLon,
  stations: Station[],
): Promise<RoutedWalks> {
  const nearest = (point: LatLon, keep: (s: Station) => boolean) =>
    stations
      .filter((s) => s.operational && keep(s))
      .map((station) => ({ station, meters: haversineMeters(point, station) }))
      .filter((entry) => entry.meters <= DEFAULT_PLAN_OPTIONS.maxWalkMeters)
      .sort((a, b) => a.meters - b.meters)
      .slice(0, WALK_CANDIDATES)
      .map((entry) => entry.station);

  // A trip starts at a dock holding a classic bike and ends at one with room.
  const starts = nearest(origin, (s) => s.classicAvailable > 0);
  const ends = nearest(destination, (s) => s.docksAvailable > 0);

  const [fromOrigin, toDestination] = await Promise.all([
    travelMatrix(origin, starts, "pedestrian"),
    // Walking routes are symmetric enough to ask from the destination outward.
    travelMatrix(destination, ends, "pedestrian"),
  ]);

  const collect = (list: Station[], matrix: Array<RoutedLeg | null> | null) => {
    const map = new Map<string, RoutedLeg>();
    if (!matrix) return map;
    list.forEach((station, index) => {
      const leg = matrix[index];
      if (leg) map.set(station.id, leg);
    });
    return map;
  };

  return {
    fromOrigin: collect(starts, fromOrigin),
    toDestination: collect(ends, toDestination),
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  const fromLat = coord(params, "fromLat");
  const fromLon = coord(params, "fromLon");
  const toLat = coord(params, "toLat");
  const toLon = coord(params, "toLon");

  if (fromLat === null || fromLon === null || toLat === null || toLon === null) {
    return badRequest("fromLat, fromLon, toLat and toLon are required");
  }

  const mode = getMode(params.get("mode"));
  const snapshot = await loadStations();
  if (snapshot instanceof Response) return snapshot;

  const origin = { lat: fromLat, lon: fromLon };
  const destination = { lat: toLat, lon: toLon };

  const result = planTrip({
    origin,
    destination,
    mode,
    stations: snapshot.stations,
    model: DEFAULT_TRAVEL_MODEL,
    walks: await routedWalks(origin, destination, snapshot.stations),
  });

  // An unroutable trip is a real answer about the network, not a server error.
  if (!result.feasible) {
    return Response.json(
      { feasible: false, reason: result.reason, message: result.message },
      { status: 200, headers: LIVE_CACHE_HEADER },
    );
  }

  return Response.json(
    {
      feasible: true,
      mode: result.mode.id,
      swaps: result.swaps.map((swap) => ({
        stationId: swap.station.id,
        name: swap.station.name,
        lat: swap.station.lat,
        lon: swap.station.lon,
        arrivesAtMinute: swap.arrivesAtMinute,
        legMinutes: swap.legMinutes,
        docks: swap.docksAvailable,
      })),
      start: { id: result.startStation.id, name: result.startStation.name, lat: result.startStation.lat, lon: result.startStation.lon },
      end: { id: result.endStation.id, name: result.endStation.name, lat: result.endStation.lat, lon: result.endStation.lon },
      legs: result.legs.map((leg) => ({
        kind: leg.kind,
        from: { lat: leg.from.lat, lon: leg.from.lon, name: leg.from.name },
        to: { lat: leg.to.lat, lon: leg.to.lon, name: leg.to.name },
        minutes: Math.round(leg.seconds / 60),
        meters: Math.round(leg.meters),
      })),
      totalMinutes: Math.round(result.totalSeconds / 60),
      ridingMinutes: Math.round(result.ridingSeconds / 60),
      walkingMinutes: Math.round(result.walkingSeconds / 60),
      longestLegMinutes: Math.round(result.longestLegSeconds / 60),
      savingsUsd: result.savings.usd,
      overageMinutesAvoided: result.savings.overageMinutes,
      fetchedAt: snapshot.fetchedAt,
    },
    { headers: LIVE_CACHE_HEADER },
  );
}
