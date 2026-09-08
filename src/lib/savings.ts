"use client";

import { useSyncExternalStore } from "react";

import { createPersistentStore } from "./store";

/**
 * Running total of overage avoided, kept on the device.
 *
 * No accounts, so no server-side history. Local storage covers the number a
 * rider actually cares about and means the app stores nothing about where
 * anyone goes.
 */
export interface SavingsLedger {
  totalUsd: number;
  rides: number;
  minutesAvoided: number;
}

const EMPTY: SavingsLedger = { totalUsd: 0, rides: 0, minutesAvoided: 0 };

const store = createPersistentStore<SavingsLedger>("dockhop.savings.v1", EMPTY, (raw) => {
  const parsed = (raw ?? {}) as Partial<SavingsLedger>;
  return {
    totalUsd: Number(parsed.totalUsd) || 0,
    rides: Number(parsed.rides) || 0,
    minutesAvoided: Number(parsed.minutesAvoided) || 0,
  };
});

export function useSavings(): SavingsLedger {
  return useSyncExternalStore(store.subscribe, store.get, store.getServerSnapshot);
}

export function recordRide(usd: number, minutesAvoided: number): void {
  const previous = store.get();
  store.set({
    totalUsd: Number((previous.totalUsd + usd).toFixed(2)),
    rides: previous.rides + 1,
    minutesAvoided: previous.minutesAvoided + minutesAvoided,
  });
}
