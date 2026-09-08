"use client";

import { MODES } from "@/planner/modes";
import type { RideMode } from "@/planner/types";

interface ModeToggleProps {
  mode: RideMode;
  onChange: (mode: RideMode) => void;
  disabled?: boolean;
}

export function ModeToggle({ mode, onChange, disabled }: ModeToggleProps) {
  return (
    <div className="inline-flex rounded-full bg-white p-1 shadow-lg" role="radiogroup" aria-label="Pass type">
      {(Object.keys(MODES) as RideMode[]).map((id) => {
        const config = MODES[id];
        const active = id === mode;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(id)}
            className={`rounded-full px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${
              active ? "bg-slate-900 text-white" : "text-slate-600"
            }`}
          >
            {config.includedMinutes} min
            <span className="ml-1 hidden text-xs font-normal opacity-70 sm:inline">
              {id === "member" ? "member" : "day pass"}
            </span>
          </button>
        );
      })}
    </div>
  );
}
