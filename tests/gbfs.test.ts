import { describe, expect, it } from "vitest";

import { mergeStations } from "@/gbfs/client";
import type { GbfsStationInformation, GbfsStationStatus } from "@/gbfs/types";

const info = (id: string, over: Partial<GbfsStationInformation> = {}): GbfsStationInformation => ({
  station_id: id,
  name: `Station ${id}`,
  lat: 40.75,
  lon: -73.98,
  capacity: 30,
  ...over,
});

const status = (id: string, over: Partial<GbfsStationStatus> = {}): GbfsStationStatus => ({
  station_id: id,
  num_bikes_available: 10,
  num_docks_available: 15,
  num_ebikes_available: 3,
  is_installed: 1,
  is_renting: 1,
  is_returning: 1,
  last_reported: 1_756_000_000,
  ...over,
});

describe("merging the GBFS feeds", () => {
  it("separates classic bikes from ebikes", () => {
    // num_bikes_available counts ebikes too, so classic is the difference.
    const [station] = mergeStations(
      [info("a")],
      [status("a", { num_bikes_available: 10, num_ebikes_available: 4 })],
    );

    expect(station.classicAvailable).toBe(6);
    expect(station.ebikesAvailable).toBe(4);
  });

  it("marks a station unusable if any of the three GBFS flags is down", () => {
    const merged = mergeStations(
      [info("a"), info("b"), info("c"), info("d")],
      [
        status("a"),
        status("b", { is_installed: 0 }),
        status("c", { is_renting: 0 }),
        status("d", { is_returning: 0 }),
      ],
    );

    expect(merged.map((s) => s.operational)).toEqual([true, false, false, false]);
  });

  it("drops stations that appear in only one feed", () => {
    // A live station with no location is unplaceable, and a location with no
    // status tells us nothing about whether a rider could dock there.
    const merged = mergeStations([info("a"), info("orphan")], [status("a"), status("ghost")]);
    expect(merged.map((s) => s.id)).toEqual(["a"]);
  });

  it("accepts booleans as well as the 0/1 the feed actually sends", () => {
    const [station] = mergeStations(
      [info("a")],
      [status("a", { is_installed: true, is_renting: true, is_returning: true })],
    );
    expect(station.operational).toBe(true);
  });

  it("never reports negative availability", () => {
    const [station] = mergeStations(
      [info("a")],
      [status("a", { num_bikes_available: 2, num_ebikes_available: 5, num_docks_available: -1 })],
    );

    expect(station.classicAvailable).toBe(0);
    expect(station.docksAvailable).toBe(0);
  });
});
