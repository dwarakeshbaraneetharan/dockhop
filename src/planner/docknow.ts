import { haversineMeters } from "./geo";
import { dockRiskSeconds } from "./plan";
import type { RoutedLeg } from "./routing";
import { rideBetween } from "./travel";
import type { LatLon, Station, TravelModel } from "./types";

export interface DockOption {
  station: Station;
  meters: number;
  rideSeconds: number;
  /** Ride time plus the risk penalty. What the ranking actually sorts on. */
  effectiveSeconds: number;
  /** False when this fell back to a straight-line estimate. */
  routed: boolean;
}

export interface DockNowOptions {
  limit: number;
  /** Ignore stations beyond this. Past it, walking is the better answer. */
  maxMeters: number;
  /**
   * Real cycling routes by station id, when they could be fetched. The rider
   * is already on a bike here, so these are bike routes rather than walking
   * ones, and they follow the same one-way streets and river crossings the
   * rider has to.
   */
  routes?: ReadonlyMap<string, RoutedLeg>;
}

export const DEFAULT_DOCK_NOW_OPTIONS: DockNowOptions = {
  limit: 5,
  maxMeters: 2500,
};

/**
 * Nearest usable docks, ranked by arrival time with dock risk priced in.
 *
 * Nearest by distance is the wrong answer when the nearest station has one free
 * space: arriving to find it full is worse than riding two more blocks to a
 * station with room. Ranking on ride time plus the risk penalty makes that
 * trade explicit, and returning several options means the client already holds
 * a fallback when the feed updates mid-approach.
 */
export function rankNearbyDocks(
  from: LatLon,
  stations: Station[],
  model: TravelModel,
  options: Partial<DockNowOptions> = {},
): DockOption[] {
  const { limit, maxMeters, routes } = { ...DEFAULT_DOCK_NOW_OPTIONS, ...options };
  const ranked: DockOption[] = [];

  for (const station of stations) {
    if (!station.operational || station.docksAvailable <= 0) continue;

    const straight = haversineMeters(from, station);
    if (straight > maxMeters) continue;

    const route = routes?.get(station.id);
    const rideSeconds = route ? route.seconds : rideBetween(from, station, model);
    ranked.push({
      station,
      meters: route ? route.meters : straight,
      rideSeconds,
      effectiveSeconds: rideSeconds + dockRiskSeconds(station),
      routed: route !== undefined,
    });
  }

  ranked.sort((a, b) => a.effectiveSeconds - b.effectiveSeconds);
  return ranked.slice(0, limit);
}

/** The parts of a station this guard needs, so the browser can call it too. */
export interface DockHealth {
  operational: boolean;
  docksAvailable: number;
}

/**
 * Whether a dock the rider is already heading to still looks safe.
 *
 * Called on every poll during navigation, on the client as well as the server,
 * which is why it takes a structural shape rather than a full Station. A
 * station that has dropped to its last space while someone is still minutes
 * away is the exact situation this app exists to avoid, so it is treated as
 * lost rather than merely risky.
 */
export function shouldRedirect(target: DockHealth | undefined, secondsAway: number): boolean {
  if (!target) return true;
  if (!target.operational) return true;
  if (target.docksAvailable <= 0) return true;

  // More than a minute out, one remaining space is not worth betting on.
  return target.docksAvailable <= 1 && secondsAway > 60;
}
