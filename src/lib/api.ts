/** Typed client for this app's own endpoints. */

export interface LatLon {
  lat: number;
  lon: number;
}

export interface NearbyStation extends LatLon {
  id: string;
  name: string;
  docks: number;
  classic: number;
  ebikes: number;
  capacity: number;
  /** Along the routed path, not the straight line, whenever routing succeeded. */
  meters: number;
  minutes: number;
  /** Usable, nearly gone, or no use at all, for whatever the rider needs now. */
  state: "none" | "low" | "ok";
  /** Shortest travel time among the stations that have it. */
  best: boolean;
  routed: boolean;
}

export interface DockOption extends LatLon {
  id: string;
  name: string;
  docks: number;
  /** Along the routed cycling path, not the straight line. */
  meters: number;
  minutes: number;
  /** Charged for the chance it fills before the rider arrives. */
  tight: boolean;
}

export interface PlanSwap extends LatLon {
  stationId: string;
  name: string;
  arrivesAtMinute: number;
  legMinutes: number;
  docks: number;
}

export interface PlanEndpoint extends LatLon {
  id: string;
  name: string;
}

export interface PlanLeg {
  kind: "walk" | "ride";
  from: LatLon & { name: string };
  to: LatLon & { name: string };
  minutes: number;
  meters: number;
}

export interface TripPlan {
  feasible: true;
  mode: string;
  swaps: PlanSwap[];
  start: PlanEndpoint;
  end: PlanEndpoint;
  legs: PlanLeg[];
  totalMinutes: number;
  ridingMinutes: number;
  walkingMinutes: number;
  longestLegMinutes: number;
  savingsUsd: number;
  overageMinutesAvoided: number;
  fetchedAt: number;
}

export interface PlanRejection {
  feasible: false;
  reason: string;
  message: string;
}

export interface GeocodeResult extends LatLon {
  label: string;
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export function fetchNearbyStations(
  at: LatLon,
  radius = 1200,
  signal?: AbortSignal,
  profile: "pedestrian" | "bicycle" = "pedestrian",
) {
  return getJson<{
    stations: NearbyStation[];
    profile: string;
    routed: boolean;
    fetchedAt: number;
  }>(`/api/stations?lat=${at.lat}&lon=${at.lon}&radius=${radius}&profile=${profile}`, signal);
}

export function fetchDockOptions(at: LatLon, signal?: AbortSignal) {
  return getJson<{ options: DockOption[]; message?: string }>(
    `/api/dock-now?lat=${at.lat}&lon=${at.lon}`,
    signal,
  );
}

export function fetchPlan(from: LatLon, to: LatLon, mode: string, signal?: AbortSignal) {
  return getJson<TripPlan | PlanRejection>(
    `/api/plan?fromLat=${from.lat}&fromLon=${from.lon}&toLat=${to.lat}&toLon=${to.lon}&mode=${mode}`,
    signal,
  );
}

export function geocode(query: string, signal?: AbortSignal) {
  return getJson<{ results: GeocodeResult[] }>(
    `/api/geocode?q=${encodeURIComponent(query)}`,
    signal,
  );
}
