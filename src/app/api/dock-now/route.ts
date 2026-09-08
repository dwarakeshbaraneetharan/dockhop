import { DEFAULT_DOCK_NOW_OPTIONS, rankNearbyDocks } from "@/planner/docknow";
import { haversineMeters } from "@/planner/geo";
import { travelMatrix, type RoutedLeg } from "@/planner/routing";
import { DEFAULT_TRAVEL_MODEL } from "@/planner/travel";

import { badRequest, coord, LIVE_CACHE_HEADER, loadStations } from "../_shared";

export const dynamic = "force-dynamic";

const ROUTE_CANDIDATES = 25;

/**
 * Where to dock right now, best first.
 *
 * Returns a ranked list rather than one answer so the client holds fallbacks
 * locally. When a poll shows the target filling up it can switch immediately
 * instead of waiting on another round trip.
 */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const lat = coord(params, "lat");
  const lon = coord(params, "lon");
  if (lat === null || lon === null) return badRequest("lat and lon are required");

  const snapshot = await loadStations();
  if (snapshot instanceof Response) return snapshot;

  // Route the plausible ones first: the rider is on a bike, so these follow the
  // streets and crossings a bike actually has to take.
  const from = { lat, lon };
  const shortlist = snapshot.stations
    .filter((s) => s.operational && s.docksAvailable > 0)
    .map((station) => ({ station, meters: haversineMeters(from, station) }))
    .filter((entry) => entry.meters <= DEFAULT_DOCK_NOW_OPTIONS.maxMeters)
    .sort((a, b) => a.meters - b.meters)
    .slice(0, ROUTE_CANDIDATES);

  const matrix = await travelMatrix(
    from,
    shortlist.map((entry) => entry.station),
    "bicycle",
  );

  const routes = new Map<string, RoutedLeg>();
  if (matrix) {
    shortlist.forEach((entry, index) => {
      const leg = matrix[index];
      if (leg) routes.set(entry.station.id, leg);
    });
  }

  const options = rankNearbyDocks(from, snapshot.stations, DEFAULT_TRAVEL_MODEL, {
    limit: 5,
    routes,
  });

  if (options.length === 0) {
    return Response.json(
      { options: [], message: "No station with a free dock within riding distance." },
      { headers: LIVE_CACHE_HEADER },
    );
  }

  return Response.json(
    {
      options: options.map((option) => ({
        id: option.station.id,
        name: option.station.name,
        lat: option.station.lat,
        lon: option.station.lon,
        docks: option.station.docksAvailable,
        meters: Math.round(option.meters),
        minutes: Math.max(1, Math.round(option.rideSeconds / 60)),
        // True when the ranking charged this station for the chance it fills
        // before the rider gets there. That penalty is the only reason a
        // further station can outrank a nearer one, so the client needs it to
        // explain an order that otherwise looks broken.
        tight: option.effectiveSeconds > option.rideSeconds,
      })),
      fetchedAt: snapshot.fetchedAt,
    },
    { headers: LIVE_CACHE_HEADER },
  );
}
