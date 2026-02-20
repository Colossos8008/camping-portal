// src/app/map/map-client.tsx
"use client";

import { useEffect, useMemo, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";
type TSHaltung = "DNA" | "EXPLORER";

type PlaceImage = { id: number; filename: string };

type Place = {
  id: number;
  name: string;
  type: PlaceType;
  lat: number;
  lng: number;

  // TS2 - nur relevant für CAMPINGPLATZ / STELLPLATZ
  ts2?: { haltung?: TSHaltung | null } | null;

  images?: PlaceImage[];
  thumbnailImageId?: number | null;
  ratingDetail?: { totalPoints?: number | null } | null;

  distanceKm?: number | null;
};

type Props = {
  places: Place[];
  selectedId: number | null;
  onSelect: (id: number) => void;

  pickMode: boolean;
  onPick: (lat: number, lng: number) => void;

  focusToken: number;

  myPos: { lat: number; lng: number } | null;
  myPosFocusToken: number;

  showMyRings: boolean;
};

function makeDivIcon(html: string, size: number) {
  return L.divIcon({
    className: "cp-marker",
    html,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function typeEmoji(t: PlaceType) {
  if (t === "STELLPLATZ") return "🅿️";
  if (t === "CAMPINGPLATZ") return "⛺";
  if (t === "HVO_TANKSTELLE") return "⛽";
  return "📍";
}

function haltungEmoji(h: TSHaltung | null | undefined) {
  if (h === "EXPLORER") return "🧭";
  return "🧬";
}

function clampText(s: string, max = 46) {
  const t = String(s ?? "");
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + "…";
}

function escapeHtml(s: string) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Supabase Public URL (Bucket: place-images)
// - Fallback: /uploads/<filename> (falls Env nicht verfügbar)
function publicUrlForObjectKey(filename: string | null | undefined) {
  const key = String(filename ?? "").trim();
  if (!key) return null;

  if (key.startsWith("http://") || key.startsWith("https://")) return key;

  const supabaseUrl =
    (process.env.NEXT_PUBLIC_SUPABASE_URL as string | undefined) ||
    (process.env.SUPABASE_URL as string | undefined) ||
    "";

  const bucket =
    (process.env.NEXT_PUBLIC_SUPABASE_BUCKET as string | undefined) ||
    (process.env.SUPABASE_BUCKET as string | undefined) ||
    "place-images";

  if (supabaseUrl) {
    const base = supabaseUrl.replace(/\/+$/, "");
    const encodedKey = encodeURIComponent(key).replaceAll("%2F", "/");
    return `${base}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedKey}`;
  }

  return `/uploads/${encodeURIComponent(key)}`;
}

function heroFilename(p: Place): string | null {
  const imgs = Array.isArray(p.images) ? p.images : [];
  if (!imgs.length) return null;

  const tid = Number(p.thumbnailImageId);
  if (Number.isFinite(tid)) {
    const hit = imgs.find((x) => Number(x.id) === tid);
    if (hit?.filename) return hit.filename;
  }

  return imgs[0]?.filename ?? null;
}

type MarkerVariant = "NORMAL" | "HOVER" | "SELECTED";

function markerSize(v: MarkerVariant) {
  if (v === "SELECTED") return 40;
  if (v === "HOVER") return 38;
  return 32;
}

function markerHtml(p: Place, v: MarkerVariant) {
  const emoji = typeEmoji(p.type);

  if (v === "SELECTED") {
    return `<div style="
      width:40px;height:40px;border-radius:999px;
      display:flex;align-items:center;justify-content:center;
      background:rgba(255,255,255,0.30);
      border:2px solid rgba(255,255,255,0.92);
      box-shadow:0 16px 30px rgba(0,0,0,0.55);
      font-size:18px;
      transform:translateZ(0);
    ">${emoji}</div>`;
  }

  if (v === "HOVER") {
    return `<div style="
      width:38px;height:38px;border-radius:999px;
      display:flex;align-items:center;justify-content:center;
      background:rgba(255,255,255,0.16);
      border:2px solid rgba(255,255,255,0.62);
      box-shadow:0 16px 34px rgba(0,0,0,0.60);
      font-size:18px;
      transform:translateZ(0);
    ">${emoji}</div>`;
  }

  return `<div style="
    width:32px;height:32px;border-radius:999px;
    display:flex;align-items:center;justify-content:center;
    background:rgba(0,0,0,0.45);
    border:1px solid rgba(255,255,255,0.32);
    box-shadow:0 12px 24px rgba(0,0,0,0.40);
    font-size:16px;
    transform:translateZ(0);
  ">${emoji}</div>`;
}

function hoverTooltipHtml(p: Place) {
  const hero = heroFilename(p);
  const heroUrl = hero ? publicUrlForObjectKey(hero) : null;

  const score = Number(p.ratingDetail?.totalPoints ?? 0);
  const name = escapeHtml(clampText(p.name ?? ""));
  const typeText = escapeHtml(String(p.type ?? ""));

  const dist =
    typeof p.distanceKm === "number" && Number.isFinite(p.distanceKm)
      ? p.distanceKm < 10
        ? `${p.distanceKm.toFixed(1)} km`
        : `${p.distanceKm.toFixed(0)} km`
      : null;

  const hasTS2 = p.type === "CAMPINGPLATZ" || p.type === "STELLPLATZ";
  const hEmoji = hasTS2 ? haltungEmoji((p.ts2?.haltung ?? "DNA") as any) : null;

  const imgHtml = heroUrl
    ? `<img src="${escapeHtml(heroUrl)}" style="width:220px;height:120px;object-fit:cover;border-radius:14px;display:block;" />`
    : `<div style="width:220px;height:120px;border-radius:14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.10);"></div>`;

  return `
  <div style="
    width:240px;
    padding:10px;
    border-radius:16px;
    background:rgba(0,0,0,0.72);
    border:1px solid rgba(255,255,255,0.12);
    box-shadow:0 18px 40px rgba(0,0,0,0.55);
    backdrop-filter: blur(6px);
    color:rgba(255,255,255,0.94);
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
  ">
    <div style="border-radius:14px;overflow:hidden;">
      ${imgHtml}
    </div>

    <div style="margin-top:8px;">
      <div style="font-size:13px;font-weight:800;line-height:1.25;word-break:break-word;">
        ${name}
      </div>

      <div style="margin-top:4px;font-size:11px;opacity:0.75;">
        ${typeText}
      </div>

      <div style="margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        <div style="
          display:flex;align-items:center;gap:6px;
          padding:6px 10px;
          border-radius:999px;
          border:1px solid rgba(255,255,255,0.14);
          background:rgba(255,255,255,0.08);
          font-size:12px;
          font-weight:800;
          line-height:1;
        ">
          <span style="font-size:14px;">🍰</span>
          <span>${score}/14</span>
        </div>

        ${
          hEmoji
            ? `<div style="
                padding:6px 10px;
                border-radius:999px;
                border:1px solid rgba(255,255,255,0.12);
                background:rgba(255,255,255,0.06);
                font-size:11px;
                opacity:0.9;
              ">
                ${hEmoji} TS 2.0
              </div>`
            : ``
        }

        ${
          dist
            ? `<div style="
                padding:6px 10px;
                border-radius:999px;
                border:1px solid rgba(255,255,255,0.12);
                background:rgba(255,255,255,0.06);
                font-size:11px;
                opacity:0.9;
              ">
                📏 ${escapeHtml(dist)}
              </div>`
            : ``
        }
      </div>
    </div>
  </div>
  `;
}

function myPosHtml() {
  return `<div style="
    width:18px;height:18px;border-radius:999px;
    background:rgba(255,255,255,0.94);
    border:2px solid rgba(0,0,0,0.92);
    box-shadow:0 14px 30px rgba(0,0,0,0.60);
    position:relative;
  ">
    <div style="
      position:absolute;left:50%;top:50%;
      width:7px;height:7px;border-radius:999px;
      transform:translate(-50%,-50%);
      background:rgba(0,0,0,0.88);
      box-shadow:0 10px 20px rgba(0,0,0,0.35);
    "></div>
  </div>`;
}

function ringLabelIcon(text: string) {
  const w = text.length >= 7 ? 98 : 86;
  const h = 28;

  return L.divIcon({
    className: "cp-ring-label",
    html: `<div style="
      width:${w}px;height:${h}px;
      display:flex;align-items:center;justify-content:center;
      transform:translate(-50%,-50%);
      border-radius:999px;
      background:rgba(0,0,0,0.50);
      border:1px solid rgba(249,115,22,0.50);
      color:rgba(255,255,255,0.85);
      font-size:11px;
      font-weight:900;
      letter-spacing:0.2px;
      box-shadow:0 12px 26px rgba(0,0,0,0.35);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      white-space:nowrap;
      pointer-events:none;
    ">${escapeHtml(text)}</div>`,
    iconSize: [w, h],
    iconAnchor: [w / 2, h / 2],
  });
}

function toRad(d: number) {
  return (d * Math.PI) / 180;
}
function toDeg(r: number) {
  return (r * 180) / Math.PI;
}
function destinationPoint(lat: number, lng: number, distanceKm: number, bearingDeg: number) {
  const R = 6371;
  const brng = toRad(bearingDeg);
  const d = distanceKm / R;

  const lat1 = toRad(lat);
  const lon1 = toRad(lng);

  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(brng));
  const lon2 =
    lon1 + Math.atan2(Math.sin(brng) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));

  return { lat: toDeg(lat2), lng: ((toDeg(lon2) + 540) % 360) - 180 };
}

export default function MapClient(props: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);

  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const hoveredIdRef = useRef<number | null>(null);

  const tempLayerRef = useRef<L.LayerGroup | null>(null);
  const tempMarkerRef = useRef<L.Marker | null>(null);

  const lastTempRef = useRef<{ lat: number; lng: number } | null>(null);
  const rafMoveRef = useRef<number | null>(null);

  const selectedIdRef = useRef<number | null>(props.selectedId);
  const pickModeRef = useRef<boolean>(props.pickMode);

  const myPosMarkerRef = useRef<L.Marker | null>(null);
  const myPosRingsRef = useRef<L.LayerGroup | null>(null);

  const isMobileRef = useRef<boolean>(false);
  const lastSelectMsRef = useRef<number>(0);

  useEffect(() => {
    selectedIdRef.current = props.selectedId;
  }, [props.selectedId]);

  useEffect(() => {
    pickModeRef.current = props.pickMode;
  }, [props.pickMode]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mql = window.matchMedia("(max-width: 1023px)");
    const apply = () => {
      isMobileRef.current = !!mql.matches;
    };

    apply();

    const handler = () => apply();
    if ("addEventListener" in mql) mql.addEventListener("change", handler);
    else (mql as any).addListener(handler);

    return () => {
      if ("removeEventListener" in mql) mql.removeEventListener("change", handler);
      else (mql as any).removeListener(handler);
    };
  }, []);

  const selected = useMemo(() => {
    if (props.selectedId == null) return null;
    return props.places.find((p) => p.id === props.selectedId) ?? null;
  }, [props.places, props.selectedId]);

  useEffect(() => {
    if (!rootRef.current) return;

    if (!mapRef.current) {
      const map = L.map(rootRef.current, {
        zoomControl: true,
        attributionControl: true,
      });

      mapRef.current = map;

      const tile = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      });

      tile.addTo(map);
      tileRef.current = tile;

      map.setView([50.33, 7.6], 11);
    }

    return () => {
      if (rafMoveRef.current) {
        cancelAnimationFrame(rafMoveRef.current);
        rafMoveRef.current = null;
      }
    };
  }, []);

  function setMarkerVisual(id: number, p: Place) {
    const m = markersRef.current.get(id);
    if (!m) return;

    const isSelected = selectedIdRef.current === id;
    const isHover = hoveredIdRef.current === id;
    const v: MarkerVariant = isSelected ? "SELECTED" : isHover ? "HOVER" : "NORMAL";

    m.setIcon(makeDivIcon(markerHtml(p, v), markerSize(v)));
  }

  function safeSelect(p: Place, e?: any, marker?: L.Marker) {
    if (pickModeRef.current) return;

    const now = Date.now();
    if (now - lastSelectMsRef.current < 350) return;
    lastSelectMsRef.current = now;

    if (e?.originalEvent) {
      try {
        L.DomEvent.preventDefault(e.originalEvent);
        L.DomEvent.stopPropagation(e.originalEvent);
      } catch {}
    } else if (e) {
      try {
        L.DomEvent.preventDefault(e);
        L.DomEvent.stopPropagation(e);
      } catch {}
    }

    try {
      marker?.closeTooltip();
    } catch {}

    props.onSelect(p.id);
  }

  function applyTooltipMode(m: L.Marker, p: Place) {
    const isMobile = isMobileRef.current;

    // harte Regel - Mobile komplett ohne Tooltip
    if (isMobile) {
      try {
        m.closeTooltip();
      } catch {}
      try {
        m.unbindTooltip();
      } catch {}
      m.off("mouseover");
      m.off("mouseout");
      return;
    }

    // Desktop - Tooltip vorhanden, per Hover
    const hasTooltip = (m as any).getTooltip?.() != null;
    if (!hasTooltip) {
      m.bindTooltip(hoverTooltipHtml(p), {
        direction: "top",
        offset: L.point(0, -14),
        opacity: 1,
        sticky: true,
        className: "cp-hover-tooltip",
      });
    } else {
      m.setTooltipContent(hoverTooltipHtml(p));
    }

    m.off("mouseover");
    m.off("mouseout");

    m.on("mouseover", () => {
      if (pickModeRef.current) return;
      hoveredIdRef.current = p.id;
      setMarkerVisual(p.id, p);
      m.openTooltip();
    });

    m.on("mouseout", () => {
      if (hoveredIdRef.current === p.id) hoveredIdRef.current = null;
      setMarkerVisual(p.id, p);
      m.closeTooltip();
    });
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const aliveIds = new Set<number>();

    for (const p of props.places) {
      aliveIds.add(p.id);

      const marker = markersRef.current.get(p.id);
      const isSelected = props.selectedId === p.id;
      const isHover = hoveredIdRef.current === p.id;
      const v: MarkerVariant = isSelected ? "SELECTED" : isHover ? "HOVER" : "NORMAL";

      if (!marker) {
        const m = L.marker([p.lat, p.lng], {
          icon: makeDivIcon(markerHtml(p, v), markerSize(v)),
          keyboard: false,
        });

        m.addTo(map);

        // Tooltips: Desktop ja - Mobile nein
        applyTooltipMode(m, p);

        // Selection: Desktop click - Mobile pointerup/touchend
        m.off("click");
        m.off("touchend");
        m.off("pointerup");

        m.on("click", (e: any) => safeSelect(p, e, m));
        m.on("touchend", (e: any) => safeSelect(p, e, m));
        m.on("pointerup", (e: any) => safeSelect(p, e, m));

        markersRef.current.set(p.id, m);
      } else {
        marker.setLatLng([p.lat, p.lng]);

        // Marker UI
        setMarkerVisual(p.id, p);

        // Tooltip-Modus aktualisieren (wichtig bei Resize / Deploy-States)
        applyTooltipMode(marker, p);

        // Selection-Handler sicherstellen
        marker.off("click");
        marker.off("touchend");
        marker.off("pointerup");

        marker.on("click", (e: any) => safeSelect(p, e, marker));
        marker.on("touchend", (e: any) => safeSelect(p, e, marker));
        marker.on("pointerup", (e: any) => safeSelect(p, e, marker));
      }
    }

    for (const [id, m] of markersRef.current.entries()) {
      if (!aliveIds.has(id)) {
        m.remove();
        markersRef.current.delete(id);
      }
    }
  }, [props.places, props.selectedId, props.pickMode, props.onSelect]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!selected) return;

    map.setView([selected.lat, selected.lng], Math.max(map.getZoom(), 12), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusToken]);

  // Eigenposition: Marker + Ringe
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!props.myPos) {
      if (myPosMarkerRef.current) {
        myPosMarkerRef.current.remove();
        myPosMarkerRef.current = null;
      }
      if (myPosRingsRef.current) {
        myPosRingsRef.current.clearLayers();
        myPosRingsRef.current.remove();
        myPosRingsRef.current = null;
      }
      return;
    }

    const latlng: L.LatLngExpression = [props.myPos.lat, props.myPos.lng];

    if (!myPosMarkerRef.current) {
      myPosMarkerRef.current = L.marker(latlng, {
        icon: makeDivIcon(myPosHtml(), 22),
        interactive: false,
        zIndexOffset: 1200,
      });
      myPosMarkerRef.current.addTo(map);
    } else {
      myPosMarkerRef.current.setLatLng(latlng);
    }

    if (!props.showMyRings) {
      if (myPosRingsRef.current) {
        myPosRingsRef.current.clearLayers();
        myPosRingsRef.current.remove();
        myPosRingsRef.current = null;
      }
      return;
    }

    if (!myPosRingsRef.current) {
      myPosRingsRef.current = L.layerGroup();
      myPosRingsRef.current.addTo(map);
    } else {
      myPosRingsRef.current.clearLayers();
    }

    const radiiKm = [5, 10, 25, 50, 100];
    const ORANGE = "#f97316";

    for (const km of radiiKm) {
      const ring = L.circle(latlng, {
        radius: km * 1000,
        stroke: true,
        weight: 3,
        opacity: 0.75,
        color: ORANGE,
        fill: false,
        interactive: false,
      });

      ring.addTo(myPosRingsRef.current);
      ring.bringToFront();

      const pt = destinationPoint(props.myPos.lat, props.myPos.lng, km, 0);
      const label = L.marker([pt.lat, pt.lng], {
        icon: ringLabelIcon(`${km} km`),
        interactive: false,
        zIndexOffset: 1400,
        opacity: 0.85,
      });

      label.addTo(myPosRingsRef.current);
    }
  }, [props.myPos, props.showMyRings]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!props.myPos) return;

    map.setView([props.myPos.lat, props.myPos.lng], Math.max(map.getZoom(), 12), { animate: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.myPosFocusToken]);

  // PICK MODE
  useEffect(() => {
    const map0 = mapRef.current;
    if (!map0) return;

    const map: L.Map = map0;

    function ensureTempLayer(): L.LayerGroup {
      if (!tempLayerRef.current) {
        tempLayerRef.current = L.layerGroup();
        tempLayerRef.current.addTo(map);
      }
      return tempLayerRef.current;
    }

    function clearTempLayer() {
      if (tempMarkerRef.current) {
        tempMarkerRef.current.remove();
        tempMarkerRef.current = null;
      }
      if (tempLayerRef.current) {
        tempLayerRef.current.clearLayers();
        tempLayerRef.current.remove();
        tempLayerRef.current = null;
      }
      lastTempRef.current = null;
    }

    function ensureTempMarker(lat: number, lng: number) {
      const layer = ensureTempLayer();

      const size = 28;

      const html = `<div style="
        width:${size}px;height:${size}px;border-radius:999px;
        background:rgba(255,255,255,0.96);
        border:2px solid rgba(0,0,0,0.85);
        box-shadow:0 18px 36px rgba(0,0,0,0.65);
        position:relative;
      ">
        <div style="
          position:absolute;left:50%;top:50%;
          width:10px;height:10px;border-radius:999px;
          transform:translate(-50%,-50%);
          background:rgba(0,0,0,0.85);
          box-shadow:0 8px 16px rgba(0,0,0,0.45);
        "></div>
        <div style="
          position:absolute;left:50%;top:-10px;
          width:2px;height:${size + 20}px;
          transform:translateX(-50%);
          background:rgba(255,255,255,0.55);
          border-radius:2px;
        "></div>
        <div style="
          position:absolute;top:50%;left:-10px;
          height:2px;width:${size + 20}px;
          transform:translateY(-50%);
          background:rgba(255,255,255,0.55);
          border-radius:2px;
        "></div>
      </div>`;

      if (!tempMarkerRef.current) {
        tempMarkerRef.current = L.marker([lat, lng], {
          icon: makeDivIcon(html, 40),
          interactive: false,
        });
        tempMarkerRef.current.addTo(layer);
      } else {
        tempMarkerRef.current.setLatLng([lat, lng]);
        tempMarkerRef.current.setIcon(makeDivIcon(html, 40));
      }
    }

    function scheduleMove(lat: number, lng: number) {
      lastTempRef.current = { lat, lng };
      if (rafMoveRef.current) return;

      rafMoveRef.current = requestAnimationFrame(() => {
        rafMoveRef.current = null;
        const v = lastTempRef.current;
        if (!v) return;
        if (!props.pickMode) return;
        ensureTempMarker(v.lat, v.lng);
      });
    }

    function onMouseMove(e: L.LeafletMouseEvent) {
      if (!props.pickMode) return;
      scheduleMove(e.latlng.lat, e.latlng.lng);
    }

    function onClick(e: L.LeafletMouseEvent) {
      if (!props.pickMode) return;
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;
      ensureTempMarker(lat, lng);
      props.onPick(lat, lng);
    }

    if (props.pickMode) {
      map.on("mousemove", onMouseMove);
      map.on("click", onClick);

      const c = map.getCenter();
      ensureTempMarker(c.lat, c.lng);
    } else {
      map.off("mousemove", onMouseMove);
      map.off("click", onClick);
      clearTempLayer();
    }

    return () => {
      map.off("mousemove", onMouseMove);
      map.off("click", onClick);
    };
  }, [props.pickMode, props.onPick]);

  return (
    <div className="relative h-full w-full">
      <div ref={rootRef} className="h-full w-full" />

      {props.pickMode ? (
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute left-1/2 top-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2">
            <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-white/60" />
            <div className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-white/60" />
            <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow-[0_8px_18px_rgba(0,0,0,0.45)]" />
          </div>

          <div className="absolute left-1/2 top-4 -translate-x-1/2 rounded-xl border border-white/10 bg-black/40 px-3 py-1.5 text-xs text-white/90 backdrop-blur">
            Klick auf die Karte - setzt Koordinaten
          </div>
        </div>
      ) : null}
    </div>
  );
}