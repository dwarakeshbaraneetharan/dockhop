import { fetchStations, type StationSnapshot } from "@/gbfs/client";

export function coord(params: URLSearchParams, name: string): number | null {
  const raw = params.get(name);
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function badRequest(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/**
 * Live feed, or a 503 rather than a stale guess.
 *
 * Every endpoint here is only as trustworthy as the dock counts behind it, so
 * a feed outage has to surface as an outage. Serving the last known snapshot
 * would send riders toward docks whose state we stopped tracking.
 */
export async function loadStations(): Promise<StationSnapshot | Response> {
  try {
    return await fetchStations();
  } catch (error) {
    return Response.json(
      { error: "Citi Bike's feed is unavailable", detail: String(error) },
      { status: 503 },
    );
  }
}

export const LIVE_CACHE_HEADER = {
  // Matches the GBFS status cache so clients and the edge expire together.
  "cache-control": "public, max-age=15, s-maxage=30",
};
