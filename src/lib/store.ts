"use client";

/**
 * A localStorage key exposed as an external store.
 *
 * Local storage genuinely is an external system, so useSyncExternalStore is the
 * right primitive rather than reading it into state from an effect. It also
 * gives a correct server snapshot, so nothing here causes a hydration mismatch,
 * and every component reading the same key stays in sync.
 */
export interface PersistentStore<T> {
  get: () => T;
  getServerSnapshot: () => T;
  set: (value: T) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPersistentStore<T>(
  key: string,
  fallback: T,
  revive: (raw: unknown) => T = (raw) => raw as T,
): PersistentStore<T> {
  const listeners = new Set<() => void>();
  let cache: T | undefined;
  let cachedRaw: string | null = null;

  const read = (): T => {
    if (typeof window === "undefined") return fallback;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
    } catch {
      return fallback;
    }

    // getSnapshot must be referentially stable between renders or React loops.
    if (raw === cachedRaw && cache !== undefined) return cache;
    cachedRaw = raw;
    try {
      cache = raw === null ? fallback : revive(JSON.parse(raw));
    } catch {
      cache = fallback;
    }
    return cache;
  };

  return {
    get: read,
    getServerSnapshot: () => fallback,
    set(value: T) {
      try {
        if (value === null || value === undefined) window.localStorage.removeItem(key);
        else window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Private browsing blocks writes; keep the in-memory value working.
      }
      cachedRaw = null;
      cache = undefined;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
