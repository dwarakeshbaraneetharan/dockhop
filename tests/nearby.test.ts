import { describe, expect, it } from "vitest";

import { dockState, selectNearbyDocks } from "@/planner/nearby";
import type { RoutedLeg } from "@/planner/routing";
import type { Station } from "@/planner/types";
import { makeStation } from "./helpers";

const HERE = { lat: 40.75, lon: -73.98 };

/** A station `minutes` of travel away, wherever it happens to sit. */
function at(
  id: string,
  minutes: number,
  overrides: Partial<Station> = {},
): { station: Station; travel: RoutedLeg; routed: boolean } {
  return {
    station: makeStation(id, HERE.lat + minutes / 1000, HERE.lon, overrides),
    travel: { seconds: minutes * 60, meters: minutes * 80 },
    routed: true,
  };
}

describe("dock state", () => {
  it("reads room to dock when the rider is returning a bike", () => {
    const empty = makeStation("x", 0, 0, { docksAvailable: 0 });
    const tight = makeStation("x", 0, 0, { docksAvailable: 2 });
    const fine = makeStation("x", 0, 0, { docksAvailable: 3 });

    expect(dockState(empty, "dock")).toBe("none");
    expect(dockState(tight, "dock")).toBe("low");
    expect(dockState(fine, "dock")).toBe("ok");
  });

  it("reads bikes on hand when the rider is starting out", () => {
    // A station with every dock free and no bikes in them is perfect for one
    // of these and worthless for the other.
    const stocked = makeStation("x", 0, 0, { docksAvailable: 0, classicAvailable: 9 });
    const empty = makeStation("x", 0, 0, { docksAvailable: 30, classicAvailable: 0 });

    expect(dockState(stocked, "bike")).toBe("ok");
    expect(dockState(stocked, "dock")).toBe("none");
    expect(dockState(empty, "bike")).toBe("none");
    expect(dockState(empty, "dock")).toBe("ok");
  });

  it("ignores ebikes, which are a different product and billed by the minute", () => {
    const station = makeStation("x", 0, 0, { classicAvailable: 0, ebikesAvailable: 8 });
    expect(dockState(station, "bike")).toBe("none");
  });
});

describe("nearby docks", () => {
  it("keeps only the five quickest usable stations", () => {
    const docks = selectNearbyDocks(
      [at("a", 2), at("b", 4), at("c", 6), at("d", 8), at("e", 10), at("f", 12), at("g", 14)],
      "dock",
    );

    expect(docks.map((d) => d.station.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("ranks by travel time, not by distance", () => {
    // The whole point: nearest in a straight line loses to a shorter walk.
    const campus = at("campus", 11);
    campus.travel.meters = 148;
    const across = at("across", 3);
    across.travel.meters = 250;

    const docks = selectNearbyDocks([campus, across], "dock");
    expect(docks[0].station.id).toBe("across");
    expect(docks[0].best).toBe(true);
  });

  it("keeps an unusable station that is closer than the ones being recommended", () => {
    // Without it the rider sees a route past an obvious dock with no reason given.
    const docks = selectNearbyDocks(
      [
        at("full-and-near", 1, { docksAvailable: 0 }),
        at("a", 2), at("b", 4), at("c", 6), at("d", 8), at("e", 10),
      ],
      "dock",
    );

    expect(docks.map((d) => d.station.id)).toEqual(["full-and-near", "a", "b", "c", "d", "e"]);
    expect(docks[0].state).toBe("none");
    expect(docks[0].best).toBe(false);
  });

  it("drops an unusable station further out than the last recommendation", () => {
    // It loses on both counts, so it is only clutter.
    const docks = selectNearbyDocks(
      [
        at("a", 2), at("b", 4), at("c", 6), at("d", 8), at("e", 10),
        at("full-and-far", 20, { docksAvailable: 0 }),
      ],
      "dock",
    );

    expect(docks.map((d) => d.station.id)).not.toContain("full-and-far");
  });

  it("marks exactly one station best, and never an unusable one", () => {
    const docks = selectNearbyDocks(
      [
        at("full", 1, { docksAvailable: 0 }),
        at("tight", 2, { docksAvailable: 1 }),
        at("open", 3),
      ],
      "dock",
    );

    expect(docks.filter((d) => d.best).map((d) => d.station.id)).toEqual(["tight"]);
  });

  it("recommends a different station depending on what the rider needs", () => {
    // The bug this caught: the quickest station had twenty-seven free docks
    // and no bikes, and was being recommended to someone about to set off.
    const entries = [
      at("docks-only", 3, { docksAvailable: 27, classicAvailable: 0 }),
      at("bikes-only", 6, { docksAvailable: 0, classicAvailable: 11 }),
    ];

    expect(selectNearbyDocks(entries, "bike")[0].best).toBe(false);
    expect(selectNearbyDocks(entries, "bike").find((d) => d.best)?.station.id).toBe("bikes-only");
    expect(selectNearbyDocks(entries, "dock").find((d) => d.best)?.station.id).toBe("docks-only");
  });

  it("ignores stations that are out of service", () => {
    const docks = selectNearbyDocks([at("down", 1, { operational: false }), at("up", 5)], "dock");
    expect(docks.map((d) => d.station.id)).toEqual(["up"]);
  });

  it("returns nothing rather than guessing when nothing nearby is usable", () => {
    const docks = selectNearbyDocks(
      [at("x", 2, { docksAvailable: 0 }), at("y", 4, { docksAvailable: 0 })],
      "dock",
    );
    expect(docks).toEqual([]);
  });
});
