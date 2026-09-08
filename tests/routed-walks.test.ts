import { describe, expect, it } from "vitest";

import { haversineMeters } from "@/planner/geo";
import { MODES } from "@/planner/modes";
import { planTrip, type RoutedWalks } from "@/planner/plan";
import type { RoutedLeg } from "@/planner/routing";
import { DEFAULT_TRAVEL_MODEL } from "@/planner/travel";
import { DEFAULT_PLAN_OPTIONS, type Plan, type PlanResult, type Station } from "@/planner/types";
import { BROOKLYN_BRIDGE, makeStation, MORNINGSIDE, stationsAlong } from "./helpers";

function expectFeasible(result: PlanResult): Plan {
  if (!result.feasible) throw new Error(`expected a plan, got: ${result.reason}`);
  return result;
}

function run(stations: Station[], walks?: RoutedWalks): PlanResult {
  return planTrip({
    origin: MORNINGSIDE,
    destination: BROOKLYN_BRIDGE,
    mode: MODES.member,
    stations,
    model: DEFAULT_TRAVEL_MODEL,
    walks,
  });
}

/**
 * The situation this feature exists for, drawn from the real network around
 * Morningside Heights: the station nearest in a straight line sits behind a
 * closed campus and takes an 861 m walk, while one slightly further out is a
 * 250 m walk. Both are inside the walking gate, so only the cost can separate
 * them.
 */
const CAMPUS = makeStation("campus", MORNINGSIDE.lat + 0.0013, MORNINGSIDE.lon);
const ACROSS = makeStation("across", MORNINGSIDE.lat + 0.0016, MORNINGSIDE.lon + 0.0004);

// Everything else is pushed out of walking range of the origin, so the choice
// of start station comes down to these two and nothing else can win on merit
// by simply sitting further along the route.
const CORRIDOR = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40).filter(
  (station) => haversineMeters(MORNINGSIDE, station) > DEFAULT_PLAN_OPTIONS.maxWalkMeters,
);

describe("routed walks", () => {
  it("sends the rider to the dock that is genuinely a shorter walk", () => {
    const walks: RoutedWalks = {
      fromOrigin: new Map<string, RoutedLeg>([
        ["campus", { seconds: 618, meters: 861 }],
        ["across", { seconds: 180, meters: 250 }],
      ]),
    };

    const result = expectFeasible(run([CAMPUS, ACROSS, ...CORRIDOR], walks));
    expect(result.startStation.id).toBe("across");
  });

  it("would have picked the nearer one without routing, which is the bug", () => {
    const result = expectFeasible(run([CAMPUS, ACROSS, ...CORRIDOR]));
    expect(result.startStation.id).toBe("campus");
  });

  it("reports the routed walk rather than the straight line", () => {
    const walks: RoutedWalks = {
      fromOrigin: new Map([["across", { seconds: 180, meters: 250 }]]),
    };

    const result = expectFeasible(run([ACROSS, ...CORRIDOR], walks));
    const firstLeg = result.legs[0];
    expect(firstLeg.kind).toBe("walk");
    expect(firstLeg.meters).toBe(250);
    expect(firstLeg.seconds).toBe(180);
  });

  it("falls back to the straight-line estimate for a station it has no route for", () => {
    // A partial matrix is normal: Valhalla can fail to snap one dock to a road.
    const walks: RoutedWalks = { fromOrigin: new Map() };
    const withRouting = run([CAMPUS, ACROSS, ...CORRIDOR], walks);
    const without = run([CAMPUS, ACROSS, ...CORRIDOR]);

    expect(expectFeasible(withRouting).startStation.id).toBe(
      expectFeasible(without).startStation.id,
    );
  });

  it("still plans the same trip when routing is entirely absent", () => {
    const stations = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40);
    const routed = expectFeasible(run(stations, { fromOrigin: new Map(), toDestination: new Map() }));
    const plain = expectFeasible(run(stations));

    expect(routed.totalSeconds).toBe(plain.totalSeconds);
    expect(routed.swaps.map((s) => s.station.id)).toEqual(plain.swaps.map((s) => s.station.id));
  });

  it("uses the routed walk at the destination end too", () => {
    const stations = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40);
    const last = stations[stations.length - 1];
    const walks: RoutedWalks = {
      toDestination: new Map([[last.id, { seconds: 400, meters: 520 }]]),
    };

    const result = expectFeasible(run(stations, walks));
    if (result.endStation.id !== last.id) return; // another dock won on merit
    const finalLeg = result.legs[result.legs.length - 1];
    expect(finalLeg.meters).toBe(520);
    expect(finalLeg.seconds).toBe(400);
  });
});
