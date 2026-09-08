import { describe, expect, it } from "vitest";

import { rankNearbyDocks, shouldRedirect } from "@/planner/docknow";
import { DEFAULT_TRAVEL_MODEL } from "@/planner/travel";
import { makeStation } from "./helpers";

const HERE = { lat: 40.75, lon: -73.98 };

/** Roughly `meters` north of HERE. */
function northOf(id: string, meters: number, overrides = {}) {
  return makeStation(id, HERE.lat + meters / 111_320, HERE.lon, overrides);
}

describe("dock now", () => {
  it("returns the closest usable dock first", () => {
    const options = rankNearbyDocks(
      HERE,
      [northOf("far", 1200), northOf("near", 200), northOf("mid", 600)],
      DEFAULT_TRAVEL_MODEL,
    );

    expect(options[0].station.id).toBe("near");
    expect(options.map((o) => o.station.id)).toEqual(["near", "mid", "far"]);
  });

  it("skips a nearby station holding one last space for a roomier one", () => {
    const options = rankNearbyDocks(
      HERE,
      [northOf("tight", 150, { docksAvailable: 1 }), northOf("roomy", 500, { docksAvailable: 20 })],
      DEFAULT_TRAVEL_MODEL,
    );

    // 350 m further is a cheaper trade than arriving at a station that just filled.
    expect(options[0].station.id).toBe("roomy");
  });

  it("still offers the tight station as a fallback", () => {
    const options = rankNearbyDocks(
      HERE,
      [northOf("tight", 150, { docksAvailable: 1 }), northOf("roomy", 500, { docksAvailable: 20 })],
      DEFAULT_TRAVEL_MODEL,
    );
    expect(options).toHaveLength(2);
  });

  it("excludes full, closed, and out-of-range stations", () => {
    const options = rankNearbyDocks(
      HERE,
      [
        northOf("full", 100, { docksAvailable: 0 }),
        northOf("closed", 120, { operational: false }),
        northOf("distant", 9000),
        northOf("good", 400),
      ],
      DEFAULT_TRAVEL_MODEL,
    );

    expect(options.map((o) => o.station.id)).toEqual(["good"]);
  });

  it("honours the result limit", () => {
    const stations = Array.from({ length: 12 }, (_, i) => northOf(`s${i}`, 100 + i * 50));
    expect(rankNearbyDocks(HERE, stations, DEFAULT_TRAVEL_MODEL, { limit: 3 })).toHaveLength(3);
  });
});

describe("deciding to redirect mid-approach", () => {
  it("redirects when the target filled up", () => {
    expect(shouldRedirect(northOf("t", 400, { docksAvailable: 0 }), 120)).toBe(true);
  });

  it("redirects when the target went out of service", () => {
    expect(shouldRedirect(northOf("t", 400, { operational: false }), 120)).toBe(true);
  });

  it("redirects off a last remaining space when still minutes away", () => {
    expect(shouldRedirect(northOf("t", 400, { docksAvailable: 1 }), 300)).toBe(true);
  });

  it("holds course on a last space when arriving imminently", () => {
    // Close enough that switching costs more than the risk of losing the race.
    expect(shouldRedirect(northOf("t", 50, { docksAvailable: 1 }), 20)).toBe(false);
  });

  it("holds course when the target has room", () => {
    expect(shouldRedirect(northOf("t", 400, { docksAvailable: 8 }), 300)).toBe(false);
  });

  it("redirects when the target vanished from the feed", () => {
    expect(shouldRedirect(undefined, 60)).toBe(true);
  });
});
