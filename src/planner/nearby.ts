import type { RoutedLeg } from "./routing";
import type { Station } from "./types";

/**
 * Which docks are worth putting on the map.
 *
 * Drawing every station within a kilometre buries the handful of useful ones
 * under forty dots. What a rider needs is the few they would actually walk to,
 * plus enough context to see why anything nearer was passed over.
 */

/**
 * What the rider is short of right now. Before a ride they need a classic bike
 * to take, and during one they need somewhere to put it back. A station with
 * twenty-seven free docks and no bikes is perfect for the second and worthless
 * for the first, so the same station has to be able to read either way.
 */
export type DockNeed = "bike" | "dock";

/** Matches the map's colours: unusable, nearly gone, or fine. */
export type DockState = "none" | "low" | "ok";

export function dockState(station: Station, need: DockNeed): DockState {
  const available = need === "bike" ? station.classicAvailable : station.docksAvailable;
  if (available === 0) return "none";
  if (available <= 2) return "low";
  return "ok";
}

export interface NearbyDock {
  station: Station;
  state: DockState;
  /** Routed where possible, straight-line estimate otherwise. */
  travel: RoutedLeg;
  routed: boolean;
  /** The shortest travel time of any station that has what the rider needs. */
  best: boolean;
}

export const DEFAULT_OPEN_LIMIT = 5;

/**
 * The nearest few usable stations, plus anything closer that is not usable.
 *
 * The second half matters as much as the first. A rider who can see that the
 * station across the street is red understands why the app is sending them two
 * blocks further; without it the route just looks wrong. Nothing further away
 * than the last recommendation is worth drawing, because it loses on both
 * counts.
 *
 * Ordered by travel time rather than distance, which is the entire point: from
 * Morningside Heights the closest station in a straight line is a ten minute
 * walk around a closed campus, and one slightly further out is three.
 */
export function selectNearbyDocks(
  entries: Array<{ station: Station; travel: RoutedLeg; routed: boolean }>,
  need: DockNeed,
  openLimit: number = DEFAULT_OPEN_LIMIT,
): NearbyDock[] {
  const sorted = entries
    .filter((entry) => entry.station.operational)
    .sort((a, b) => a.travel.seconds - b.travel.seconds);

  const usable = sorted.filter((entry) => dockState(entry.station, need) !== "none");
  const chosen = usable.slice(0, openLimit);

  // Anything nearer than the furthest station we are recommending, kept so the
  // rider can see what was skipped and why.
  const cutoff = chosen.at(-1)?.travel.seconds ?? 0;
  const closerButWorse = sorted.filter(
    (entry) => dockState(entry.station, need) === "none" && entry.travel.seconds < cutoff,
  );

  const keep = new Set([...chosen, ...closerButWorse]);
  const bestId = chosen[0]?.station.id;

  return sorted
    .filter((entry) => keep.has(entry))
    .map((entry) => ({
      station: entry.station,
      state: dockState(entry.station, need),
      travel: entry.travel,
      routed: entry.routed,
      best: entry.station.id === bestId,
    }));
}
