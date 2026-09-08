"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { fetchDockOptions, type DockOption, type LatLon } from "@/lib/api";
import { createPersistentStore } from "@/lib/store";
import { shouldRedirect } from "@/planner/docknow";
import { haversineMeters } from "@/planner/geo";
import { MODES } from "@/planner/modes";
import { DEFAULT_TRAVEL_MODEL, ridingSeconds } from "@/planner/travel";
import type { RideMode } from "@/planner/types";

const POLL_MS = 15_000;

export interface DockTarget extends LatLon {
  id: string;
  name: string;
  docks: number;
}

export interface RedirectNotice {
  from: string;
  to: string;
  at: number;
}

interface PersistedRide {
  legStartedAt: number;
  mode: RideMode;
  target: DockTarget | null;
  legsDone: number;
}

/**
 * The ride survives a reload because losing the timer mid-ride is the exact
 * failure that costs someone money, and phones discard background tabs freely.
 */
const rideStore = createPersistentStore<PersistedRide | null>("dockhop.ride.v1", null);

/**
 * The live half of the app: how long the current bike has been out, where the
 * rider is heading to dock, and whether that dock is still a safe bet.
 */
export function useRide(mode: RideMode) {
  const persisted = useSyncExternalStore(
    rideStore.subscribe,
    rideStore.get,
    rideStore.getServerSnapshot,
  );

  // Persisted state is the source of truth so a reload is indistinguishable
  // from staying on the page.
  const active = persisted && persisted.mode === mode ? persisted : null;
  const legStartedAt = active?.legStartedAt ?? null;
  const target = active?.target ?? null;
  const legsDone = active?.legsDone ?? 0;

  const [now, setNow] = useState(() => Date.now());
  const [redirect, setRedirect] = useState<RedirectNotice | null>(null);
  const [pollError, setPollError] = useState<string | null>(null);
  const positionRef = useRef<LatLon | null>(null);

  const config = MODES[mode];
  const riding = legStartedAt !== null;

  // One ticker for the whole app rather than one per countdown.
  useEffect(() => {
    if (!riding) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [riding]);

  const elapsedSeconds = riding ? Math.max(0, Math.floor((now - legStartedAt) / 1000)) : 0;
  const budgetSeconds = config.targetLegMinutes * 60;
  const remainingSeconds = budgetSeconds - elapsedSeconds;
  const hardRemainingSeconds = config.includedMinutes * 60 - elapsedSeconds;

  /**
   * Start the clock, optionally aimed at a first dock.
   *
   * The caller supplies the target rather than the hook deriving it from a plan,
   * so advancing through a route stays an event the rider triggered instead of
   * an effect reacting to a counter.
   */
  const startLeg = useCallback(
    (firstTarget: DockTarget | null = null) => {
      rideStore.set({ legStartedAt: Date.now(), mode, target: firstTarget, legsDone: 0 });
      setRedirect(null);
    },
    [mode],
  );

  const endRide = useCallback(() => {
    rideStore.set(null);
    setRedirect(null);
  }, []);

  /** Rider confirmed the green light: the clock restarts on a fresh bike. */
  const confirmDocked = useCallback(
    (nextTarget: DockTarget | null = null) => {
      const current = rideStore.get();
      rideStore.set({
        legStartedAt: Date.now(),
        mode,
        target: nextTarget,
        legsDone: (current?.legsDone ?? 0) + 1,
      });
      setRedirect(null);
    },
    [mode],
  );

  const setTarget = useCallback(
    (next: DockTarget | null) => {
      const current = rideStore.get();
      rideStore.set({
        legStartedAt: current?.legStartedAt ?? Date.now(),
        mode,
        target: next,
        legsDone: current?.legsDone ?? 0,
      });
    },
    [mode],
  );

  const reportPosition = useCallback((position: LatLon | null) => {
    positionRef.current = position;
  }, []);

  /**
   * Re-check the chosen dock against the live feed.
   *
   * If the target has filled, closed, or fallen to its last space while the
   * rider is still more than a minute out, the best remaining option from the
   * same response takes over immediately, with no second round trip.
   */
  const verifyTarget = useCallback(async () => {
    const current = rideStore.get()?.target;
    if (!current) return;

    try {
      const { options } = await fetchDockOptions(current);
      setPollError(null);

      const live = options.find((option) => option.id === current.id);
      const from = positionRef.current;
      const secondsAway = from
        ? ridingSeconds(haversineMeters(from, current), DEFAULT_TRAVEL_MODEL)
        : 120;

      const health = live ? { operational: true, docksAvailable: live.docks } : undefined;
      if (!shouldRedirect(health, secondsAway)) {
        if (live && live.docks !== current.docks) setTarget({ ...current, docks: live.docks });
        return;
      }

      const replacement = options.find((option) => option.id !== current.id);
      if (!replacement) return;

      setTarget(toTarget(replacement));
      setRedirect({ from: current.name, to: replacement.name, at: Date.now() });
    } catch (error) {
      // A failed poll is not a reason to move someone. Hold the target and say so.
      setPollError(error instanceof Error ? error.message : "Could not refresh dock status");
    }
  }, [setTarget]);

  const targetId = target?.id;
  useEffect(() => {
    if (!targetId) return;
    // Scheduled rather than called inline so the first poll cannot set state
    // during the effect itself.
    const kickoff = window.setTimeout(() => void verifyTarget(), 0);
    const id = window.setInterval(() => void verifyTarget(), POLL_MS);
    return () => {
      window.clearTimeout(kickoff);
      window.clearInterval(id);
    };
  }, [targetId, verifyTarget]);

  return {
    riding,
    elapsedSeconds,
    remainingSeconds,
    hardRemainingSeconds,
    budgetSeconds,
    legsDone,
    target,
    redirect,
    pollError,
    startLeg,
    endRide,
    confirmDocked,
    setTarget,
    reportPosition,
    dismissRedirect: () => setRedirect(null),
  };
}

export function toTarget(option: DockOption): DockTarget {
  return {
    id: option.id,
    name: option.name,
    lat: option.lat,
    lon: option.lon,
    docks: option.docks,
  };
}
