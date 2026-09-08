export interface LatLon {
  lat: number;
  lon: number;
}

/**
 * A dock station, merged from GBFS station_information and station_status.
 *
 * `operational` folds together the three GBFS flags. A station can be
 * physically installed but not renting or not accepting returns, and any of
 * those makes it useless as a swap point.
 */
export interface Station extends LatLon {
  id: string;
  name: string;
  capacity: number;
  docksAvailable: number;
  classicAvailable: number;
  ebikesAvailable: number;
  operational: boolean;
  lastReported: number;
}

export type RideMode = "member" | "daypass";

export interface ModeConfig {
  id: RideMode;
  label: string;
  /** Minutes included in the pass before overage starts. */
  includedMinutes: number;
  /** Where we aim to dock. The gap to includedMinutes absorbs bad estimates. */
  targetLegMinutes: number;
  /** USD per minute charged past includedMinutes. */
  overagePerMinute: number;
}

/**
 * Straight-line distance to riding seconds.
 *
 * Deliberately not a routing engine call: the search evaluates thousands of
 * candidate edges and only the chosen path is worth routing exactly.
 *
 * Two parameters, not three, because straight-line distance cannot separate a
 * street detour from a slow rider. Only their combined effect is identifiable,
 * so only their combined effect is fitted. scripts/calibrate.py sets both from
 * published Citi Bike trip history.
 */
export interface TravelModel {
  /** Unlocking, mounting, and clearing the first intersection. */
  fixedSeconds: number;
  /** Seconds per straight-line metre, absorbing both detours and traffic. */
  secondsPerMeter: number;
  /**
   * Which rider the estimate describes. The median strands half of them, so
   * this is the safety margin, expressed as something measurable rather than
   * as an arbitrary multiplier.
   */
  quantile: number;
  calibration?: {
    source: string;
    trips: number;
    medianAbsErrorSeconds: number;
    withinEstimateShare: number;
    fittedAt: string;
  };
}

export type WaypointKind = "origin" | "station" | "destination";

export interface Waypoint extends LatLon {
  kind: WaypointKind;
  /** Present when kind is "station". */
  stationId?: string;
  name: string;
}

export type LegKind = "walk" | "ride";

export interface Leg {
  kind: LegKind;
  from: Waypoint;
  to: Waypoint;
  meters: number;
  seconds: number;
}

export interface SwapPoint {
  station: Station;
  /** Minutes into the trip when the rider should be docking here. */
  arrivesAtMinute: number;
  /** Ride minutes on the leg that ends here, which must stay under the cap. */
  legMinutes: number;
  docksAvailable: number;
}

export interface Savings {
  /** Overage minutes if the rider never docked. */
  overageMinutes: number;
  /** Dollars that riding straight through would have cost. */
  usd: number;
}

export interface Plan {
  feasible: true;
  mode: ModeConfig;
  legs: Leg[];
  swaps: SwapPoint[];
  /** Station where the rider first picks up a bike. */
  startStation: Station;
  /** Station where the rider finally docks. */
  endStation: Station;
  totalSeconds: number;
  ridingSeconds: number;
  walkingSeconds: number;
  swapSeconds: number;
  /** Longest single ride leg. Must be under the mode's cap or the plan is a lie. */
  longestLegSeconds: number;
  savings: Savings;
}

export type PlanFailureReason =
  | "no_start_station"
  | "no_end_station"
  | "unreachable"
  | "no_stations";

export interface PlanFailure {
  feasible: false;
  reason: PlanFailureReason;
  message: string;
}

export type PlanResult = Plan | PlanFailure;

export interface PlanOptions {
  /** How far we will ask someone to walk at either end. */
  maxWalkMeters: number;
  /** Half-width of the corridor around the direct line that stations must fall in. */
  corridorMeters: number;
  /** Cap on candidate stations, taken nearest-to-line first. */
  maxCandidates: number;
  /** Docking, waiting for the green light, and pulling the bike back out. */
  swapSeconds: number;
  /** Walking pace in metres per second. */
  walkSpeedMps: number;
}

export const DEFAULT_PLAN_OPTIONS: PlanOptions = {
  maxWalkMeters: 700,
  corridorMeters: 900,
  maxCandidates: 160,
  swapSeconds: 90,
  walkSpeedMps: 1.35,
};
