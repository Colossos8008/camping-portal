import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { aggregatePlacesByZoom, normalizeAggregateBounds } from "@/app/map/_lib/map-aggregates";

export const runtime = "nodejs";

type AggregateResponsePayload = {
  zoom: number;
  cellPx: number;
  totalPlaces: number;
  totalAggregates: number;
  aggregates: ReturnType<typeof aggregatePlacesByZoom>;
  cacheKey: string;
  truncated: boolean;
};

type CacheEntry = {
  expiresAt: number;
  payload: AggregateResponsePayload;
};

declare global {
  // eslint-disable-next-line no-var
  var __cpMapAggregateCache: Map<string, CacheEntry> | undefined;
}

type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";
type ReviewFilter = "ALL" | "UNREVIEWED" | "CORRECTED" | "CONFIRMED" | "REJECTED";
const AGGREGATE_CACHE_TTL_MS = 30_000;
const AGGREGATE_CACHE_MAX_ENTRIES = 250;
const AGGREGATE_QUERY_LIMIT = 50_000;

function parseNumber(value: string | null, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseBool(value: string | null, fallback = false) {
  if (value == null) return fallback;
  return value === "1" || value.toLowerCase() === "true";
}

function parsePlaceTypes(searchParams: URLSearchParams): PlaceType[] {
  const all: PlaceType[] = ["STELLPLATZ", "CAMPINGPLATZ", "SEHENSWUERDIGKEIT", "HVO_TANKSTELLE"];
  const enabled = all.filter((type) => parseBool(searchParams.get(type), true));
  return enabled.length ? enabled : all;
}

function parseReviewFilter(value: string | null): ReviewFilter {
  if (value === "UNREVIEWED" || value === "CORRECTED" || value === "CONFIRMED" || value === "REJECTED") return value;
  return "ALL";
}

function getAggregateCache() {
  global.__cpMapAggregateCache ??= new Map<string, CacheEntry>();
  return global.__cpMapAggregateCache;
}

function compactCache(cache: Map<string, CacheEntry>, now: number) {
  for (const [key, value] of cache.entries()) {
    if (value.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > AGGREGATE_CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) break;
    cache.delete(oldestKey);
  }
}

function makeCacheKey(input: {
  bounds: ReturnType<typeof normalizeAggregateBounds>;
  zoom: number;
  cellPx: number;
  types: PlaceType[];
  reviewFilter: ReviewFilter;
  dog: boolean;
  san: boolean;
  year: boolean;
  online: boolean;
  gastro: boolean;
  selectedTripId: number | null;
  tripOnly: boolean;
}) {
  const b = input.bounds;
  return [
    `z${input.zoom}`,
    `c${input.cellPx}`,
    `lat${b.minLat.toFixed(4)}:${b.maxLat.toFixed(4)}`,
    `lng${b.minLng.toFixed(4)}:${b.maxLng.toFixed(4)}`,
    `t${input.types.join(",")}`,
    `r${input.reviewFilter}`,
    `d${input.dog ? 1 : 0}`,
    `s${input.san ? 1 : 0}`,
    `y${input.year ? 1 : 0}`,
    `o${input.online ? 1 : 0}`,
    `g${input.gastro ? 1 : 0}`,
    `trip${input.tripOnly ? input.selectedTripId ?? "none" : "all"}`,
  ].join("|");
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const minLat = parseNumber(searchParams.get("minLat"), -90);
  const maxLat = parseNumber(searchParams.get("maxLat"), 90);
  const minLng = parseNumber(searchParams.get("minLng"), -180);
  const maxLng = parseNumber(searchParams.get("maxLng"), 180);
  const zoom = parseNumber(searchParams.get("zoom"), 5);
  const cellPx = parseNumber(searchParams.get("cellPx"), 56);
  const types = parsePlaceTypes(searchParams);
  const reviewFilter = parseReviewFilter(searchParams.get("review"));
  const selectedTripId = Number(searchParams.get("tripId"));
  const tripOnly = parseBool(searchParams.get("tripOnly"), false);
  const dog = parseBool(searchParams.get("dog"));
  const san = parseBool(searchParams.get("san"));
  const year = parseBool(searchParams.get("year"));
  const online = parseBool(searchParams.get("online"));
  const gastro = parseBool(searchParams.get("gastro"));
  const normalizedBounds = normalizeAggregateBounds(
    {
      minLat,
      maxLat,
      minLng,
      maxLng,
    },
    { zoom, cellPx }
  );
  const cache = getAggregateCache();
  const now = Date.now();
  compactCache(cache, now);
  const cacheKey = makeCacheKey({
    bounds: normalizedBounds,
    zoom,
    cellPx,
    types,
    reviewFilter,
    dog,
    san,
    year,
    online,
    gastro,
    selectedTripId: Number.isFinite(selectedTripId) ? selectedTripId : null,
    tripOnly,
  });
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return NextResponse.json(cached.payload, {
      headers: {
        "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
        "X-Map-Aggregate-Cache": "HIT",
      },
    });
  }

  const where: any = {
    lat: { gte: normalizedBounds.minLat, lte: normalizedBounds.maxLat },
    lng: { gte: normalizedBounds.minLng, lte: normalizedBounds.maxLng },
    type: { in: types },
  };

  if (dog) where.dogAllowed = true;
  if (san) where.sanitary = true;
  if (year) where.yearRound = true;
  if (online) where.onlineBooking = true;
  if (gastro) where.gastronomy = true;

  if (reviewFilter !== "ALL") {
    where.coordinateReviewStatus = reviewFilter;
  }

  if (Number.isFinite(selectedTripId) && tripOnly) {
    where.tripPlacements = {
      some: {
        tripId: selectedTripId,
      },
    };
  }

  const places = await prisma.place.findMany({
    where,
    select: {
      id: true,
      type: true,
      lat: true,
      lng: true,
    },
    take: AGGREGATE_QUERY_LIMIT,
  });
  type AggregatePlaceRow = (typeof places)[number];

  const aggregates = aggregatePlacesByZoom(
    places.map((place: AggregatePlaceRow) => ({
      id: place.id,
      type: place.type,
      lat: place.lat,
      lng: place.lng,
    })),
    { zoom, cellPx }
  );
  const payload: AggregateResponsePayload = {
    zoom,
    cellPx,
    totalPlaces: places.length,
    totalAggregates: aggregates.length,
    aggregates,
    cacheKey,
    truncated: places.length >= AGGREGATE_QUERY_LIMIT,
  };

  cache.set(cacheKey, {
    expiresAt: now + AGGREGATE_CACHE_TTL_MS,
    payload,
  });

  return NextResponse.json(payload, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
      "X-Map-Aggregate-Cache": "MISS",
    },
  });
}
