"use client";

import { MapCredit } from "@/components/MapCredit";
import type { useRide } from "@/hooks/useRide";

interface RideSheetProps {
  ride: ReturnType<typeof useRide>;
  totalSwaps: number;
  onDocked: () => void;
  onFinish: () => void;
  onDockNow: () => void;
  locationError: string | null;
}

function clock(seconds: number): string {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(safe % 60).padStart(2, "0")}`;
}

export function RideSheet({
  ride,
  totalSwaps,
  onDocked,
  onFinish,
  onDockNow,
  locationError,
}: RideSheetProps) {
  const overdue = ride.remainingSeconds <= 0;
  const urgent = ride.remainingSeconds <= 300;

  // Past the target the rider still has slack before the meter starts, so the
  // countdown switches to the real deadline instead of showing a dead zero.
  const headline = overdue ? ride.hardRemainingSeconds : ride.remainingSeconds;
  const tone = overdue ? "text-red-600" : urgent ? "text-amber-600" : "text-slate-900";

  return (
    <div className="w-full space-y-3 rounded-t-2xl bg-white p-4 pb-6 shadow-2xl">
      {ride.redirect && (
        <button
          type="button"
          onClick={ride.dismissRedirect}
          className="w-full rounded-lg bg-orange-50 px-3 py-2 text-left text-sm text-orange-900"
        >
          <span className="font-semibold">Dock changed.</span> {ride.redirect.from} filled up, now
          heading to {ride.redirect.to}.
        </button>
      )}

      {ride.pollError && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">
          Live dock counts unavailable, still heading to your current dock.
        </p>
      )}
      {locationError && (
        <p className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-600">{locationError}</p>
      )}

      <div className="flex items-center gap-4">
        <div>
          <p className={`font-mono text-5xl font-bold tabular-nums ${tone}`}>{clock(headline)}</p>
          <p className="text-xs text-slate-500">
            {overdue ? "until fees start" : "until you should dock"}
          </p>
        </div>

        <div className="min-w-0 flex-1 text-right">
          {ride.target ? (
            <>
              <p className="truncate text-sm font-semibold text-slate-900">{ride.target.name}</p>
              <p className="text-xs text-slate-500">
                {ride.target.docks > 0 ? `${ride.target.docks} docks free` : "checking docks"}
                {totalSwaps > 0 && ` · swap ${Math.min(ride.legsDone + 1, totalSwaps)} of ${totalSwaps}`}
              </p>
            </>
          ) : (
            <p className="text-sm text-slate-500">No dock selected</p>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={onDockNow}
        className="w-full rounded-xl bg-orange-500 py-4 text-lg font-bold text-white active:bg-orange-600"
      >
        DOCK NOW
      </button>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onDocked}
          className="flex-1 rounded-xl bg-slate-900 py-3.5 text-base font-semibold text-white active:bg-slate-700"
        >
          {totalSwaps > 0 && ride.legsDone >= totalSwaps
            ? "Docked, done"
            : "I've docked, restart timer"}
        </button>
        <button
          type="button"
          onClick={onFinish}
          className="rounded-xl border border-slate-300 px-4 py-3.5 text-base font-semibold text-slate-700"
        >
          End
        </button>
      </div>

      <MapCredit />
    </div>
  );
}
