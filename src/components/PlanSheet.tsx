"use client";

import { MapCredit } from "@/components/MapCredit";
import type { LatLon, TripPlan } from "@/lib/api";
import { googleMapsDirections } from "@/lib/maps";

/** Every stop is a place the rider has to physically get to, so every stop links out. */
function StopLink({
  at,
  travelMode,
  children,
}: {
  at: LatLon;
  travelMode: "walking" | "bicycling";
  children: React.ReactNode;
}) {
  return (
    <a
      href={googleMapsDirections(at, travelMode)}
      target="_blank"
      rel="noopener noreferrer"
      className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500"
    >
      {children}
    </a>
  );
}

interface PlanSheetProps {
  plan: TripPlan | null;
  planning: boolean;
  error: string | null;
  hasDestination: boolean;
  onPlan: () => void;
  onStart: () => void;
  onDockNow: () => void;
}

export function PlanSheet({
  plan,
  planning,
  error,
  hasDestination,
  onPlan,
  onStart,
  onDockNow,
}: PlanSheetProps) {
  return (
    <div className="w-full rounded-t-2xl bg-white p-4 pb-6 shadow-2xl">
      {error && (
        <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{error}</p>
      )}

      {plan ? (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <div>
              <p className="text-2xl font-semibold text-slate-900">
                {plan.swaps.length === 0
                  ? "No swap needed"
                  : `${plan.swaps.length} swap${plan.swaps.length > 1 ? "s" : ""}`}
              </p>
              <p className="text-sm text-slate-500">
                {plan.totalMinutes} min total, longest leg {plan.longestLegMinutes} min
              </p>
            </div>
            {plan.savingsUsd > 0 && (
              <div className="text-right">
                <p className="text-2xl font-semibold text-emerald-600">
                  ${plan.savingsUsd.toFixed(2)}
                </p>
                <p className="text-xs text-slate-500">saved</p>
              </div>
            )}
          </div>

          <ol className="max-h-48 space-y-1 overflow-y-auto text-sm">
            <li className="flex gap-3 py-1">
              <span className="w-12 shrink-0 text-right font-mono text-xs text-slate-400">start</span>
              <span className="text-slate-700">
                {/* Walked to, unlike everything below it. */}
                <StopLink at={plan.start} travelMode="walking">
                  {plan.start.name}
                </StopLink>
              </span>
            </li>
            {plan.swaps.map((swap, index) => (
              <li key={swap.stationId} className="flex gap-3 py-1">
                <span className="w-12 shrink-0 text-right font-mono text-xs text-slate-400">
                  {swap.arrivesAtMinute} min
                </span>
                <span className="text-slate-900">
                  <span className="font-medium">Swap {index + 1}:</span>{" "}
                  <StopLink at={swap} travelMode="bicycling">
                    {swap.name}
                  </StopLink>
                  <span className="ml-1 text-slate-400">({swap.docks} docks)</span>
                </span>
              </li>
            ))}
            <li className="flex gap-3 py-1">
              <span className="w-12 shrink-0 text-right font-mono text-xs text-slate-400">end</span>
              <span className="text-slate-700">
                <StopLink at={plan.end} travelMode="bicycling">
                  {plan.end.name}
                </StopLink>
              </span>
            </li>
          </ol>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={onStart}
              className="flex-1 rounded-xl bg-slate-900 py-3.5 text-base font-semibold text-white active:bg-slate-700"
            >
              Start ride
            </button>
            <button
              type="button"
              onClick={onDockNow}
              className="rounded-xl border border-slate-300 px-4 py-3.5 text-base font-semibold text-slate-700"
            >
              Dock now
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Set a destination and DockHop plans where to swap bikes so no leg crosses the
            free-ride limit.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onPlan}
              disabled={!hasDestination || planning}
              className="flex-1 rounded-xl bg-slate-900 py-3.5 text-base font-semibold text-white disabled:bg-slate-300 active:bg-slate-700"
            >
              {planning ? "Planning..." : "Plan route"}
            </button>
            <button
              type="button"
              onClick={onDockNow}
              className="rounded-xl border border-slate-300 px-4 py-3.5 text-base font-semibold text-slate-700"
            >
              Dock now
            </button>
          </div>
        </div>
      )}

      <MapCredit />
    </div>
  );
}
