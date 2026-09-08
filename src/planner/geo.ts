import type { LatLon } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineMeters(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Local equirectangular projection to metres, centred on `origin`.
 *
 * Over a corridor a few kilometres wide the distortion is far below the error
 * in the travel model, and it turns point-to-segment distance into plane
 * geometry instead of spherical trigonometry.
 */
function project(point: LatLon, origin: LatLon): { x: number; y: number } {
  const latScale = Math.cos(toRad(origin.lat));
  return {
    x: toRad(point.lon - origin.lon) * latScale * EARTH_RADIUS_M,
    y: toRad(point.lat - origin.lat) * EARTH_RADIUS_M,
  };
}

/** Perpendicular distance from `point` to the segment `a`-`b`, clamped at the ends. */
export function distanceToSegmentMeters(point: LatLon, a: LatLon, b: LatLon): number {
  const p = project(point, a);
  const q = project(b, a);

  const lengthSq = q.x * q.x + q.y * q.y;
  if (lengthSq === 0) return Math.hypot(p.x, p.y);

  const t = Math.max(0, Math.min(1, (p.x * q.x + p.y * q.y) / lengthSq));
  return Math.hypot(p.x - t * q.x, p.y - t * q.y);
}

/**
 * How far along the segment `a`-`b` the point projects, from 0 to 1.
 * Used to keep the search moving toward the destination.
 */
export function progressAlongSegment(point: LatLon, a: LatLon, b: LatLon): number {
  const p = project(point, a);
  const q = project(b, a);

  const lengthSq = q.x * q.x + q.y * q.y;
  if (lengthSq === 0) return 0;
  return Math.max(0, Math.min(1, (p.x * q.x + p.y * q.y) / lengthSq));
}
