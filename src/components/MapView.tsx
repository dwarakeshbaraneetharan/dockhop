"use client";

import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import { useEffect, useImperativeHandle, useRef, useState } from "react";

import type { LatLon, NearbyStation, TripPlan } from "@/lib/api";
import type { DockTarget } from "@/hooks/useRide";

import "maplibre-gl/dist/maplibre-gl.css";

// Served from public/ by scripts/copy-maplibre-worker.mjs. Next.js cannot emit
// a working module worker for MapLibre v6, and the failure is silent: vector
// tiles simply never load. Must be set before the first map is constructed.
setWorkerUrl("/maplibre-gl-worker.mjs");

/** OpenFreeMap serves OSM vector tiles with no key and no request cap. */
const STYLE = "https://tiles.openfreemap.org/styles/liberty";
const MANHATTAN: [number, number] = [-73.9866, 40.7306];

export interface MapHandle {
  /** Fly back to the rider and zoom in, the way every maps app does. */
  recentre(at: LatLon): void;
}

/** Close enough to read the streets, which is the point of asking. */
const RECENTRE_ZOOM = 16;

interface MapViewProps {
  /** React 19 passes this as an ordinary prop, so no forwardRef needed. */
  ref?: React.Ref<MapHandle>;
  stations: NearbyStation[];
  plan: TripPlan | null;
  target: DockTarget | null;
  position: LatLon | null;
  destination: LatLon | null;
  /** Where to open the map before the first location fix arrives. */
  centre: LatLon;
  /** The start the route will be planned from, shown so a bad fix is visible. */
  origin: LatLon;
  /** Riders are on a bike mid-trip and on foot before it, which changes the wording. */
  profile: "pedestrian" | "bicycle";
  /**
   * True while the rider is deliberately placing a point. A tap then means
   * "here", even on top of a dock, and must not be swallowed by a popup.
   */
  placing: boolean;
  onPickPoint: (point: LatLon) => void;
}

function stationFeatures(stations: NearbyStation[]) {
  return {
    type: "FeatureCollection" as const,
    features: stations.map((station) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [station.lon, station.lat] },
      properties: {
        name: station.name,
        docks: station.docks,
        classic: station.classic,
        minutes: station.minutes,
        routed: station.routed,
        // Drives colour: no room, nearly full, or fine.
        state: station.state,
        best: station.best,
      },
    })),
  };
}

/** Nothing left of what the rider needs, nearly none, or plenty. */
const STATE_COLOUR = [
  "match",
  ["get", "state"],
  "none", "#dc2626",
  "low", "#f59e0b",
  "#16a34a",
] as ExpressionSpecification;

/**
 * What a rider needs to judge a dock: how long it takes to get there, whether
 * there will be room, and whether there is a bike in it. Built as DOM rather
 * than an HTML string because station names come from an external feed.
 */
function dockPopupContent(
  properties: Record<string, unknown>,
  profile: "pedestrian" | "bicycle",
): HTMLElement {
  const root = document.createElement("div");
  root.className = "min-w-44 px-1 py-0.5";

  const name = document.createElement("p");
  name.className = "text-sm font-semibold text-slate-900";
  name.textContent = String(properties.name ?? "Station");
  root.append(name);

  const travel = document.createElement("p");
  travel.className = "mt-0.5 text-sm text-slate-700";
  const verb = profile === "bicycle" ? "ride" : "walk";
  travel.textContent = `${properties.minutes} min ${verb}`;
  // Straight-line numbers are marked, because the difference is the point.
  if (properties.routed === false) travel.textContent += " (estimated)";
  root.append(travel);

  // Both counts, always. Which one matters depends on whether the rider is
  // collecting a bike or returning one, and they can see that faster than the
  // app can explain it.
  const counts = document.createElement("p");
  counts.className = "mt-1 text-xs text-slate-500";
  const docks = Number(properties.docks ?? 0);
  const classic = Number(properties.classic ?? 0);
  const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
  counts.textContent = `${plural(docks, "free dock")} · ${plural(classic, "classic bike")}`;
  root.append(counts);

  if (properties.best === true) {
    const badge = document.createElement("p");
    // Amber when it is the quickest but down to its last couple, so the badge
    // never reads as reassuring about a station that is nearly picked clean.
    const low = properties.state === "low";
    badge.className = `mt-1.5 text-xs font-semibold ${low ? "text-amber-600" : "text-green-700"}`;
    const label = profile === "bicycle" ? "Quickest dock with room" : "Quickest bike from here";
    badge.textContent = low ? `${label}, and nearly out` : label;
    root.append(badge);
  }

  return root;
}

function routeFeatures(plan: TripPlan | null) {
  const features = plan
    ? plan.legs.map((leg) => ({
        type: "Feature" as const,
        geometry: {
          type: "LineString" as const,
          coordinates: [
            [leg.from.lon, leg.from.lat],
            [leg.to.lon, leg.to.lat],
          ],
        },
        properties: { kind: leg.kind },
      }))
    : [];
  return { type: "FeatureCollection" as const, features };
}

export default function MapView({
  ref,
  stations,
  plan,
  target,
  position,
  destination,
  centre,
  origin,
  profile,
  placing,
  onPickPoint,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  // State, not a ref: the data effects below have to run again once the style
  // finishes loading, otherwise anything that arrived first is dropped.
  const [ready, setReady] = useState(false);
  const markers = useRef<Marker[]>([]);
  const centred = useRef(false);
  // Only used to open the map in the right place; later changes recentre via
  // the effect below rather than rebuilding the map.
  const initialCentre = useRef(centre);
  // Held in a ref so the map's click handler always sees the current callback
  // without the map having to be torn down and rebuilt when it changes.
  const pickRef = useRef(onPickPoint);
  useEffect(() => {
    pickRef.current = onPickPoint;
  }, [onPickPoint]);
  const profileRef = useRef(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);
  const placingRef = useRef(placing);
  useEffect(() => {
    placingRef.current = placing;
  }, [placing]);
  const popup = useRef<Popup | null>(null);

  useEffect(() => {
    if (!container.current || map.current) return;

    const start = initialCentre.current;
    const instance = new MapLibreMap({
      container: container.current,
      style: STYLE,
      center: start ? [start.lon, start.lat] : MANHATTAN,
      zoom: 14,
      // Every corner of the map is covered by app chrome, so attribution is
      // rendered in the sheet instead where it is always readable.
      attributionControl: false,
    });
    map.current = instance;
    // Test hook. End-to-end tests run against a production build, so this is
    // opt-in by build flag rather than by NODE_ENV.
    if (process.env.NEXT_PUBLIC_E2E) {
      (window as unknown as { __dockhopMap?: MapLibreMap }).__dockhopMap = instance;
    }

    // Offset below the app header by --dh-top, set from the measured header.
    instance.addControl(new NavigationControl({ showCompass: false }), "top-right");
    // One handler for both jobs, so tapping a dock cannot also drop a
    // destination pin underneath the popup that just opened.
    instance.on("click", (event: MapMouseEvent) => {
      // While placing a point, a tap is an instruction, not a question.
      const hit = !placingRef.current && instance.getLayer("station-dots")
        ? instance.queryRenderedFeatures(event.point, { layers: ["station-dots"] })[0]
        : undefined;

      if (hit) {
        const [lon, lat] = (hit.geometry as GeoJSON.Point).coordinates;
        popup.current?.remove();
        popup.current = new Popup({ closeButton: false, offset: 14, maxWidth: "260px" })
          .setLngLat([lon, lat])
          .setDOMContent(dockPopupContent(hit.properties ?? {}, profileRef.current))
          .addTo(instance);
        return;
      }

      popup.current?.remove();
      pickRef.current({ lat: event.lngLat.lat, lon: event.lngLat.lng });
    });

    // A finger is not a mouse pointer; widen the target area on the dots.
    instance.on("mouseenter", "station-dots", () => {
      instance.getCanvas().style.cursor = "pointer";
    });
    instance.on("mouseleave", "station-dots", () => {
      instance.getCanvas().style.cursor = "";
    });

    instance.on("load", () => {
      instance.addSource("stations", { type: "geojson", data: stationFeatures([]) });
      instance.addSource("route", { type: "geojson", data: routeFeatures(null) });

      instance.addLayer({
        id: "route-ride",
        type: "line",
        source: "route",
        filter: ["==", ["get", "kind"], "ride"],
        paint: {
          "line-color": "#2563eb",
          "line-width": 4,
          "line-opacity": 0.85,
          "line-dasharray": [2, 1.5],
        },
      });
      instance.addLayer({
        id: "route-walk",
        type: "line",
        source: "route",
        filter: ["==", ["get", "kind"], "walk"],
        paint: {
          "line-color": "#64748b",
          "line-width": 3,
          "line-dasharray": [1, 2],
        },
      });
      // Halo under the quickest usable station, so the recommendation reads at
      // a glance without another pin competing with the route markers. It takes
      // the station's own colour, because the quickest one is sometimes down to
      // its last two bikes and the ring should not paint that as reassuring.
      instance.addLayer({
        id: "station-best-halo",
        type: "circle",
        source: "stations",
        filter: ["==", ["get", "best"], true],
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 10, 15, 20],
          "circle-color": STATE_COLOUR,
          "circle-opacity": 0.18,
          "circle-stroke-width": 2,
          "circle-stroke-color": STATE_COLOUR,
          "circle-stroke-opacity": 0.55,
        },
      });

      instance.addLayer({
        id: "station-dots",
        type: "circle",
        source: "stations",
        paint: {
          "circle-radius": [
            "interpolate",
            ["linear"],
            ["zoom"],
            11, ["case", ["get", "best"], 5, 3],
            15, ["case", ["get", "best"], 10, 7],
          ],
          "circle-color": STATE_COLOUR,
          "circle-stroke-width": ["case", ["get", "best"], 2.5, 1],
          "circle-stroke-color": "#ffffff",
          "circle-opacity": 0.95,
        },
      });

      // Travel time on the dot itself. The number is the whole reason the dock
      // ranking is not just distance, so it should not need a tap to see.
      instance.addLayer({
        id: "station-minutes",
        type: "symbol",
        source: "stations",
        minzoom: 13.5,
        layout: {
          "text-field": ["concat", ["get", "minutes"], " min"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 11,
          "text-offset": [0, 1.4],
          "text-anchor": "top",
          "text-allow-overlap": false,
          "text-optional": true,
        },
        paint: {
          "text-color": "#0f172a",
          "text-halo-color": "#ffffff",
          "text-halo-width": 1.6,
        },
      });

      setReady(true);
    });

    return () => {
      instance.remove();
      map.current = null;
      setReady(false);
    };
    // Mount-only: the map is built once and every data update is applied by
    // the effects below.
  }, []);

  useEffect(() => {
    if (!map.current || !ready) return;
    const source = map.current.getSource("stations") as GeoJSONSource | undefined;
    source?.setData(stationFeatures(stations));
  }, [stations, ready]);

  // Snap to the rider once, on the first fix. Later fixes must not yank the
  // map out from under someone who has panned somewhere deliberately.
  useEffect(() => {
    if (!map.current || !ready || !position || centred.current) return;
    centred.current = true;
    map.current.easeTo({ center: [position.lon, position.lat], zoom: 14, duration: 600 });
  }, [position, ready]);

  useImperativeHandle(ref, () => ({
    recentre(at: LatLon) {
      // Asking to come back counts as settling the camera, so the next fix
      // does not arrive and move it again.
      centred.current = true;
      map.current?.easeTo({
        center: [at.lon, at.lat],
        zoom: RECENTRE_ZOOM,
        duration: 600,
      });
    },
  }), []);

  useEffect(() => {
    if (!map.current || !ready) return;
    const source = map.current.getSource("route") as GeoJSONSource | undefined;
    source?.setData(routeFeatures(plan));

    if (!plan) return;
    const bounds = new LngLatBounds();
    for (const leg of plan.legs) {
      bounds.extend([leg.from.lon, leg.from.lat]);
      bounds.extend([leg.to.lon, leg.to.lat]);
    }
    map.current.fitBounds(bounds, { padding: { top: 70, bottom: 260, left: 50, right: 50 } });
    // A planned route is a deliberate view change, so stop the location fix
    // from stealing the camera back afterwards.
    centred.current = true;
  }, [plan, ready]);

  // Pins are rebuilt wholesale: there are never more than a handful.
  useEffect(() => {
    if (!map.current || !ready) return;
    markers.current.forEach((marker) => marker.remove());
    markers.current = [];

    const pin = (point: LatLon, color: string, label: string) => {
      const element = document.createElement("div");
      element.className = "dh-pin";
      element.style.background = color;
      element.textContent = label;
      markers.current.push(
        new Marker({ element })
          .setLngLat([point.lon, point.lat])
          .addTo(map.current!),
      );
    };

    if (plan) {
      pin(plan.start, "#16a34a", "A");
      plan.swaps.forEach((swap, index) => pin(swap, "#2563eb", String(index + 1)));
      pin(plan.end, "#0f172a", "B");
    } else {
      // Shown before planning so a wrong start is obvious on the map rather
      // than only in a route that begins somewhere strange.
      pin(origin, "#16a34a", "A");
      if (destination) pin(destination, "#0f172a", "B");
    }

    if (target) pin(target, "#f97316", "!");
    if (position) pin(position, "#0ea5e9", "•");
  }, [plan, target, position, destination, origin, ready]);

  // The wrapper owns the positioning and the inner div owns the map. MapLibre's
  // stylesheet sets `.maplibregl-map { position: relative }` and loads after
  // Tailwind, so an `absolute inset-0` applied directly to the map container
  // loses the cascade at equal specificity, collapses to zero height, and then
  // clips its own canvas with `overflow: hidden`.
  return (
    <div className="absolute inset-0">
      <div ref={container} className="h-full w-full" />
    </div>
  );
}
