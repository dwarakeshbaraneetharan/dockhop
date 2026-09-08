/**
 * Plans a real trip against the live Citi Bike feed and prints it.
 *
 *   node scripts/try-plan.ts                          Columbia to the Brooklyn Bridge
 *   node scripts/try-plan.ts daypass                  the same trip on a 30 minute cap
 *   node scripts/try-plan.ts member 40.75 -73.98 40.68 -73.97
 */

import { fetchStations } from "../src/gbfs/client";
import { getMode } from "../src/planner/modes";
import { planTrip } from "../src/planner/plan";
import { DEFAULT_TRAVEL_MODEL } from "../src/planner/travel";
import type { LatLon } from "../src/planner/types";

const MORNINGSIDE: LatLon = { lat: 40.8075, lon: -73.9626 };
const BROOKLYN_BRIDGE: LatLon = { lat: 40.7061, lon: -73.9969 };

const minutes = (seconds: number) => `${Math.round(seconds / 60)} min`;

async function main() {
  const [modeArg, ...coords] = process.argv.slice(2);
  const mode = getMode(modeArg);

  const origin =
    coords.length === 4 ? { lat: Number(coords[0]), lon: Number(coords[1]) } : MORNINGSIDE;
  const destination =
    coords.length === 4 ? { lat: Number(coords[2]), lon: Number(coords[3]) } : BROOKLYN_BRIDGE;

  const started = Date.now();
  const snapshot = await fetchStations();
  const fetchMs = Date.now() - started;

  const usable = snapshot.stations.filter((s) => s.operational);
  const full = usable.filter((s) => s.docksAvailable === 0);
  console.log(
    `${snapshot.stations.length} stations, ${usable.length} operational, ` +
      `${full.length} with no free dock (fetched in ${fetchMs} ms)\n`,
  );

  const planStarted = performance.now();
  const result = planTrip({ origin, destination, mode, stations: snapshot.stations, model: DEFAULT_TRAVEL_MODEL });
  const planMs = performance.now() - planStarted;

  if (!result.feasible) {
    console.log(`No plan (${result.reason}): ${result.message}`);
    return;
  }

  console.log(`${mode.label}: dock every ${mode.targetLegMinutes} min, ${mode.includedMinutes} min included`);
  console.log(`Planned in ${planMs.toFixed(1)} ms\n`);

  console.log(`Start   walk ${Math.round(result.legs[0].meters)} m to ${result.startStation.name}`);
  for (const swap of result.swaps) {
    console.log(
      `Swap    minute ${String(swap.arrivesAtMinute).padStart(3)}  ${swap.station.name}` +
        `  (${swap.legMinutes} min leg, ${swap.docksAvailable} docks free)`,
    );
  }
  console.log(`Finish  ${result.endStation.name}, then walk ${Math.round(result.legs[result.legs.length - 1].meters)} m\n`);

  console.log(`Total ${minutes(result.totalSeconds)}: ${minutes(result.ridingSeconds)} riding, ` +
    `${minutes(result.walkingSeconds)} walking, ${minutes(result.swapSeconds)} swapping`);
  console.log(`Longest leg ${minutes(result.longestLegSeconds)} against a ${mode.includedMinutes} min limit`);
  console.log(
    result.savings.usd > 0
      ? `Saved $${result.savings.usd.toFixed(2)} (${result.savings.overageMinutes} overage min avoided)`
      : `No overage on this trip either way`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
