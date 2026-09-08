import type { LatLon } from "./api";

/**
 * Hand navigation off to Google Maps.
 *
 * DockHop's job is deciding which docks to use and when to swap; turn-by-turn
 * directions to a street corner is a solved problem that Google does better
 * than anything worth building here. Linking out by coordinate keeps the
 * handoff exact, since dock names are ambiguous and often not searchable.
 *
 * The origin is deliberately left off so Maps starts from the phone's own
 * position, which is a better fix than the one this app is working from.
 */
export function googleMapsDirections(
  to: LatLon,
  travelMode: "walking" | "bicycling",
): string {
  const destination = `${to.lat},${to.lon}`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=${travelMode}`;
}
