import { describe, expect, it } from "vitest";

import { MODES } from "@/planner/modes";
import { DEFAULT_TRAVEL_MODEL, ridingSeconds } from "@/planner/travel";

const model = DEFAULT_TRAVEL_MODEL;

/**
 * Guards on the committed travel model.
 *
 * scripts/calibrate.py can be re-run against any month, and a bad month or a
 * changed feed format could quietly write a model that still parses. These
 * assert the fitted numbers stay physically sensible, so a broken calibration
 * fails CI instead of shipping to riders.
 */
describe("the fitted travel model", () => {
  it("is monotonic in distance", () => {
    let previous = -1;
    for (let meters = 0; meters <= 8000; meters += 250) {
      const seconds = ridingSeconds(meters, model);
      expect(seconds).toBeGreaterThan(previous);
      previous = seconds;
    }
  });

  it("implies a believable cycling speed", () => {
    // Straight-line metres per second, so it sits below true road speed: the
    // grid means you rarely ride the hypotenuse.
    const straightLineMps = 1 / model.secondsPerMeter;
    expect(straightLineMps).toBeGreaterThan(1.5);
    expect(straightLineMps).toBeLessThan(4.5);
  });

  it("charges a sane fixed cost to get moving", () => {
    expect(model.fixedSeconds).toBeGreaterThan(0);
    expect(model.fixedSeconds).toBeLessThan(300);
  });

  it("describes a slow rider, not the median one", () => {
    // A median estimate is wrong half the time, and being wrong fast is the
    // failure that costs money.
    expect(model.quantile).toBeGreaterThan(0.6);
    expect(model.quantile).toBeLessThan(0.99);
  });

  it("was actually fitted to real trips", () => {
    expect(model.calibration).toBeDefined();
    expect(model.calibration!.trips).toBeGreaterThan(100_000);
  });

  it("hit the coverage it aimed for on held-out rides", () => {
    const { quantile, calibration } = model;
    expect(Math.abs(calibration!.withinEstimateShare - quantile)).toBeLessThan(0.05);
  });

  it("puts a full member leg at a plausible distance", () => {
    // 35 minutes of riding should be worth a few kilometres. If this drifts,
    // the planner is either routing absurd legs or refusing reasonable ones.
    const budget = MODES.member.targetLegMinutes * 60;
    const meters = (budget - model.fixedSeconds) / model.secondsPerMeter;

    expect(meters).toBeGreaterThan(2_000);
    expect(meters).toBeLessThan(8_000);
  });

  it("stays inside the fee threshold for any leg it allows", () => {
    for (const mode of [MODES.member, MODES.daypass]) {
      const longest = mode.targetLegMinutes * 60;
      expect(longest).toBeLessThan(mode.includedMinutes * 60);
    }
  });
});
