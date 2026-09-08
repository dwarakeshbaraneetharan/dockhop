import { haversineMeters } from "./geo";
import type { LatLon, TravelModel } from "./types";

import fitted from "./travel-model.json";

/**
 * Travel model, fitted to real rides by scripts/calibrate.py.
 *
 * Riding time is linear in straight-line distance: a fixed cost to get moving,
 * then a per-metre rate that absorbs the grid detour and the traffic lights
 * together. Fitted at a high quantile rather than the median, because being
 * wrong slow is free and being wrong fast is what gets someone charged.
 */
export const DEFAULT_TRAVEL_MODEL: TravelModel = fitted as TravelModel;

export function ridingSeconds(meters: number, model: TravelModel): number {
  return model.fixedSeconds + meters * model.secondsPerMeter;
}

export function rideBetween(a: LatLon, b: LatLon, model: TravelModel): number {
  return ridingSeconds(haversineMeters(a, b), model);
}

export function walkingSeconds(meters: number, walkSpeedMps: number): number {
  return meters / walkSpeedMps;
}
