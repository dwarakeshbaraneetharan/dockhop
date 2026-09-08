"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { LatLon } from "@/lib/api";

export interface Position extends LatLon {
  accuracy: number;
  at: number;
}

export interface GeolocationState {
  position: Position | null;
  error: string | null;
  watching: boolean;
}

function describeError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission denied. Enable it to track your ride.";
    case error.POSITION_UNAVAILABLE:
      return "Your location is unavailable right now.";
    case error.TIMEOUT:
      return "Timed out finding your location.";
    default:
      return "Could not read your location.";
  }
}

/**
 * Position tracking, started explicitly rather than on mount.
 *
 * Continuous tracking only runs while a ride is in progress. Watching from page
 * load would burn battery for someone who is only checking dock counts, and iOS
 * shows the location indicator the whole time, which reads as a broken app.
 */
export function useGeolocation() {
  const [state, setState] = useState<GeolocationState>({
    position: null,
    error: null,
    watching: false,
  });
  const watchId = useRef<number | null>(null);

  const stop = useCallback(() => {
    if (watchId.current !== null) {
      navigator.geolocation.clearWatch(watchId.current);
      watchId.current = null;
    }
    setState((previous) => ({ ...previous, watching: false }));
  }, []);

  const start = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setState((previous) => ({ ...previous, error: "This browser cannot share location." }));
      return;
    }
    if (watchId.current !== null) return;

    setState((previous) => ({ ...previous, watching: true, error: null }));
    watchId.current = navigator.geolocation.watchPosition(
      (reading) =>
        setState({
          position: {
            lat: reading.coords.latitude,
            lon: reading.coords.longitude,
            accuracy: reading.coords.accuracy,
            at: reading.timestamp,
          },
          error: null,
          watching: true,
        }),
      (error) => setState((previous) => ({ ...previous, error: describeError(error) })),
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
  }, []);

  /** One-off read, for setting a starting point without tracking. */
  const locateOnce = useCallback(() => {
    return new Promise<Position>((resolve, reject) => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        reject(new Error("This browser cannot share location."));
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (reading) => {
          const position = {
            lat: reading.coords.latitude,
            lon: reading.coords.longitude,
            accuracy: reading.coords.accuracy,
            at: reading.timestamp,
          };
          setState((previous) => ({ ...previous, position, error: null }));
          resolve(position);
        },
        (error) => {
          setState((previous) => ({ ...previous, error: describeError(error) }));
          reject(new Error(describeError(error)));
        },
        { enableHighAccuracy: true, timeout: 15_000 },
      );
    });
  }, []);

  useEffect(() => stop, [stop]);

  return { ...state, start, stop, locateOnce };
}
