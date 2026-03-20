// src/app/map/map-client.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { isGooglePhotoReference } from "@/lib/hero-image";
import { isHeroDebugPoiId, isHeroDebugPoiName } from "@/lib/hero-debug";
import { aggregatePlacesByZoom } from "./_lib/map-aggregates";
import type { MapAggregate } from "./_lib/types";
import { getSupabasePublicUrl } from "./_lib/image-url";
import { getCampingStance, getPlaceScore, getPlaceTypeLabel, getSightseeingMeta } from "./_lib/place-display";

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
  heroImageUrl?: string | null;
  thumbnailImageId?: number | null;
  ratingDetail?: { totalPoints?: number | null } | null;
  sightseeingTotalScore?: number | null;
  sightRelevanceType?: string | null;
  sightVisitModePrimary?: string | null;
  sightCategory?: string | null;

  distanceKm?: number | null;
  updatedAt?: string | null;
  activeTripOrder?: number | null;
  activeTripStatus?: string | null;
  activeTripColor?: string | null;
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
  tripRoute?: Array<{ lat: number; lng: number }>;
  tripColor?: string | null;
  aggregateQuery: {
    showStellplatz: boolean;
    showCampingplatz: boolean;
    showSehens: boolean;
    showHvoTankstelle: boolean;
    dog: boolean;
    san: boolean;
    year: boolean;
    online: boolean;
    gastro: boolean;
    reviewFilter: "ALL" | "UNREVIEWED" | "CORRECTED" | "CONFIRMED" | "REJECTED";
    selectedTripId: number | null;
    tripOnlyMode: boolean;
  };
};

const markerIconCache = new Map<string, L.Icon | L.DivIcon>();
const MAP_MARKER_ASPECT_RATIO = 530 / 361;
const MARKER_BOX_PADDING_X = 12;
const MARKER_BOX_PADDING_Y = 8;

function makeDivIcon(html: string, size: number) {
  const pinHeight = Math.round(size * 1.32);
  return L.divIcon({
    className: "cp-marker",
    html,
    iconSize: [size, pinHeight],
    iconAnchor: [size / 2, pinHeight - 2],
  });
}

function makeImageIcon(type: PlaceType, size: number) {
  const cacheKey = `${type}:${size}`;
  const hit = markerIconCache.get(cacheKey);
  if (hit) return hit;
  const pinHeight = Math.round(size * MAP_MARKER_ASPECT_RATIO);
  const iconWidth = size + MARKER_BOX_PADDING_X;
  const iconHeight = pinHeight + MARKER_BOX_PADDING_Y;
  const icon = L.divIcon({
    className: "cp-marker-native",
    html: `<img
      src="${markerAssetSrc(type)}"
      alt=""
      draggable="false"
      style="
        width:${size}px;
        height:${pinHeight}px;
        display:block;
        margin:0 auto;
        filter:drop-shadow(0 8px 14px rgba(0,0,0,0.28));
        pointer-events:none;
        user-select:none;
      "
    />`,
    iconSize: [iconWidth, iconHeight],
    iconAnchor: [iconWidth / 2, pinHeight - 1],
    popupAnchor: [0, -pinHeight + 10],
  });
  markerIconCache.set(cacheKey, icon);
  return icon;
}

function markerAssetSrc(t: PlaceType) {
  if (t === "CAMPINGPLATZ") return "/icons/map-marker-camping.svg";
  if (t === "STELLPLATZ") return "/icons/map-marker-stellplatz.svg";
  if (t === "HVO_TANKSTELLE") return "/icons/map-marker-hvo.svg";
  return "/icons/map-marker-sehenswuerdigkeit.svg";
}

function typeGlyphHtml(t: PlaceType, pixelSize: number) {
  return `<img
    src="${markerAssetSrc(t)}"
    alt=""
    draggable="false"
    style="width:${pixelSize}px;height:${pixelSize}px;display:block;filter:drop-shadow(0 6px 12px rgba(0,0,0,0.22));"
  />`;
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

function heroFilename(p: Place): string | null {
  const heroImageUrl = String(p.heroImageUrl ?? "").trim();
  const debugVersion = isHeroDebugPoiName(p.name) && p.updatedAt ? `v=${encodeURIComponent(String(p.updatedAt))}` : "";
  const withDebugVersion = (url: string): string => {
    if (!debugVersion || !url.startsWith("/api/places/")) return url;
    return `${url}${url.includes("?") ? "&" : "?"}${debugVersion}`;
  };

  if (heroImageUrl) {
    if (isGooglePhotoReference(heroImageUrl)) return withDebugVersion(`/api/places/${p.id}/hero`);
    return withDebugVersion(heroImageUrl);
  }

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
  if (v === "SELECTED") return 50;
  if (v === "HOVER") return 46;
  return 40;
}

function markerHtml(p: Place, v: MarkerVariant) {
  const tripColor = typeof p.activeTripColor === "string" && p.activeTripColor.trim() ? p.activeTripColor : null;
  const glyph = typeGlyphHtml(p.type, v === "SELECTED" ? 40 : v === "HOVER" ? 38 : 32);

  const badge =
    typeof p.activeTripOrder === "number" && Number.isFinite(p.activeTripOrder)
      ? `<div style="
          position:absolute;right:-5px;top:-7px;
          min-width:19px;height:19px;padding:0 5px;border-radius:999px;
          display:flex;align-items:center;justify-content:center;
          background:${tripColor ?? "#f97316"};color:white;font-size:11px;font-weight:900;
          border:2px solid rgba(0,0,0,0.72);
          box-shadow:0 8px 18px rgba(0,0,0,0.38);
        ">${Math.round(p.activeTripOrder)}</div>`
      : "";
  const tripOutline = tripColor
    ? `<div style="position:absolute;inset:0;border-radius:999px;box-shadow:0 0 0 2px ${tripColor} inset;"></div>`
    : "";

  if (v === "SELECTED") {
    return `<div style="position:relative;width:40px;height:50px;filter:drop-shadow(0 12px 22px rgba(0,0,0,0.42));">
      <div style="position:relative;width:40px;height:50px;transform:translateZ(0);">
        ${glyph}
        ${tripOutline}
      </div>
      ${badge}
    </div>`;
  }

  if (v === "HOVER") {
    return `<div style="position:relative;width:38px;height:48px;filter:drop-shadow(0 10px 18px rgba(0,0,0,0.36));opacity:.96;">
      <div style="position:relative;width:38px;height:48px;transform:translateZ(0);">
        ${glyph}
        ${tripOutline}
      </div>
      ${badge}
    </div>`;
  }

  return `<div style="position:relative;width:32px;height:42px;filter:drop-shadow(0 8px 14px rgba(0,0,0,0.32));">
    <div style="position:relative;width:32px;height:42px;transform:translateZ(0);">
      ${glyph}
      ${tripOutline}
    </div>
    ${badge}
  </div>`;
}

function simplifiedMarkerColor(type: PlaceType) {
  if (type === "CAMPINGPLATZ") return "#3ac41b";
  if (type === "STELLPLATZ") return "#0071d2";
  if (type === "SEHENSWUERDIGKEIT") return "#fb7102";
  return "#159c92";
}

function darkenHex(hex: string, amount = 0.22) {
  const normalized = hex.replace("#", "");
  const full = normalized.length === 3 ? normalized.split("").map((char) => char + char).join("") : normalized;
  const clamp = (value: number) => Math.max(0, Math.min(255, Math.round(value)));
  const r = clamp(parseInt(full.slice(0, 2), 16) * (1 - amount));
  const g = clamp(parseInt(full.slice(2, 4), 16) * (1 - amount));
  const b = clamp(parseInt(full.slice(4, 6), 16) * (1 - amount));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function mapViewportWidthKm(map: L.Map) {
  const bounds = map.getBounds();
  const centerLat = bounds.getCenter().lat;
  return haversineKm(centerLat, bounds.getWest(), centerLat, bounds.getEast());
}

function aggregateBadgeHtml(item: MapAggregate) {
  const color = simplifiedMarkerColor(item.dominantType);
  const darker = darkenHex(color, 0.22);
  const size = item.count >= 250 ? 46 : item.count >= 100 ? 42 : item.count >= 25 ? 38 : item.count >= 10 ? 34 : 30;
  const fontSize = item.count >= 100 ? 11 : 12;
  const count = item.count > 999 ? "999+" : String(item.count);

  return `<div style="
    width:${size}px;
    height:${size}px;
    border-radius:999px;
    display:flex;
    align-items:center;
    justify-content:center;
    background:linear-gradient(180deg, ${color}, ${darker});
    color:white;
    border:2px solid rgba(255,255,255,0.96);
    box-shadow:0 12px 28px rgba(0,0,0,0.26), inset 0 1px 0 rgba(255,255,255,0.22);
    font-size:${fontSize}px;
    font-weight:900;
    letter-spacing:0.2px;
    position:relative;
  ">
    <div style="
      position:absolute;
      inset:2px;
      border-radius:999px;
      border:1px solid rgba(255,255,255,0.16);
      pointer-events:none;
    "></div>
    ${count}
  </div>`;
}

function makeAggregateIcon(item: MapAggregate) {
  const size = item.count >= 250 ? 46 : item.count >= 100 ? 42 : item.count >= 25 ? 38 : item.count >= 10 ? 34 : 30;
  return L.divIcon({
    className: "cp-aggregate-marker",
    html: aggregateBadgeHtml(item),
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function aggregateCellPx(widthKm: number, aggregateQuery: Props["aggregateQuery"]) {
  let cellPx = 56;
  if (widthKm > 240) cellPx = 92;
  else if (widthKm > 160) cellPx = 84;
  else if (widthKm > 100) cellPx = 76;
  else if (widthKm > 50) cellPx = 68;
  else if (widthKm > 20) cellPx = 60;

  if (aggregateQuery.showHvoTankstelle) cellPx += 8;
  return String(cellPx);
}

function aggregateCellPxNumber(widthKm: number, aggregateQuery: Props["aggregateQuery"]) {
  return Number(aggregateCellPx(widthKm, aggregateQuery));
}

function simplifiedCanvasStyle(p: Place) {
  const tripColor = typeof p.activeTripColor === "string" && p.activeTripColor.trim() ? p.activeTripColor : "#f97316";
  const isTripStop = typeof p.activeTripOrder === "number" && Number.isFinite(p.activeTripOrder);
  const baseColor = isTripStop ? tripColor : simplifiedMarkerColor(p.type);
  return {
    radius: isTripStop ? 7 : 5,
    color: isTripStop ? tripColor : "#fff7ed",
    weight: isTripStop ? 2 : 1.5,
    opacity: 0.95,
    fillColor: baseColor,
    fillOpacity: isTripStop ? 0.7 : 0.9,
  };
}

function hoverTooltipHtml(p: Place) {
  const hero = heroFilename(p);
  const heroUrl = hero ? getSupabasePublicUrl(hero, { placeId: p.id }) : null;

  const isSightseeing = p.type === "SEHENSWUERDIGKEIT";
  const score = getPlaceScore(p as any);

  const sightseeingMeta = getSightseeingMeta(p as any);
  const stance = getCampingStance(p as any);
  const name = escapeHtml(clampText(p.name ?? ""));
  const typeText = escapeHtml(getPlaceTypeLabel(p.type));
  const category = sightseeingMeta?.category ?? null;
  const relevance = sightseeingMeta?.relevance ?? null;
  const visitMode = sightseeingMeta?.visitMode ?? null;
  const hEmoji = stance?.icon ?? null;

  const dist =
    typeof p.distanceKm === "number" && Number.isFinite(p.distanceKm)
      ? p.distanceKm < 10
        ? `${p.distanceKm.toFixed(1)} km`
        : `${p.distanceKm.toFixed(0)} km`
      : null;

  const heroDebugEnabled = isHeroDebugPoiId(p.id);
  const debugInfoHtml = heroDebugEnabled
    ? `<div style="margin-top:6px;font-size:10px;line-height:1.3;opacity:0.85;word-break:break-word;">src=${escapeHtml(heroUrl || "(empty)")}</div>`
    : "";

  const imgHtml = heroUrl
    ? `<img src="${escapeHtml(heroUrl)}" style="width:220px;height:120px;object-fit:cover;border-radius:14px;display:block;" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.src=this.src+(this.src.includes('?')?'&':'?')+'ui_retry=1';return;}this.style.display='none';this.insertAdjacentHTML('afterend','<div style=&quot;width:220px;height:120px;border-radius:14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.10);display:flex;align-items:center;justify-content:center;font-size:10px;opacity:.85;&quot;>Hero failed</div>');" />`
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
    pointer-events:none;
  ">
    <div style="border-radius:14px;overflow:hidden;">
      ${imgHtml}
      ${debugInfoHtml}
    </div>

    <div style="margin-top:8px;">
      <div style="font-size:13px;font-weight:800;line-height:1.25;word-break:break-word;">
        ${name}
      </div>

      <div style="margin-top:4px;font-size:11px;opacity:0.75;">
        ${typeText}
      </div>

      ${
        isSightseeing && (category || relevance || visitMode)
          ? `<div style="margin-top:6px;font-size:11px;opacity:0.8;display:flex;gap:6px;flex-wrap:wrap;">
              ${category ? `<span>🏷️ ${escapeHtml(category)}</span>` : ""}
              ${relevance ? `<span>🎯 ${escapeHtml(relevance)}</span>` : ""}
              ${visitMode ? `<span>🧭 ${escapeHtml(visitMode)}</span>` : ""}
            </div>`
          : ""
      }

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
          <span>${score != null ? `${score}/${isSightseeing ? 100 : 14}` : "—"}</span>
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

function hoverTooltipHtmlUnified(p: Place) {
  const hero = heroFilename(p);
  const heroUrl = hero ? getSupabasePublicUrl(hero, { placeId: p.id }) : null;
  const score = getPlaceScore(p as any);
  const sightseeingMeta = getSightseeingMeta(p as any);
  const stance = getCampingStance(p as any);
  const isSightseeing = p.type === "SEHENSWUERDIGKEIT";

  const name = escapeHtml(clampText(p.name ?? ""));
  const typeText = escapeHtml(getPlaceTypeLabel(p.type));
  const category = sightseeingMeta?.category ?? null;
  const relevance = sightseeingMeta?.relevance ?? null;
  const visitMode = sightseeingMeta?.visitMode ?? null;

  const dist =
    typeof p.distanceKm === "number" && Number.isFinite(p.distanceKm)
      ? p.distanceKm < 10
        ? `${p.distanceKm.toFixed(1)} km`
        : `${p.distanceKm.toFixed(0)} km`
      : null;

  const heroDebugEnabled = isHeroDebugPoiId(p.id);
  const debugInfoHtml = heroDebugEnabled
    ? `<div style="margin-top:6px;font-size:10px;line-height:1.3;opacity:0.85;word-break:break-word;">src=${escapeHtml(heroUrl || "(empty)")}</div>`
    : "";

  const imgHtml = heroUrl
    ? `<img src="${escapeHtml(heroUrl)}" style="width:220px;height:120px;object-fit:cover;border-radius:14px;display:block;" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="if(!this.dataset.retry){this.dataset.retry='1';this.src=this.src+(this.src.includes('?')?'&':'?')+'ui_retry=1';return;}this.style.display='none';this.insertAdjacentHTML('afterend','<div style=&quot;width:220px;height:120px;border-radius:14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.10);display:flex;align-items:center;justify-content:center;font-size:10px;opacity:.85;&quot;>Hero failed</div>');" />`
    : `<div style="width:220px;height:120px;border-radius:14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.10);"></div>`;

  const scoreHtml = score
    ? `<div style="
        display:flex;align-items:center;gap:6px;
        padding:6px 10px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,0.14);
        background:rgba(255,255,255,0.08);
        font-size:12px;
        font-weight:800;
        line-height:1;
      ">
        <span style="font-size:14px;">${escapeHtml(score.icon)}</span>
        <span>${score.value}/${score.max}</span>
      </div>`
    : "";

  const stanceHtml = stance
    ? `<div style="
        padding:6px 10px;
        border-radius:999px;
        border:1px solid rgba(255,255,255,0.12);
        background:rgba(255,255,255,0.06);
        font-size:11px;
        opacity:0.9;
      ">
        ${escapeHtml(stance.icon)} ${escapeHtml(stance.label)}
      </div>`
    : "";

  const distanceHtml = dist
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
    : "";

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
    pointer-events:none;
  ">
    <div style="border-radius:14px;overflow:hidden;">
      ${imgHtml}
      ${debugInfoHtml}
    </div>

    <div style="margin-top:8px;">
      <div style="font-size:13px;font-weight:800;line-height:1.25;word-break:break-word;">
        ${name}
      </div>

      <div style="margin-top:4px;font-size:11px;opacity:0.75;">
        ${typeText}
      </div>

      ${
        isSightseeing && (category || relevance || visitMode)
          ? `<div style="margin-top:6px;font-size:11px;opacity:0.8;display:flex;gap:6px;flex-wrap:wrap;">
              ${category ? `<span>🏷️ ${escapeHtml(category)}</span>` : ""}
              ${relevance ? `<span>🎯 ${escapeHtml(relevance)}</span>` : ""}
              ${visitMode ? `<span>🧭 ${escapeHtml(visitMode)}</span>` : ""}
            </div>`
          : ""
      }

      <div style="margin-top:8px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
        ${scoreHtml}
        ${stanceHtml}
        ${distanceHtml}
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

/** Nominatim */
type NominatimResult = {
  place_id?: number | string;
  display_name?: string;
  lat?: string;
  lon?: string;
};

function searchMarkerHtml() {
  return `<div style="
    width:30px;height:30px;border-radius:999px;
    display:flex;align-items:center;justify-content:center;
    background:rgba(255,255,255,0.92);
    border:2px solid rgba(0,0,0,0.86);
    box-shadow:0 18px 36px rgba(0,0,0,0.60);
    font-size:16px;
  ">🔎</div>`;
}

export default function MapClient(props: Props) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);

  const markersRef = useRef<Map<number, L.Marker>>(new Map());
  const aggregateLayerRef = useRef<L.LayerGroup | null>(null);
  const aggregateAbortRef = useRef<AbortController | null>(null);
  const aggregateFetchSeqRef = useRef(0);
  const placesRef = useRef<Place[]>(props.places);
  const aggregatesRef = useRef<MapAggregate[]>([]);
  const hoveredIdRef = useRef<number | null>(null);

  const tempLayerRef = useRef<L.LayerGroup | null>(null);
  const tempMarkerRef = useRef<L.Marker | null>(null);
  const pickedCoordRef = useRef<{ lat: number; lng: number } | null>(null);


  const selectedIdRef = useRef<number | null>(props.selectedId);
  const pickModeRef = useRef<boolean>(props.pickMode);

  const myPosMarkerRef = useRef<L.Marker | null>(null);
  const myPosRingsRef = useRef<L.LayerGroup | null>(null);
  const tripRouteRef = useRef<L.Polyline | null>(null);

  const isMobileRef = useRef<boolean>(false);
  const lastSelectMsRef = useRef<number>(0);
  const [mapReady, setMapReady] = useState(false);

  // SEARCH (Nominatim)
  const [searchQ, setSearchQ] = useState("");
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchErr, setSearchErr] = useState<string>("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [aggregateMode, setAggregateMode] = useState(false);
  const [aggregates, setAggregates] = useState<MapAggregate[]>([]);
  const [aggregateStatus, setAggregateStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchMarkerRef = useRef<L.Marker | null>(null);

  useEffect(() => {
    selectedIdRef.current = props.selectedId;
  }, [props.selectedId]);

  useEffect(() => {
    placesRef.current = props.places;
  }, [props.places]);

  useEffect(() => {
    aggregatesRef.current = aggregates;
  }, [aggregates]);

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

  const showAggregateMarkers = aggregateMode && aggregates.length > 0;

  const markerPlaces = useMemo(() => {
    if (!showAggregateMarkers) return props.places;
    return props.places.filter(
      (place) => place.id === props.selectedId || (typeof place.activeTripOrder === "number" && Number.isFinite(place.activeTripOrder))
    );
  }, [props.places, props.selectedId, showAggregateMarkers]);

  useEffect(() => {
    if (!rootRef.current) return;

    if (!mapRef.current) {
      const map = L.map(rootRef.current, {
        zoomControl: false,
        attributionControl: true,
        preferCanvas: true,
      });

      mapRef.current = map;
      L.control.zoom({ position: "topleft" }).addTo(map);

      const tile = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
      });

      tile.addTo(map);
      tileRef.current = tile;

      map.setView([50.33, 7.6], 11);
      setMapReady(true);
    }
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const mapInstance = map;

    function clearAggregates() {
      if (aggregateAbortRef.current) {
        try {
          aggregateAbortRef.current.abort();
        } catch {}
      }
      setAggregateStatus("idle");
      setAggregates([]);
    }

    async function refreshAggregates() {
      const bounds = mapInstance.getBounds();
      const visiblePlaces = placesRef.current.filter((place) => bounds.contains([place.lat, place.lng]));
      const widthKm = mapViewportWidthKm(mapInstance);
      const nextAggregateMode = visiblePlaces.length > 3;
      setAggregateMode(nextAggregateMode);

      if (!nextAggregateMode) {
        clearAggregates();
        return;
      }

      const localFallback = aggregatePlacesByZoom(
        visiblePlaces.map((place) => ({
            id: place.id,
            type: place.type,
            lat: place.lat,
            lng: place.lng,
          })),
        { zoom: mapInstance.getZoom(), cellPx: aggregateCellPxNumber(widthKm, props.aggregateQuery) }
      );
      if (!aggregatesRef.current.length) setAggregateStatus("loading");
      const ac = new AbortController();
      const fetchSeq = aggregateFetchSeqRef.current + 1;
      aggregateFetchSeqRef.current = fetchSeq;
      aggregateAbortRef.current = ac;

      const params = new URLSearchParams({
        minLat: String(bounds.getSouth()),
        maxLat: String(bounds.getNorth()),
        minLng: String(bounds.getWest()),
        maxLng: String(bounds.getEast()),
        zoom: String(mapInstance.getZoom()),
        cellPx: aggregateCellPx(widthKm, props.aggregateQuery),
        STELLPLATZ: props.aggregateQuery.showStellplatz ? "1" : "0",
        CAMPINGPLATZ: props.aggregateQuery.showCampingplatz ? "1" : "0",
        SEHENSWUERDIGKEIT: props.aggregateQuery.showSehens ? "1" : "0",
        HVO_TANKSTELLE: props.aggregateQuery.showHvoTankstelle ? "1" : "0",
        dog: props.aggregateQuery.dog ? "1" : "0",
        san: props.aggregateQuery.san ? "1" : "0",
        year: props.aggregateQuery.year ? "1" : "0",
        online: props.aggregateQuery.online ? "1" : "0",
        gastro: props.aggregateQuery.gastro ? "1" : "0",
        review: props.aggregateQuery.reviewFilter,
        tripOnly: props.aggregateQuery.tripOnlyMode ? "1" : "0",
      });

      if (props.aggregateQuery.selectedTripId != null) {
        params.set("tripId", String(props.aggregateQuery.selectedTripId));
      }

      try {
        const res = await fetch(`/api/map-aggregates?${params.toString()}`, {
          cache: "no-store",
          signal: ac.signal,
        });
        if (!res.ok) {
          setAggregates(localFallback);
          setAggregateStatus("ready");
          return;
        }
        const data = await res.json();
        if (aggregateFetchSeqRef.current !== fetchSeq) return;
        const nextAggregates = Array.isArray(data?.aggregates) ? (data.aggregates as MapAggregate[]) : [];
        setAggregates(nextAggregates.length ? nextAggregates : localFallback);
        setAggregateStatus("ready");
      } catch (error: any) {
        if (error?.name === "AbortError") return;
        setAggregates(localFallback);
        setAggregateStatus("ready");
      }
    }

    const handleAfterMove = () => {
      void refreshAggregates();
    };

    void refreshAggregates();
    mapInstance.on("moveend zoomend resize", handleAfterMove);

    return () => {
      mapInstance.off("moveend zoomend resize", handleAfterMove);
      clearAggregates();
    };
  }, [mapReady, props.aggregateQuery]);

  function setMarkerVisual(id: number, p: Place) {
    const m = markersRef.current.get(id);
    if (!m) return;

    const isSelected = selectedIdRef.current === id;
    const isHover = hoveredIdRef.current === id;
    const v: MarkerVariant = isSelected ? "SELECTED" : isHover ? "HOVER" : "NORMAL";

    m.setIcon(makeImageIcon(p.type, markerSize(v)));
    m.setZIndexOffset(isSelected ? 1200 : isHover ? 900 : 0);
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
      m.bindTooltip(hoverTooltipHtmlUnified(p), {
        direction: "top",
        offset: L.point(0, -14),
        opacity: 1,
        sticky: false,
        className: "cp-hover-tooltip",
      });
    } else {
      m.setTooltipContent(hoverTooltipHtmlUnified(p));
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

    for (const p of markerPlaces) {
      aliveIds.add(p.id);
      const existing = markersRef.current.get(p.id);
      const isSelected = props.selectedId === p.id;
      const isHover = hoveredIdRef.current === p.id;
      const v: MarkerVariant = isSelected ? "SELECTED" : isHover ? "HOVER" : "NORMAL";

      const marker = existing ?? L.marker([p.lat, p.lng], {
        icon: makeImageIcon(p.type, markerSize(v)),
        keyboard: false,
      });

      marker.setLatLng([p.lat, p.lng]);
      marker.setIcon(makeImageIcon(p.type, markerSize(v)));
      marker.setZIndexOffset(isSelected ? 1200 : isHover ? 900 : 0);

      applyTooltipMode(marker, p);

      marker.off("click");
      marker.off("touchend");
      marker.off("pointerup");
      marker.on("click", (e: any) => safeSelect(p, e, marker));
      marker.on("touchend", (e: any) => safeSelect(p, e, marker));
      marker.on("pointerup", (e: any) => safeSelect(p, e, marker));

      markersRef.current.set(p.id, marker);
      if (!map.hasLayer(marker)) marker.addTo(map);
    }

    for (const [id, marker] of markersRef.current.entries()) {
      if (!aliveIds.has(id)) {
        marker.remove();
        markersRef.current.delete(id);
      }
    }
  }, [markerPlaces, props.onSelect, props.selectedId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!showAggregateMarkers) {
      if (aggregateLayerRef.current) {
        aggregateLayerRef.current.clearLayers();
        aggregateLayerRef.current.remove();
        aggregateLayerRef.current = null;
      }
      return;
    }

    const layer = aggregateLayerRef.current ?? L.layerGroup().addTo(map);
    aggregateLayerRef.current = layer;
    layer.clearLayers();

    for (const item of aggregates) {
      const marker = L.marker([item.lat, item.lng], {
        icon: makeAggregateIcon(item),
        keyboard: false,
      });

      marker.on("click", () => {
        map.setView([item.lat, item.lng], Math.min(map.getZoom() + 2, 16), { animate: true });
      });

      marker.addTo(layer);
    }
  }, [aggregates, showAggregateMarkers]);

  useEffect(() => {
    const map = mapRef.current;
    const root = rootRef.current;
    if (!map || !root) return;

    function closeHoveredTooltip() {
      const hoveredId = hoveredIdRef.current;
      if (hoveredId == null) return;
      const marker = markersRef.current.get(hoveredId);
      const place = props.places.find((item) => item.id === hoveredId);
      hoveredIdRef.current = null;
      try {
        marker?.closeTooltip();
      } catch {}
      if (place) setMarkerVisual(place.id, place);
    }

    function handleRootMouseMove(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.closest(".cp-marker, .cp-marker-native, .leaflet-marker-icon, .cp-aggregate-marker")) return;
      closeHoveredTooltip();
    }

    function handleRootLeave() {
      closeHoveredTooltip();
    }

    map.on("movestart zoomstart dragstart click", closeHoveredTooltip);
    root.addEventListener("mousemove", handleRootMouseMove);
    root.addEventListener("mouseleave", handleRootLeave);

    return () => {
      map.off("movestart zoomstart dragstart click", closeHoveredTooltip);
      root.removeEventListener("mousemove", handleRootMouseMove);
      root.removeEventListener("mouseleave", handleRootLeave);
    };
  }, [props.places]);

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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const route = Array.isArray(props.tripRoute) ? props.tripRoute : [];
    if (route.length < 2) {
      if (tripRouteRef.current) {
        tripRouteRef.current.remove();
        tripRouteRef.current = null;
      }
      return;
    }

    const color = typeof props.tripColor === "string" && props.tripColor.trim() ? props.tripColor : "#f97316";
    const latLngs = route.map((point) => [point.lat, point.lng] as [number, number]);

    if (!tripRouteRef.current) {
      tripRouteRef.current = L.polyline(latLngs, {
        color,
        weight: 4,
        opacity: 0.8,
        lineJoin: "round",
        lineCap: "round",
      }).addTo(map);
    } else {
      tripRouteRef.current.setLatLngs(latLngs);
      tripRouteRef.current.setStyle({ color });
    }

    tripRouteRef.current.bringToBack();
  }, [props.tripColor, props.tripRoute]);

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
          zIndexOffset: 2000,
        });
        tempMarkerRef.current.addTo(layer);
      } else {
        tempMarkerRef.current.setLatLng([lat, lng]);
        tempMarkerRef.current.setIcon(makeDivIcon(html, 40));
      }
    }

    function onClick(e: L.LeafletMouseEvent) {
      if (!props.pickMode) return;
      const lat = e.latlng.lat;
      const lng = e.latlng.lng;
      pickedCoordRef.current = { lat, lng };
      ensureTempMarker(lat, lng);
      props.onPick(lat, lng);
    }

    if (props.pickMode) {
      map.on("click", onClick);

      const picked = pickedCoordRef.current;
      if (picked) ensureTempMarker(picked.lat, picked.lng);
      map.getContainer().style.cursor = "crosshair";
    } else {
      map.off("click", onClick);
      map.getContainer().style.cursor = "";
      clearTempLayer();
    }

    return () => {
      map.off("click", onClick);
      map.getContainer().style.cursor = "";
    };
  }, [props.pickMode, props.onPick]);

  // SEARCH: Debounced Nominatim query
  useEffect(() => {
    const q = String(searchQ ?? "").trim();

    setSearchErr("");

    if (q.length < 3) {
      if (searchAbortRef.current) {
        try {
          searchAbortRef.current.abort();
        } catch {}
      }
      setSearchBusy(false);
      setSearchResults([]);
      return;
    }

    const t = window.setTimeout(async () => {
      if (searchAbortRef.current) {
        try {
          searchAbortRef.current.abort();
        } catch {}
      }

      const ac = new AbortController();
      searchAbortRef.current = ac;

      setSearchBusy(true);
      setSearchErr("");

      try {
        const url =
          "https://nominatim.openstreetmap.org/search" +
          `?format=jsonv2` +
          `&q=${encodeURIComponent(q)}` +
          `&addressdetails=1` +
          `&limit=6` +
          `&accept-language=de`;

        const res = await fetch(url, {
          method: "GET",
          signal: ac.signal,
          headers: {
            Accept: "application/json",
          },
        });

        if (!res.ok) {
          setSearchResults([]);
          setSearchErr("Suche fehlgeschlagen");
          return;
        }

        const data = (await res.json().catch(() => [])) as unknown;
        const arr = Array.isArray(data) ? (data as NominatimResult[]) : [];

        const cleaned = arr
          .map((x) => ({
            place_id: x.place_id,
            display_name: x.display_name,
            lat: x.lat,
            lon: x.lon,
          }))
          .filter((x) => !!x.display_name && !!x.lat && !!x.lon);

        setSearchResults(cleaned);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setSearchResults([]);
        setSearchErr("Suche fehlgeschlagen");
      } finally {
        setSearchBusy(false);
      }
    }, 320);

    return () => {
      window.clearTimeout(t);
    };
  }, [searchQ]);

  function clearSearch() {
    setSearchQ("");
    setSearchResults([]);
    setSearchErr("");
    setSearchOpen(false);

    if (searchMarkerRef.current) {
      try {
        searchMarkerRef.current.remove();
      } catch {}
      searchMarkerRef.current = null;
    }
  }

  function applySearchHit(hit: NominatimResult) {
    const map = mapRef.current;
    if (!map) return;

    const lat = Number(hit.lat);
    const lng = Number(hit.lon);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

    const marker = searchMarkerRef.current;
    if (!marker) {
      searchMarkerRef.current = L.marker([lat, lng], {
        icon: makeDivIcon(searchMarkerHtml(), 34),
        interactive: false,
        zIndexOffset: 1300,
      });
      searchMarkerRef.current.addTo(map);
    } else {
      marker.setLatLng([lat, lng]);
      marker.setIcon(makeDivIcon(searchMarkerHtml(), 34));
    }

    map.setView([lat, lng], Math.max(map.getZoom(), 14), { animate: true });

    setSearchOpen(false);
  }

  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setSearchOpen(false);
      return;
    }

    if (e.key === "Enter") {
      if (searchResults.length) {
        e.preventDefault();
        applySearchHit(searchResults[0]);
      }
    }
  }

  return (
    <div className="relative h-full w-full" data-map-client="DEBUG-SEARCH-OVERLAY">
      <div ref={rootRef} className="h-full w-full" />

      {/* SEARCH OVERLAY (Nominatim - OSM) */}
      <div className="pointer-events-none absolute left-16 right-3 top-3 sm:left-3" style={{ zIndex: 4000 }}>
        <div className="pointer-events-auto mx-auto max-w-[640px]">
          <div className="rounded-2xl border border-white/10 bg-black/55 backdrop-blur px-3 py-2 shadow-[0_18px_40px_rgba(0,0,0,0.45)]">
            <div className="flex items-center gap-2">
              <div className="shrink-0 text-sm opacity-90">🔎</div>

              <input
                value={searchQ}
                onChange={(e) => {
                  setSearchQ(e.target.value);
                  setSearchOpen(true);
                }}
                onFocus={() => setSearchOpen(true)}
                onKeyDown={onSearchKeyDown}
                placeholder="Ort oder Adresse suchen…"
                className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/35 px-3 py-2 text-sm outline-none placeholder:text-white/45"
                inputMode="search"
              />

              {searchBusy ? (
                <div className="shrink-0 text-xs opacity-70">sucht…</div>
              ) : searchQ.trim() ? (
                <button
                  type="button"
                  onClick={clearSearch}
                  className="shrink-0 rounded-xl border border-white/10 bg-white/5 px-2.5 py-2 text-xs hover:bg-white/10"
                  title="Suche leeren"
                >
                  ✕
                </button>
              ) : null}
            </div>

            {searchOpen ? (
              <div className="mt-2 overflow-hidden rounded-2xl border border-white/10 bg-black/35">
                {searchErr ? <div className="px-3 py-2 text-xs text-red-200/90">{searchErr}</div> : null}

                {!searchErr && searchQ.trim().length < 3 ? (
                  <div className="px-3 py-2 text-xs opacity-70">Mindestens 3 Zeichen…</div>
                ) : null}

                {!searchErr && searchQ.trim().length >= 3 && !searchBusy && !searchResults.length ? (
                  <div className="px-3 py-2 text-xs opacity-70">Keine Treffer</div>
                ) : null}

                {searchResults.length ? (
                  <div className="max-h-[280px] overflow-auto">
                    {searchResults.map((hit) => {
                      const key = String(hit.place_id ?? hit.display_name ?? Math.random());
                      const label = String(hit.display_name ?? "").trim();
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => applySearchHit(hit)}
                          className="block w-full border-b border-white/10 px-3 py-2 text-left text-xs hover:bg-white/5"
                          title={label}
                        >
                          <div className="line-clamp-2">{label}</div>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      </div>

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

      {aggregateMode ? (
        <div className="pointer-events-none absolute right-3 top-20 z-[4200]">
          <div className="rounded-full border border-white/10 bg-black/60 px-3 py-1.5 text-[11px] font-semibold text-white/90 shadow-[0_10px_24px_rgba(0,0,0,0.28)] backdrop-blur">
            {aggregateStatus === "ready"
              ? `Überblick • ${aggregates.length} Cluster`
              : aggregateStatus === "error"
                ? "Überblick Fehler"
                : "Überblick lädt…"}
          </div>
        </div>
      ) : null}
    </div>
  );
}
