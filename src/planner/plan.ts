import { distanceToSegmentMeters, haversineMeters } from "./geo";
import { MinHeap } from "./heap";
import type { RoutedLeg } from "./routing";
import { rideBetween, ridingSeconds, walkingSeconds } from "./travel";
import {
  DEFAULT_PLAN_OPTIONS,
  type LatLon,
  type Leg,
  type ModeConfig,
  type PlanFailure,
  type PlanOptions,
  type PlanResult,
  type Savings,
  type Station,
  type SwapPoint,
  type TravelModel,
  type Waypoint,
} from "./types";

/**
 * Real walking routes for the two ends of the trip, by station id.
 *
 * Optional throughout. The planner stays free of network calls so it can be
 * tested and reasoned about on its own, and it degrades to straight-line
 * estimates whenever routing is missing or the service is down.
 */
export interface RoutedWalks {
  fromOrigin?: ReadonlyMap<string, RoutedLeg>;
  toDestination?: ReadonlyMap<string, RoutedLeg>;
}

export interface PlanRequest {
  origin: LatLon;
  destination: LatLon;
  mode: ModeConfig;
  stations: Station[];
  model: TravelModel;
  options?: Partial<PlanOptions>;
  walks?: RoutedWalks;
}

/**
 * Extra seconds charged for docking somewhere that might fill before arrival.
 *
 * Roughly 7% of Citi Bike stations are full at any moment and another 12% are
 * down to one or two spaces, so a plan that ignores this sends riders to a
 * station they cannot use. Charging the risk in seconds lets the search trade
 * it against detour time instead of applying a hard cutoff.
 */
export function dockRiskSeconds(station: Station): number {
  if (station.docksAvailable <= 0) return Number.POSITIVE_INFINITY;
  if (station.docksAvailable <= 2) return 240;
  if (station.docksAvailable <= 4) return 90;
  return 0;
}

function usable(station: Station): boolean {
  return station.operational && station.capacity > 0;
}

/**
 * What a walk to or from a station actually costs.
 *
 * Uses the routed walk when there is one and falls back to the straight line
 * otherwise. Candidate stations are still gated on straight-line distance,
 * which is safe because a routed walk is never shorter than the straight line,
 * so the gate cannot admit anything the routed distance would have rejected.
 * Pricing the walk by its real length is enough on its own: a dock 148 m away
 * that takes an 861 m walk simply loses to one 179 m away that takes 250 m.
 */
function walkLeg(
  routed: RoutedLeg | undefined,
  straightMeters: number,
  walkSpeedMps: number,
): RoutedLeg {
  if (routed) return routed;
  return { seconds: walkingSeconds(straightMeters, walkSpeedMps), meters: straightMeters };
}

/** Stations in a corridor around the direct line, nearest to the line first. */
export function selectCandidates(
  origin: LatLon,
  destination: LatLon,
  stations: Station[],
  options: PlanOptions,
): Station[] {
  let corridor = options.corridorMeters;

  // A sparse corridor means a thin part of the network, not a missing answer.
  for (let attempt = 0; attempt < 4; attempt++) {
    const scored: Array<{ station: Station; offset: number }> = [];

    for (const station of stations) {
      if (!usable(station)) continue;
      const offset = distanceToSegmentMeters(station, origin, destination);
      if (offset <= corridor) scored.push({ station, offset });
    }

    if (scored.length >= 12 || attempt === 3) {
      scored.sort((a, b) => a.offset - b.offset);
      return scored.slice(0, options.maxCandidates).map((s) => s.station);
    }
    corridor *= 2;
  }
  return [];
}

function waypointFor(station: Station): Waypoint {
  return {
    kind: "station",
    lat: station.lat,
    lon: station.lon,
    name: station.name,
    stationId: station.id,
  };
}

function failure(reason: PlanFailure["reason"], message: string): PlanFailure {
  return { feasible: false, reason, message };
}

/**
 * Cheapest sequence of docks from origin to destination where no single ride
 * exceeds the mode's target leg length.
 *
 * Multi-source Dijkstra over ride edges between stations. Walking to the first
 * station and away from the last is folded into the source and sink costs. The
 * search space is only stations reached by at least one ride, which stops it
 * from "solving" a trip by walking between two nearby docks.
 */
export function planTrip(request: PlanRequest): PlanResult {
  const options: PlanOptions = { ...DEFAULT_PLAN_OPTIONS, ...request.options };
  const { origin, destination, mode, model } = request;
  const targetLegSeconds = mode.targetLegMinutes * 60;

  const candidates = selectCandidates(origin, destination, request.stations, options);
  if (candidates.length === 0) {
    return failure("no_stations", "No usable Citi Bike stations near this route.");
  }

  // A start station needs a classic bike; ebikes bill per minute and are a
  // different product. A finish station needs somewhere to put the bike.
  const starts: Array<{ index: number; walkSeconds: number }> = [];
  const finishes: Array<{ index: number; walkSeconds: number }> = [];

  candidates.forEach((station, index) => {
    const fromOrigin = haversineMeters(origin, station);
    if (fromOrigin <= options.maxWalkMeters && station.classicAvailable > 0) {
      const walk = walkLeg(
        request.walks?.fromOrigin?.get(station.id),
        fromOrigin,
        options.walkSpeedMps,
      );
      starts.push({ index, walkSeconds: walk.seconds });
    }

    const toDestination = haversineMeters(station, destination);
    if (toDestination <= options.maxWalkMeters && station.docksAvailable > 0) {
      const walk = walkLeg(
        request.walks?.toDestination?.get(station.id),
        toDestination,
        options.walkSpeedMps,
      );
      finishes.push({ index, walkSeconds: walk.seconds });
    }
  });

  if (starts.length === 0) {
    return failure(
      "no_start_station",
      "No station with a classic bike within walking distance of the start.",
    );
  }
  if (finishes.length === 0) {
    return failure(
      "no_end_station",
      "No station with an open dock within walking distance of the destination.",
    );
  }

  const n = candidates.length;
  const dist = new Float64Array(n).fill(Number.POSITIVE_INFINITY);
  const settled = new Uint8Array(n);
  const heap = new MinHeap();

  // A station you walked to and a station you rode into are different states,
  // and they cannot share one predecessor slot. `parent` records an incoming
  // ride; `launchedFrom` records that the path instead begins by walking to
  // that station. Exactly one of the two is set for any reached node.
  const parent = new Int32Array(n).fill(-1);
  const launchedFrom = new Int32Array(n).fill(-1);

  const edgeCost = (from: Station, to: Station): number | null => {
    if (to.docksAvailable <= 0) return null;
    const seconds = rideBetween(from, to, model);
    if (seconds > targetLegSeconds) return null;
    return seconds + options.swapSeconds + dockRiskSeconds(to);
  };

  // Seeds are expanded up front. The only useful move at the station you walked
  // to is to ride away from it, so nothing ever waits in a "holding a bike but
  // has not moved" state, and every settled node has taken at least one ride.
  for (const start of starts) {
    for (let j = 0; j < n; j++) {
      if (j === start.index) continue;
      const cost = edgeCost(candidates[start.index], candidates[j]);
      if (cost === null) continue;

      const total = start.walkSeconds + cost;
      if (total < dist[j]) {
        dist[j] = total;
        parent[j] = -1;
        launchedFrom[j] = start.index;
        heap.push(total, j);
      }
    }
  }

  while (heap.size > 0) {
    const top = heap.pop()!;
    const u = top.value;
    if (settled[u] || top.key > dist[u]) continue;
    settled[u] = 1;

    for (let v = 0; v < n; v++) {
      if (v === u || settled[v]) continue;
      const cost = edgeCost(candidates[u], candidates[v]);
      if (cost === null) continue;

      const total = dist[u] + cost;
      if (total < dist[v]) {
        dist[v] = total;
        parent[v] = u;
        launchedFrom[v] = -1;
        heap.push(total, v);
      }
    }
  }

  let bestFinish = -1;
  let bestCost = Number.POSITIVE_INFINITY;
  for (const finish of finishes) {
    if (!Number.isFinite(dist[finish.index])) continue;
    const total = dist[finish.index] + finish.walkSeconds;
    if (total < bestCost) {
      bestCost = total;
      bestFinish = finish.index;
    }
  }

  if (bestFinish < 0) {
    return failure(
      "unreachable",
      `No chain of docks under ${mode.targetLegMinutes} minutes per leg reaches the destination.`,
    );
  }

  const chain: number[] = [];
  for (let at = bestFinish; at >= 0; at = parent[at]) {
    chain.unshift(at);
    if (parent[at] === -1) {
      if (launchedFrom[at] >= 0) chain.unshift(launchedFrom[at]);
      break;
    }
  }

  return assemble(
    chain.map((i) => candidates[i]),
    request,
    options,
  );
}

/**
 * Turn a chain of stations into legs with exact costs.
 *
 * The search charges a full dock-and-undock at every station because it cannot
 * know which one is last. Every candidate path pays exactly one undock it will
 * not perform, so it does not change which path wins, but it does have to come
 * back out of the reported total.
 */
function assemble(chain: Station[], request: PlanRequest, options: PlanOptions): PlanResult {
  const { origin, destination, mode, model } = request;
  const startStation = chain[0];
  const endStation = chain[chain.length - 1];

  const originWaypoint: Waypoint = { kind: "origin", ...origin, name: "Start" };
  const destinationWaypoint: Waypoint = {
    kind: "destination",
    ...destination,
    name: "Destination",
  };

  const legs: Leg[] = [];
  const walkToBike = walkLeg(
    request.walks?.fromOrigin?.get(startStation.id),
    haversineMeters(origin, startStation),
    options.walkSpeedMps,
  );
  legs.push({
    kind: "walk",
    from: originWaypoint,
    to: waypointFor(startStation),
    meters: walkToBike.meters,
    seconds: walkToBike.seconds,
  });

  const swaps: SwapPoint[] = [];
  let elapsed = legs[0].seconds;
  let ridingTotal = 0;
  let longestLeg = 0;

  for (let i = 0; i < chain.length - 1; i++) {
    const from = chain[i];
    const to = chain[i + 1];
    const meters = haversineMeters(from, to);
    const seconds = ridingSeconds(meters, model);

    legs.push({
      kind: "ride",
      from: waypointFor(from),
      to: waypointFor(to),
      meters,
      seconds,
    });

    ridingTotal += seconds;
    longestLeg = Math.max(longestLeg, seconds);
    elapsed += seconds;

    // Every dock except the final one is a swap the rider has to act on.
    const isFinal = i === chain.length - 2;
    if (!isFinal) {
      swaps.push({
        station: to,
        arrivesAtMinute: Math.round(elapsed / 60),
        legMinutes: Math.round(seconds / 60),
        docksAvailable: to.docksAvailable,
      });
      elapsed += options.swapSeconds;
    }
  }

  const walkFromBike = walkLeg(
    request.walks?.toDestination?.get(endStation.id),
    haversineMeters(endStation, destination),
    options.walkSpeedMps,
  );
  legs.push({
    kind: "walk",
    from: waypointFor(endStation),
    to: destinationWaypoint,
    meters: walkFromBike.meters,
    seconds: walkFromBike.seconds,
  });
  elapsed += walkFromBike.seconds;

  const walkingTotal = legs[0].seconds + walkFromBike.seconds;
  const swapTotal = swaps.length * options.swapSeconds;

  return {
    feasible: true,
    mode,
    legs,
    swaps,
    startStation,
    endStation,
    totalSeconds: elapsed,
    ridingSeconds: ridingTotal,
    walkingSeconds: walkingTotal,
    swapSeconds: swapTotal,
    longestLegSeconds: longestLeg,
    savings: computeSavings(startStation, endStation, mode, model),
  };
}

/**
 * What the same trip would have cost ridden straight through.
 *
 * The counterfactual is the same two stations without docking in between,
 * which is what someone does when they do not know the trick. Citi Bike rounds
 * overage up to the whole minute.
 */
export function computeSavings(
  startStation: LatLon,
  endStation: LatLon,
  mode: ModeConfig,
  model: TravelModel,
): Savings {
  const straightSeconds = rideBetween(startStation, endStation, model);
  const overageMinutes = Math.max(
    0,
    Math.ceil(straightSeconds / 60 - mode.includedMinutes),
  );
  return {
    overageMinutes,
    usd: Number((overageMinutes * mode.overagePerMinute).toFixed(2)),
  };
}
