"use client";

interface StartRowProps {
  /** Metres of uncertainty on the last fix, if it came from the browser. */
  accuracy: number | null;
  manual: boolean;
  picking: boolean;
  onPick: () => void;
  onCancel: () => void;
  onUseLocation: () => void;
}

/**
 * Desktop browsers locate by WiFi and IP, which can be miles out, and a start
 * point that is quietly wrong produces a route that looks broken rather than
 * inaccurate. So the start is always stated, and always correctable.
 */
export function StartRow({
  accuracy,
  manual,
  picking,
  onPick,
  onCancel,
  onUseLocation,
}: StartRowProps) {
  if (picking) {
    return (
      <div className="flex items-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-sm text-white shadow-lg">
        <span className="flex-1">Tap the map to set your start</span>
        <button type="button" onClick={onCancel} className="font-semibold text-slate-300">
          Cancel
        </button>
      </div>
    );
  }

  const rough = accuracy !== null && accuracy > 300;

  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 text-sm shadow-lg">
      <span className="shrink-0 text-slate-400">From</span>
      <span className="min-w-0 flex-1 truncate text-slate-700">
        {manual ? (
          "Dropped pin"
        ) : (
          <>
            Your location
            {accuracy !== null && (
              <span className={rough ? "ml-1 text-amber-600" : "ml-1 text-slate-400"}>
                ±{Math.round(accuracy)} m
              </span>
            )}
          </>
        )}
      </span>
      {manual ? (
        <button type="button" onClick={onUseLocation} className="shrink-0 font-semibold text-blue-600">
          Use my location
        </button>
      ) : (
        <button type="button" onClick={onPick} className="shrink-0 font-semibold text-blue-600">
          Change
        </button>
      )}
    </div>
  );
}
