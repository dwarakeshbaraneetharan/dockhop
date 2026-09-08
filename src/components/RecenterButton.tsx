"use client";

interface RecenterButtonProps {
  /** Disabled until there is a fix to fly back to. */
  enabled: boolean;
  onRecentre: () => void;
}

/**
 * Snap the map back to the rider.
 *
 * Panning around to look at other docks is the normal thing to do here, and
 * every maps app has trained people that getting back is one tap in the corner
 * rather than a scroll hunt for a blue dot.
 */
export function RecenterButton({ enabled, onRecentre }: RecenterButtonProps) {
  return (
    <button
      type="button"
      onClick={onRecentre}
      disabled={!enabled}
      aria-label="Centre on my location"
      className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-slate-700 shadow-lg active:bg-slate-100 disabled:text-slate-300"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
        <circle cx="12" cy="12" r="3.25" fill="currentColor" />
        <circle
          cx="12"
          cy="12"
          r="7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        {/* Crosshair ticks, the shape every maps app uses for this. */}
        <path
          d="M12 1.5v3.25M12 19.25v3.25M1.5 12h3.25M19.25 12h3.25"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}
