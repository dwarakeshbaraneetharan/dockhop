import { describe, expect, it, vi } from "vitest";

import { travelMatrix } from "@/planner/routing";

const ORIGIN = { lat: 40.8075, lon: -73.9626 };
const TARGETS = [
  { lat: 40.8079, lon: -73.9641 },
  { lat: 40.8090, lon: -73.9610 },
];

function respond(body: unknown, ok = true): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), { status: ok ? 200 : 502 }),
  ) as unknown as typeof fetch;
}

describe("travel matrix", () => {
  it("converts Valhalla's kilometres into metres", async () => {
    const legs = await travelMatrix(
      ORIGIN,
      TARGETS,
      "pedestrian",
      respond({
        sources_to_targets: [[
          { time: 618, distance: 0.861 },
          { time: 180, distance: 0.25 },
        ]],
      }),
    );

    expect(legs).toEqual([
      { seconds: 618, meters: 861 },
      { seconds: 180, meters: 250 },
    ]);
  });

  it("snaps the origin so a drifting fix reuses one cache entry", async () => {
    const fetcher = respond({ sources_to_targets: [[{ time: 1, distance: 1 }]] });
    await travelMatrix({ lat: 40.80751234, lon: -73.96259876 }, [TARGETS[0]], "pedestrian", fetcher);

    const url = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const payload = JSON.parse(decodeURIComponent(url.split("json=")[1]));
    expect(payload.sources[0]).toMatchObject({ lat: 40.8075, lon: -73.9626 });
    // Targets are fixed infrastructure, so they are sent exactly.
    expect(payload.targets[0]).toMatchObject(TARGETS[0]);
  });

  it("keeps waterfront points off ferry routes", async () => {
    // Without this, walking from the Brooklyn Bridge to a dock 615 m away was
    // answered as a 10.9 km trip along a ferry line to New Jersey.
    const fetcher = respond({ sources_to_targets: [[{ time: 1, distance: 1 }]] });
    await travelMatrix(ORIGIN, [TARGETS[0]], "pedestrian", fetcher);

    const url = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    const payload = JSON.parse(decodeURIComponent(url.split("json=")[1]));
    expect(payload.sources[0].search_filter).toEqual({ exclude_ferry: true });
    expect(payload.targets[0].search_filter).toEqual({ exclude_ferry: true });
  });

  it("asks for the profile it was given", async () => {
    const fetcher = respond({ sources_to_targets: [[{ time: 1, distance: 1 }]] });
    await travelMatrix(ORIGIN, [TARGETS[0]], "bicycle", fetcher);

    const url = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(JSON.parse(decodeURIComponent(url.split("json=")[1])).costing).toBe("bicycle");
  });

  it("reports a single unreachable target without losing the rest", async () => {
    const legs = await travelMatrix(
      ORIGIN,
      TARGETS,
      "pedestrian",
      respond({ sources_to_targets: [[{ time: null, distance: null }, { time: 90, distance: 0.2 }]] }),
    );

    expect(legs).toEqual([null, { seconds: 90, meters: 200 }]);
  });

  // Routing is an improvement, never a dependency: every one of these has to
  // leave the caller free to fall back to a straight line rather than fail.
  it("returns null when the service errors", async () => {
    expect(await travelMatrix(ORIGIN, TARGETS, "pedestrian", respond({}, false))).toBeNull();
  });

  it("returns null when the response is not the shape we expect", async () => {
    expect(await travelMatrix(ORIGIN, TARGETS, "pedestrian", respond({ trip: {} }))).toBeNull();
  });

  it("returns null when the request throws", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("timed out");
    }) as unknown as typeof fetch;
    expect(await travelMatrix(ORIGIN, TARGETS, "pedestrian", fetcher)).toBeNull();
  });

  it("does not call out at all for an empty target list", async () => {
    const fetcher = respond({});
    expect(await travelMatrix(ORIGIN, [], "pedestrian", fetcher)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
