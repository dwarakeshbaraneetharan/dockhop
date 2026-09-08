import type { ModeConfig, RideMode } from "./types";

/**
 * Citi Bike NYC fares, verified against citibikenyc.com on 2026-09-04.
 * Rates changed on 2026-01-05, so these are worth re-checking each January.
 *
 * The target leg is deliberately well short of the included time. Ten minutes
 * of slack on a 45 minute pass covers a bad travel estimate, a red light streak,
 * and a full dock that forces a detour, which is roughly the worst realistic
 * case. Day pass riders get five minutes on a 30 minute cap for the same reason.
 */
export const MODES: Record<RideMode, ModeConfig> = {
  member: {
    id: "member",
    label: "Annual member",
    includedMinutes: 45,
    targetLegMinutes: 35,
    overagePerMinute: 0.27,
  },
  daypass: {
    id: "daypass",
    label: "Day pass",
    includedMinutes: 30,
    targetLegMinutes: 25,
    overagePerMinute: 0.41,
  },
};

export const DEFAULT_MODE: RideMode = "member";

export function getMode(id: string | null | undefined): ModeConfig {
  return id === "daypass" ? MODES.daypass : MODES.member;
}
