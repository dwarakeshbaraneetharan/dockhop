import { badRequest } from "../_shared";

export const dynamic = "force-dynamic";

/**
 * Address search, proxied through Photon (OpenStreetMap data, no API key).
 *
 * Proxied rather than called from the browser so results can be cached at the
 * edge and biased to the five boroughs. Photon ranks by distance from a bias
 * point, which without a bounding box happily returns a Broadway in Ohio.
 */
const PHOTON = "https://photon.komoot.io/api";
const NYC = { lat: 40.7306, lon: -73.9866 };
const NYC_BBOX = "-74.30,40.47,-73.68,40.93";

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    name?: string;
    street?: string;
    housenumber?: string;
    city?: string;
    district?: string;
    state?: string;
    osm_id?: number;
  };
}

function describe(properties: PhotonFeature["properties"]): string {
  const street = [properties.housenumber, properties.street].filter(Boolean).join(" ");
  const head = properties.name ?? street;
  const area = properties.district ?? properties.city;
  return [head, area && area !== head ? area : null].filter(Boolean).join(", ");
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) return badRequest("q is required");
  if (query.length < 3) return Response.json({ results: [] });

  const url =
    `${PHOTON}?q=${encodeURIComponent(query)}` +
    `&lat=${NYC.lat}&lon=${NYC.lon}&bbox=${NYC_BBOX}&limit=6&lang=en`;

  try {
    const response = await fetch(url, {
      cf: { cacheTtl: 86_400, cacheEverything: true },
      headers: { accept: "application/json" },
    } as RequestInit);

    if (!response.ok) throw new Error(`photon responded ${response.status}`);
    const body = (await response.json()) as { features: PhotonFeature[] };

    const results = body.features
      .map((feature) => ({
        label: describe(feature.properties),
        lat: feature.geometry.coordinates[1],
        lon: feature.geometry.coordinates[0],
      }))
      .filter((result) => result.label.length > 0);

    return Response.json({ results }, { headers: { "cache-control": "public, max-age=3600" } });
  } catch (error) {
    return Response.json({ error: "Address search is unavailable", detail: String(error) }, { status: 503 });
  }
}
