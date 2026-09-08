import { describe, expect, it } from "vitest";

import { haversineMeters } from "@/planner/geo";
import { MODES } from "@/planner/modes";
import { computeSavings, dockRiskSeconds, planTrip, selectCandidates } from "@/planner/plan";
import { DEFAULT_TRAVEL_MODEL } from "@/planner/travel";
import { DEFAULT_PLAN_OPTIONS, type Plan, type PlanResult, type Station } from "@/planner/types";
import {
  BROOKLYN_BRIDGE,
  makeRandom,
  makeStation,
  MORNINGSIDE,
  stationsAlong,
} from "./helpers";

function plan(stations: Station[], mode = MODES.member, overrides = {}): PlanResult {
  return planTrip({
    origin: MORNINGSIDE,
    destination: BROOKLYN_BRIDGE,
    mode,
    stations,
    model: DEFAULT_TRAVEL_MODEL,
    ...overrides,
  });
}

function expectFeasible(result: PlanResult): Plan {
  if (!result.feasible) throw new Error(`expected a plan, got: ${result.reason}`);
  return result;
}

describe("the leg cap", () => {
  it("is never exceeded on a trip that needs several swaps", () => {
    const result = expectFeasible(plan(stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40)));

    for (const leg of result.legs.filter((l) => l.kind === "ride")) {
      expect(leg.seconds).toBeLessThanOrEqual(MODES.member.targetLegMinutes * 60);
    }
    expect(result.longestLegSeconds).toBeLessThanOrEqual(MODES.member.targetLegMinutes * 60);
  });

  it("leaves real slack against the fee threshold, not just the target", () => {
    const result = expectFeasible(plan(stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40)));

    // The whole point of docking early is that the billed limit is never in play.
    expect(result.longestLegSeconds).toBeLessThan(MODES.member.includedMinutes * 60);
  });

  it("forces more swaps for a day pass than for a member", () => {
    const stations = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40);
    const member = expectFeasible(plan(stations, MODES.member));
    const daypass = expectFeasible(plan(stations, MODES.daypass));

    expect(daypass.swaps.length).toBeGreaterThan(member.swaps.length);
    for (const leg of daypass.legs.filter((l) => l.kind === "ride")) {
      expect(leg.seconds).toBeLessThanOrEqual(MODES.daypass.targetLegMinutes * 60);
    }
  });

  it("holds across randomly generated networks", () => {
    const random = makeRandom(20260904);

    for (let trial = 0; trial < 200; trial++) {
      const stations: Station[] = [];
      for (let i = 0; i < 60; i++) {
        stations.push(
          makeStation(
            `r${i}`,
            40.70 + random() * 0.11,
            -74.01 + random() * 0.06,
            {
              docksAvailable: Math.floor(random() * 20),
              classicAvailable: Math.floor(random() * 12),
            },
          ),
        );
      }

      const mode = random() < 0.5 ? MODES.member : MODES.daypass;
      const result = planTrip({
        origin: { lat: 40.71 + random() * 0.08, lon: -74.0 + random() * 0.05 },
        destination: { lat: 40.71 + random() * 0.08, lon: -74.0 + random() * 0.05 },
        mode,
        stations,
        model: DEFAULT_TRAVEL_MODEL,
      });

      if (!result.feasible) continue;
      for (const leg of result.legs.filter((l) => l.kind === "ride")) {
        expect(leg.seconds).toBeLessThanOrEqual(mode.targetLegMinutes * 60);
      }
    }
  });
});

describe("dock availability", () => {
  it("never routes a swap through a full station", () => {
    const stations = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40);
    // Fill most of the corridor, leaving a sparse set of usable docks.
    stations.forEach((s, i) => {
      if (i % 4 !== 0) s.docksAvailable = 0;
    });

    const result = expectFeasible(plan(stations));
    for (const swap of result.swaps) {
      expect(swap.station.docksAvailable).toBeGreaterThan(0);
    }
    expect(result.endStation.docksAvailable).toBeGreaterThan(0);
  });

  it("walks past ebike-only stations to reach a classic bike", () => {
    const stations = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40);
    // The two closest stations hold ebikes only, which bill per minute.
    stations[0].classicAvailable = 0;
    stations[1].classicAvailable = 0;

    const result = expectFeasible(plan(stations));

    expect(result.startStation.classicAvailable).toBeGreaterThan(0);
    expect(["s0", "s1"]).not.toContain(result.startStation.id);
  });

  it("skips stations that are installed but not accepting returns", () => {
    const stations = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40);
    const broken = stations.filter((_, i) => i % 3 === 1);
    broken.forEach((s) => {
      s.operational = false;
    });

    const result = expectFeasible(plan(stations));
    const brokenIds = new Set(broken.map((s) => s.id));
    for (const leg of result.legs) {
      if (leg.to.stationId) expect(brokenIds.has(leg.to.stationId)).toBe(false);
    }
  });

  it("prefers a roomy dock over a nearly full one", () => {
    expect(dockRiskSeconds(makeStation("a", 0, 0, { docksAvailable: 12 }))).toBe(0);
    expect(
      dockRiskSeconds(makeStation("b", 0, 0, { docksAvailable: 1 })),
    ).toBeGreaterThan(dockRiskSeconds(makeStation("c", 0, 0, { docksAvailable: 4 })));
    expect(dockRiskSeconds(makeStation("d", 0, 0, { docksAvailable: 0 }))).toBe(Infinity);
  });
});

describe("the route it hands back", () => {
  it("is a connected chain from origin to destination", () => {
    const result = expectFeasible(plan(stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40)));

    expect(result.legs[0].from.kind).toBe("origin");
    expect(result.legs[result.legs.length - 1].to.kind).toBe("destination");

    for (let i = 0; i < result.legs.length - 1; i++) {
      expect(result.legs[i].to.lat).toBeCloseTo(result.legs[i + 1].from.lat, 9);
      expect(result.legs[i].to.lon).toBeCloseTo(result.legs[i + 1].from.lon, 9);
    }
  });

  it("does not invent a starting station the rider cannot walk to", () => {
    // Regression: a station used as a walk-to origin and the same station
    // reached by riding share an index, so a careless predecessor chain can
    // splice in a station that was never visited.
    const result = expectFeasible(plan(stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40)));

    expect(haversineMeters(MORNINGSIDE, result.startStation)).toBeLessThanOrEqual(
      DEFAULT_PLAN_OPTIONS.maxWalkMeters,
    );
    expect(haversineMeters(result.endStation, BROOKLYN_BRIDGE)).toBeLessThanOrEqual(
      DEFAULT_PLAN_OPTIONS.maxWalkMeters,
    );
  });

  it("visits each station at most once", () => {
    const result = expectFeasible(plan(stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40)));
    const visited = result.legs
      .map((l) => l.to.stationId)
      .filter((id): id is string => Boolean(id));

    expect(new Set(visited).size).toBe(visited.length);
  });

  it("adds up: total equals the sum of its legs plus swap time", () => {
    const result = expectFeasible(plan(stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40)));
    const legTotal = result.legs.reduce((sum, leg) => sum + leg.seconds, 0);

    expect(result.totalSeconds).toBeCloseTo(legTotal + result.swapSeconds, 6);
    expect(result.swapSeconds).toBe(result.swaps.length * DEFAULT_PLAN_OPTIONS.swapSeconds);
  });

  it("reports swap arrival times that increase along the route", () => {
    const result = expectFeasible(plan(stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40)));

    for (let i = 1; i < result.swaps.length; i++) {
      expect(result.swaps[i].arrivesAtMinute).toBeGreaterThan(
        result.swaps[i - 1].arrivesAtMinute,
      );
    }
  });

  it("needs no swap when the trip already fits inside one leg", () => {
    const near = { lat: MORNINGSIDE.lat - 0.012, lon: MORNINGSIDE.lon - 0.004 };
    const result = expectFeasible(
      plan(stationsAlong(MORNINGSIDE, near, 8), MODES.member, { destination: near }),
    );

    expect(result.swaps).toHaveLength(0);
    expect(result.savings.usd).toBe(0);
  });
});

describe("when it cannot help", () => {
  it("says so rather than guessing when no station has a bike", () => {
    const stations = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40, { classicAvailable: 0 });
    const result = plan(stations);

    expect(result.feasible).toBe(false);
    if (!result.feasible) expect(result.reason).toBe("no_start_station");
  });

  it("says so when every dock near the destination is full", () => {
    const stations = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40);
    stations.forEach((s) => {
      if (haversineMeters(s, BROOKLYN_BRIDGE) < 1500) s.docksAvailable = 0;
    });

    const result = plan(stations);
    expect(result.feasible).toBe(false);
    if (!result.feasible) expect(result.reason).toBe("no_end_station");
  });

  it("says so when the corridor has a gap too wide to cross in one leg", () => {
    // Stations at both ends, nothing in the middle third.
    const stations = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 40).filter((_, i) => i < 4 || i > 36);
    const result = plan(stations);

    expect(result.feasible).toBe(false);
    if (!result.feasible) expect(result.reason).toBe("unreachable");
  });

  it("says so when there are no stations at all", () => {
    const result = plan([]);
    expect(result.feasible).toBe(false);
    if (!result.feasible) expect(result.reason).toBe("no_stations");
  });
});

describe("candidate selection", () => {
  it("keeps stations near the line and drops distant ones", () => {
    const onRoute = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 30);
    const farAway = [makeStation("queens", 40.7282, -73.7949)];

    const chosen = selectCandidates(
      MORNINGSIDE,
      BROOKLYN_BRIDGE,
      [...onRoute, ...farAway],
      DEFAULT_PLAN_OPTIONS,
    );

    expect(chosen.map((s) => s.id)).not.toContain("queens");
    expect(chosen.length).toBeGreaterThan(10);
  });

  it("widens the corridor rather than giving up on a sparse network", () => {
    const sparse = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 14).map((s, i) => ({
      ...s,
      lat: s.lat + (i % 2 === 0 ? 0.014 : -0.014),
    }));

    const chosen = selectCandidates(MORNINGSIDE, BROOKLYN_BRIDGE, sparse, DEFAULT_PLAN_OPTIONS);
    expect(chosen.length).toBeGreaterThan(0);
  });

  it("respects the candidate cap", () => {
    const many = stationsAlong(MORNINGSIDE, BROOKLYN_BRIDGE, 500);
    const chosen = selectCandidates(MORNINGSIDE, BROOKLYN_BRIDGE, many, DEFAULT_PLAN_OPTIONS);

    expect(chosen.length).toBeLessThanOrEqual(DEFAULT_PLAN_OPTIONS.maxCandidates);
  });
});

describe("dollars saved", () => {
  it("is zero for a trip inside the included time", () => {
    const a = { lat: 40.75, lon: -73.98 };
    const b = { lat: 40.76, lon: -73.98 };
    expect(computeSavings(a, b, MODES.member, DEFAULT_TRAVEL_MODEL).usd).toBe(0);
  });

  it("charges the overage at the published member rate", () => {
    const savings = computeSavings(
      MORNINGSIDE,
      BROOKLYN_BRIDGE,
      MODES.member,
      DEFAULT_TRAVEL_MODEL,
    );

    expect(savings.overageMinutes).toBeGreaterThan(0);
    expect(savings.usd).toBeCloseTo(savings.overageMinutes * 0.27, 2);
  });

  it("costs a day pass rider more than a member for the same ride", () => {
    const member = computeSavings(MORNINGSIDE, BROOKLYN_BRIDGE, MODES.member, DEFAULT_TRAVEL_MODEL);
    const daypass = computeSavings(
      MORNINGSIDE,
      BROOKLYN_BRIDGE,
      MODES.daypass,
      DEFAULT_TRAVEL_MODEL,
    );

    // Fifteen fewer included minutes and a higher per-minute rate.
    expect(daypass.usd).toBeGreaterThan(member.usd);
  });

  it("rounds overage up, the way the operator bills it", () => {
    const savings = computeSavings(
      MORNINGSIDE,
      BROOKLYN_BRIDGE,
      MODES.member,
      DEFAULT_TRAVEL_MODEL,
    );
    expect(Number.isInteger(savings.overageMinutes)).toBe(true);
  });
});
