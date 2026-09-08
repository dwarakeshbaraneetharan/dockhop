"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DockNowSheet } from "@/components/DockNowSheet";
import { ModeToggle } from "@/components/ModeToggle";
import { PlanSheet } from "@/components/PlanSheet";
import { RecenterButton } from "@/components/RecenterButton";
import { RideSheet } from "@/components/RideSheet";
import { SearchBox } from "@/components/SearchBox";
import { StartRow } from "@/components/StartRow";
import { useGeolocation } from "@/hooks/useGeolocation";
import { toTarget, useRide, type DockTarget } from "@/hooks/useRide";
import {
  fetchDockOptions,
  fetchNearbyStations,
  fetchPlan,
  type DockOption,
  type LatLon,
  type NearbyStation,
  type TripPlan,
} from "@/lib/api";
import { recordRide, useSavings } from "@/lib/savings";
import type { MapHandle } from "@/components/MapView";
import type { RideMode } from "@/planner/types";

const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-slate-200" />,
});

/** Until location is granted, centre somewhere with dense Citi Bike coverage. */
const FALLBACK_CENTRE: LatLon = { lat: 40.8075, lon: -73.9626 };

export default function Home() {
  const [mode, setMode] = useState<RideMode>("member");
  const [origin, setOrigin] = useState<LatLon>(FALLBACK_CENTRE);
  const [destination, setDestination] = useState<LatLon | null>(null);
  const [destinationLabel, setDestinationLabel] = useState("");
  // A start the rider placed by hand outranks any location fix.
  const [originIsManual, setOriginIsManual] = useState(false);
  const [picking, setPicking] = useState<"start" | "destination">("destination");

  const [stations, setStations] = useState<NearbyStation[]>([]);
  const [plan, setPlan] = useState<TripPlan | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  const [dockOptions, setDockOptions] = useState<DockOption[] | null>(null);

  const geo = useGeolocation();
  const ride = useRide(mode);
  const savings = useSavings();

  // The header covers the map's top-right corner, so the zoom controls are
  // pushed below it. Measured rather than hardcoded because the header loses
  // rows once a ride starts. Written straight to a CSS variable to keep this
  // out of the render cycle.
  const rootRef = useRef<HTMLElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapHandle>(null);
  useEffect(() => {
    const header = headerRef.current;
    const root = rootRef.current;
    if (!header || !root) return;

    const apply = () => root.style.setProperty("--dh-top", `${header.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => observer.disconnect();
  }, []);

  const { locateOnce } = geo;
  // Not named use*: it is a plain callback, not a hook.
  const locateMe = useCallback(() => {
    // Best effort. A denied prompt just leaves the fallback centre in place.
    locateOnce()
      .then((position) => {
        setOrigin({ lat: position.lat, lon: position.lon });
        setOriginIsManual(false);
        setPlan(null);
      })
      .catch(() => undefined);
  }, [locateOnce]);

  useEffect(() => {
    locateMe();
  }, [locateMe]);

  // A hand-placed start must not be overwritten by a later location fix.
  const centreLat = originIsManual ? origin.lat : geo.position?.lat ?? origin.lat;
  const centreLon = originIsManual ? origin.lon : geo.position?.lon ?? origin.lon;
  const activeOrigin = useMemo<LatLon>(
    () => ({ lat: centreLat, lon: centreLon }),
    [centreLat, centreLon],
  );

  // Mid-ride the rider is on a bike, so the docks around them should be ranked
  // by how long it takes to ride there, not to walk.
  const profile = ride.riding ? "bicycle" : "pedestrian";

  // Quantised to roughly 55 m. Nearby docks are routed server-side, and a phone
  // standing still emits a steady drizzle of slightly different fixes; without
  // this each one would ask a free routing service to recompute the same matrix.
  const anchorLat = Math.round(centreLat * 2000) / 2000;
  const anchorLon = Math.round(centreLon * 2000) / 2000;

  useEffect(() => {
    const controller = new AbortController();
    fetchNearbyStations(
      { lat: anchorLat, lon: anchorLon },
      1500,
      controller.signal,
      profile,
    )
      .then((response) => setStations(response.stations))
      .catch(() => undefined);
    return () => controller.abort();
  }, [anchorLat, anchorLon, profile]);

  const { reportPosition } = ride;
  useEffect(() => {
    reportPosition(geo.position);
  }, [geo.position, reportPosition]);

  /** The dock to aim at once `docked` legs of the plan are behind us. */
  const targetAfter = useCallback(
    (docked: number): DockTarget | null => {
      if (!plan) return null;
      const swap = plan.swaps[docked];
      if (swap) {
        return { id: swap.stationId, name: swap.name, lat: swap.lat, lon: swap.lon, docks: swap.docks };
      }
      return { id: plan.end.id, name: plan.end.name, lat: plan.end.lat, lon: plan.end.lon, docks: 0 };
    },
    [plan],
  );

  const runPlan = useCallback(
    async (to: LatLon, forMode: RideMode) => {
      setPlanning(true);
      setPlanError(null);
      try {
        const result = await fetchPlan(activeOrigin, to, forMode);
        if (result.feasible) {
          setPlan(result);
        } else {
          setPlan(null);
          setPlanError(result.message);
        }
      } catch (error) {
        setPlan(null);
        setPlanError(error instanceof Error ? error.message : "Could not plan that trip");
      } finally {
        setPlanning(false);
      }
    },
    [activeOrigin],
  );

  // The leg budget is what shapes the route, so switching pass type re-plans.
  // Done here rather than in an effect: it is a thing the rider just did.
  const changeMode = useCallback(
    (next: RideMode) => {
      setMode(next);
      if (plan && destination && !ride.riding) void runPlan(destination, next);
    },
    [plan, destination, ride.riding, runPlan],
  );

  const startRide = useCallback(() => {
    if (!plan) return;
    geo.start();
    ride.startLeg(targetAfter(0));
    if (plan.savingsUsd > 0) recordRide(plan.savingsUsd, plan.overageMinutesAvoided);
  }, [plan, geo, ride, targetAfter]);

  const handleDocked = useCallback(() => {
    ride.confirmDocked(targetAfter(ride.legsDone + 1));
  }, [ride, targetAfter]);

  const finishRide = useCallback(() => {
    ride.endRide();
    geo.stop();
    setPlan(null);
  }, [ride, geo]);

  const openDockNow = useCallback(async () => {
    try {
      const { options } = await fetchDockOptions(geo.position ?? activeOrigin);
      setDockOptions(options);
    } catch {
      setDockOptions([]);
    }
  }, [geo.position, activeOrigin]);

  const chooseDock = useCallback(
    (option: DockOption) => {
      setDockOptions(null);
      if (ride.riding) ride.setTarget(toTarget(option));
      else {
        geo.start();
        ride.startLeg(toTarget(option));
      }
    },
    [ride, geo],
  );

  return (
    <main ref={rootRef} className="relative h-dvh w-full overflow-hidden bg-slate-100">
      <MapView
        ref={mapRef}
        stations={stations}
        plan={plan}
        target={ride.target}
        position={geo.position}
        destination={destination}
        centre={activeOrigin}
        origin={activeOrigin}
        profile={profile}
        placing={picking === "start"}
        onPickPoint={(point) => {
          if (ride.riding) return;
          setPlan(null);
          if (picking === "start") {
            setOrigin(point);
            setOriginIsManual(true);
            setPicking("destination");
            return;
          }
          setDestination(point);
          setDestinationLabel(`Pin at ${point.lat.toFixed(4)}, ${point.lon.toFixed(4)}`);
        }}
      />

      <div
        ref={headerRef}
        className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-3"
      >
        <div className="pointer-events-auto flex items-center gap-2">
          <ModeToggle mode={mode} onChange={changeMode} disabled={ride.riding} />
          {savings.totalUsd > 0 && (
            <span className="ml-auto rounded-full bg-emerald-600 px-3 py-1.5 text-sm font-semibold text-white shadow-lg">
              ${savings.totalUsd.toFixed(2)} saved
            </span>
          )}
        </div>

        {!ride.riding && (
          <div className="pointer-events-auto">
            <StartRow
              accuracy={originIsManual ? null : geo.position?.accuracy ?? null}
              manual={originIsManual}
              picking={picking === "start"}
              onPick={() => setPicking("start")}
              onCancel={() => setPicking("destination")}
              onUseLocation={locateMe}
            />
          </div>
        )}

        {!ride.riding && (
          <div className="pointer-events-auto">
            <SearchBox
              value={destinationLabel}
              onChange={setDestinationLabel}
              onSelect={(result) => {
                setDestination({ lat: result.lat, lon: result.lon });
                setDestinationLabel(result.label);
                setPlan(null);
              }}
            />
          </div>
        )}
      </div>

      {/* One column, so the recentre button rides above whichever sheet is up
          instead of having to measure it. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex flex-col items-end">
        <div className="pointer-events-auto p-3">
          <RecenterButton
            enabled={geo.position !== null}
            onRecentre={() => geo.position && mapRef.current?.recentre(geo.position)}
          />
        </div>

        <div className="pointer-events-auto w-full">
          {ride.riding ? (
            <RideSheet
              ride={ride}
              totalSwaps={plan?.swaps.length ?? 0}
              onDocked={handleDocked}
              onFinish={finishRide}
              onDockNow={openDockNow}
              locationError={geo.error}
            />
          ) : (
            <PlanSheet
              plan={plan}
              planning={planning}
              error={planError}
              hasDestination={destination !== null}
              onPlan={() => destination && void runPlan(destination, mode)}
              onStart={startRide}
              onDockNow={openDockNow}
            />
          )}
        </div>
      </div>

      {dockOptions !== null && (
        <DockNowSheet
          options={dockOptions}
          onPick={chooseDock}
          onClose={() => setDockOptions(null)}
        />
      )}
    </main>
  );
}
