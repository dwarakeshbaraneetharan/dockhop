import { describe, expect, it } from "vitest";

import { googleMapsDirections } from "@/lib/maps";

describe("google maps handoff", () => {
  it("points at the coordinate rather than the station name", () => {
    // Dock names are ambiguous and frequently not searchable: there are four
    // stations called some variant of "Broadway & W 116 St".
    const url = googleMapsDirections({ lat: 40.8075, lon: -73.9626 }, "walking");
    expect(url).toContain("destination=40.8075%2C-73.9626");
  });

  it("asks for the mode the rider will actually be in", () => {
    expect(googleMapsDirections({ lat: 1, lon: 2 }, "walking")).toContain("travelmode=walking");
    expect(googleMapsDirections({ lat: 1, lon: 2 }, "bicycling")).toContain(
      "travelmode=bicycling",
    );
  });

  it("leaves the origin out so Maps uses its own fix", () => {
    // The phone's own position is a better start than the one this app holds.
    const url = googleMapsDirections({ lat: 40.8, lon: -73.9 }, "walking");
    expect(url).not.toContain("origin=");
  });

  it("survives a negative longitude without mangling it", () => {
    const url = new URL(googleMapsDirections({ lat: 40.7061, lon: -73.9969 }, "bicycling"));
    expect(url.searchParams.get("destination")).toBe("40.7061,-73.9969");
  });
});
