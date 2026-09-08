"use client";

import type { DockOption } from "@/lib/api";

interface DockNowSheetProps {
  options: DockOption[];
  onPick: (option: DockOption) => void;
  onClose: () => void;
}

export function DockNowSheet({ options, onPick, onClose }: DockNowSheetProps) {
  return (
    <div className="absolute inset-0 z-30 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="rounded-t-2xl bg-white p-4 pb-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-900">Nearest open docks</h2>
          <button type="button" onClick={onClose} className="text-sm text-slate-500">
            Close
          </button>
        </div>

        {options.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">
            No station with a free dock within riding distance.
          </p>
        ) : (
          <ul className="space-y-1">
            {options.map((option, index) => {
              // Quicker to reach than the one being recommended, but ranked
              // below it because it might not have room left on arrival.
              // Unsaid, the list simply looks mis-sorted.
              const passedOver =
                index > 0 && option.tight && option.minutes <= options[0].minutes;

              return (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => onPick(option)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-slate-100"
                  >
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white ${
                        index === 0 ? "bg-orange-500" : "bg-slate-400"
                      }`}
                    >
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium text-slate-900">
                        {option.name}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {option.minutes} min ride · {option.meters} m ·{" "}
                        {option.docks} docks free
                      </span>
                      {passedOver && (
                        <span className="block text-xs text-amber-600">
                          Closer, but it may fill before you arrive
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-2 px-3 text-xs text-slate-400">
          Ranked by arrival time with dock risk included, so a roomier station can beat a closer one.
        </p>
      </div>
    </div>
  );
}
