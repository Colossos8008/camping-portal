import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildGooglePhotoMediaUrl } from "@/lib/hero-image";
import { scoreVisionByPlaceType } from "@/lib/hero-type-scoring";
import { selectHeroCandidateByThreshold } from "@/lib/hero-candidate-selection";
import { parseExplicitIds } from "@/lib/hero-autofill-ids";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HeroSource = "google" | "wikimedia";
type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";
type ResultStatus = "UPDATED" | "SKIPPED" | "FAILED";
type HeroAction = "created" | "updated" | "skipped" | "error" | "would-create" | "would-update";

type HeroResult = {
  id: string;
  name: string;
  status: ResultStatus;
  reason: string;
  chosenUrl?: string;
  score?: number;
  source?: HeroSource;
  heroReason?: string;
  visionDebug?: VisionDebug;
  selectionDebug?: {
    sourcesTried: HeroSource[];
    sourceDebug?: Array<{
      source: HeroSource;
      attempted: boolean;
      discovered: number;
      scored: number;
      topScore?: number;
      topUrl?: string;
      error?: string;
    }>;
    totalCandidates: number;
    removedPlaceholder?: boolean;
    discardedExistingHero?: boolean;
    existingHeroWasPlaceholder?: boolean;
    bestOverall?: { source: HeroSource; score: number; url: string };
    bestPreferredCandidate?: { source: HeroSource; score: number; url: string };
    acceptableFallbackCandidate?: { source: HeroSource; score: number; url: string };
    selectedCandidate?: { source: HeroSource; score: number; url: string; tier: "preferred" | "acceptable" };
    whyWikimediaRejected?: string[];
    noSelectionReason?: string;
  };
  action: HeroAction;
  placeId: string;
  placeName: string;
};

type VisionDebug = {
  imageFetch: {
    ok: boolean;
    status: number;
    contentType: string;
    bytes: number;
    ms: number;
  };
  visionCall: {
    ok: boolean;
    ms: number;
    errorMessage?: string;
  };
  signals: {
    labelsTop5: string[];
    hasFace: boolean;
    hasLogo: boolean;
    hasText: boolean;
    safeSearch: Record<string, string>;
    landmarkLikely: boolean;
    indoorLikely: boolean;
  };
};

type PlaceRecord = {
  id: number;
  name: string;
  type: PlaceType;
  lat: number | null;
  lng: number | null;
  heroImageUrl: string | null;
  thumbnailImageId: number | null;
  images: Array<{ id: number; filename: string }>;
};

type SourceAttemptDebug = {
  source: HeroSource;
  attempted: boolean;
  discovered: number;
  scored: number;
  topScore?: number;
  topUrl?: string;
  error?: string;
};

type WikimediaCandidate = {
  title: string;
  url: string;
  width?: number;
  height?: number;
};

type GoogleCandidate = {
  placeId: string;
  name: string;
  lat?: number;
  lng?: number;
  distanceMeters?: number;
  photos?: GooglePhoto[];
};

type GooglePhoto = {
  name: string;
  widthPx?: number;
  heightPx?: number;
  attributionText?: string;
};

type ScoredCandidate = {
  source: HeroSource;
  placeType: PlaceType;
  url: string;
  fetchUrl?: string;
  score: number;
  reason: string;
  visionDebug?: VisionDebug;
};

const DEFAULT_LIMIT = 200;
const DEFAULT_RADIUS_METERS = 200;
const MAX_RADIUS_METERS = 5000;
const FETCH_TIMEOUT_MS = 15000;
const PHOTO_MAX_WIDTH = 1600;
const ALL_TYPES: PlaceType[] = ["CAMPINGPLATZ", "STELLPLATZ", "HVO_TANKSTELLE", "SEHENSWUERDIGKEIT"];
const BAD_HINTS = ["logo", "icon", "map", "flag", "coat", "emblem", "text", "sign", "selfie", "portrait"];
const CAMPING_WIKIMEDIA_POSITIVE_HINTS = [
  "camping",
  "campsite",
  "campground",
  "camper",
  "motorhome",
  "wohnmobil",
  "caravan",
  "campervan",
  "rv",
  "zeltplatz",
];
const CAMPING_WIKIMEDIA_NEGATIVE_HINTS = [
  "war",
  "military",
  "museum",
  "church",
  "memorial",
  "portrait",
  "person",
  "statue",
  "monument",
  "cathedral",
  "basilica",
  "fortress",
  "castle",
  "building",
  "architecture",
  "therme",
  "thermal",
  "pool",
  "swimming",
  "waterpark",
  "resort",
  "hotel",
  "spa",
  "water slide",
  "bath",
];


function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseBody(value: unknown): {
  limit: number;
  force: boolean;
  refresh: boolean;
  refreshCamping: boolean;
  cleanupPlaceholders: boolean;
  cleanupCampingPlaceholders: boolean;
  dryRun: boolean;
  provider: "google" | "wikimedia" | "auto";
  radiusMeters: number;
  offset: number;
  cursor?: string;
  types?: PlaceType[];
  maxCandidatesPerPlace: number;
} {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const limitValue = typeof raw.limit === "number" ? Math.floor(raw.limit) : DEFAULT_LIMIT;
  const radiusValue = typeof raw.radiusMeters === "number" ? Math.floor(raw.radiusMeters) : DEFAULT_RADIUS_METERS;
  const offsetValue = typeof raw.offset === "number" ? Math.max(0, Math.floor(raw.offset)) : 0;
  const cursorValue = typeof raw.cursor === "string" ? raw.cursor.trim() : typeof raw.cursor === "number" ? String(Math.floor(raw.cursor)) : undefined;
  const provider = raw.provider === "google" || raw.provider === "wikimedia" ? raw.provider : "auto";
  const maxCandidatesPerPlaceRaw =
    typeof raw.maxCandidatesPerPlace === "number"
      ? Math.floor(raw.maxCandidatesPerPlace)
      : envInt("HERO_AUTOFILL_MAX_CANDIDATES", 12);

  const types = Array.isArray(raw.types)
    ? raw.types
        .map((x) => (typeof x === "string" ? x.trim().toUpperCase() : ""))
        .filter((x): x is PlaceType => ALL_TYPES.includes(x as PlaceType))
    : undefined;

  return {
    limit: Math.max(1, Number.isFinite(limitValue) ? limitValue : DEFAULT_LIMIT),
    force: raw.force === true,
    refresh: raw.refresh === true || raw.rediscover === true,
    refreshCamping: raw.refreshCamping === true || raw.refreshCampings === true,
    cleanupPlaceholders: raw.cleanupPlaceholders === true || raw.cleanPlaceholders === true,
    cleanupCampingPlaceholders: raw.cleanupCampingPlaceholders === true || raw.cleanupCamping === true,
    dryRun: raw.dryRun === true,
    provider,
    radiusMeters: Math.min(
      MAX_RADIUS_METERS,
      Math.max(50, Number.isFinite(radiusValue) ? radiusValue : DEFAULT_RADIUS_METERS)
    ),
    offset: offsetValue,
    cursor: cursorValue && cursorValue.length > 0 ? cursorValue : undefined,
    types: types && types.length > 0 ? Array.from(new Set(types)) : undefined,
    maxCandidatesPerPlace: Math.min(30, Math.max(1, maxCandidatesPerPlaceRaw)),
  };
}

function isPlaceholderHeroUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  return normalized === "/hero-placeholder.jpg" || normalized.endsWith("/hero-placeholder.jpg");
}

function withSourceBonus(candidate: ScoredCandidate): ScoredCandidate {
  if (candidate.placeType !== "CAMPINGPLATZ") return candidate;
  if (candidate.source === "wikimedia") {
    return {
      ...candidate,
      score: candidate.score + 4,
      reason: `${candidate.reason}; source bonus +4 (wikimedia camping fallback)`,
    };
  }
  return candidate;
}

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}


function parseTypeFilter(searchParams: URLSearchParams): { types?: PlaceType[]; error?: string } {
  const rawType = searchParams.get("type")?.trim();
  if (!rawType) return {};

  const normalizedType = rawType.toUpperCase();
  if (!ALL_TYPES.includes(normalizedType as PlaceType)) {
    return {
      error: `Invalid type '${rawType}'. Allowed types: ${ALL_TYPES.join(", ")}`,
    };
  }

  return { types: [normalizedType as PlaceType] };
}

function parseBool(searchParams: URLSearchParams, keys: string[]): boolean {
  for (const key of keys) {
    const value = searchParams.get(key);
    if (!value) continue;
    const v = value.toLowerCase();
    if (["1", "true", "yes", "on"].includes(v)) return true;
  }
  return false;
}

async function fetchJsonRequest<T>(
  url: string,
  method: "GET" | "POST",
  headers?: Record<string, string>,
  body?: unknown,
  timeoutMs = FETCH_TIMEOUT_MS
): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        ...(headers ?? {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const raw = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status} ${res.statusText}${raw ? ` - ${raw.slice(0, 300)}` : ""}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  return fetchJsonRequest<T>(url, "GET");
}

function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeNormalized(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter(Boolean));
}

function isRateLimitError(error: unknown): boolean {
  const message = String((error as any)?.message ?? error ?? "").toLowerCase();
  return message.includes("http 429") || message.includes("too many requests") || message.includes("rate limit");
}

function campingRelevanceScore(candidate: WikimediaCandidate, placeName: string): number {
  const merged = `${candidate.title} ${candidate.url}`;
  const tokens = tokenizeNormalized(merged);
  let score = 0;

  for (const hint of CAMPING_WIKIMEDIA_POSITIVE_HINTS) {
    if (tokens.has(hint)) score += 2;
  }
  for (const hint of CAMPING_WIKIMEDIA_NEGATIVE_HINTS) {
    if (tokens.has(hint)) score -= 3;
  }

  const placeTokens = tokenizeNormalized(placeName);
  let overlap = 0;
  for (const token of tokens) {
    if (placeTokens.has(token)) overlap += 1;
  }
  score += Math.min(4, overlap);

  return score;
}

function evaluateCampingWikimediaCandidate(candidate: WikimediaCandidate, placeName: string): { accepted: boolean; reason?: string } {
  const merged = `${candidate.title} ${candidate.url}`;
  const tokens = tokenizeNormalized(merged);
  const hasPositive = CAMPING_WIKIMEDIA_POSITIVE_HINTS.some((hint) => tokens.has(hint));
  if (!hasPositive) {
    return { accepted: false, reason: `Rejected '${candidate.title}': missing strong camping relevance keyword.` };
  }

  const negative = CAMPING_WIKIMEDIA_NEGATIVE_HINTS.find((hint) => tokens.has(hint));
  if (negative) {
    return { accepted: false, reason: `Rejected '${candidate.title}': contains negative keyword '${negative}'.` };
  }

  const relevance = campingRelevanceScore(candidate, placeName);
  if (relevance < 2) {
    return { accepted: false, reason: `Rejected '${candidate.title}': thematic match too weak (relevance=${relevance}).` };
  }

  return { accepted: true };
}

function similarity(a: string, b: string): number {
  const aa = new Set(normalize(a).split(" ").filter(Boolean));
  const bb = new Set(normalize(b).split(" ").filter(Boolean));
  if (aa.size === 0 || bb.size === 0) return 0;
  let overlap = 0;
  for (const t of aa) {
    if (bb.has(t)) overlap += 1;
  }
  return overlap / Math.max(aa.size, bb.size);
}

function sanitizePlaceNameForMatching(value: string): string {
  return String(value ?? "")
    .replace(/<!\[CDATA\[|\]\]>/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(pkw|lkw|truck|icon|klicken|lesen|bitte|rückinfo|unklar|evtl|oldere|ältere|neuere|adapter)\b/gi, " ")
    .replace(/[=>/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBrandLikeTokens(value: string): string[] {
  const generic = new Set([
    "gas",
    "station",
    "service",
    "petrol",
    "fuel",
    "energy",
    "truck",
    "car",
    "express",
    "de",
    "du",
    "la",
    "le",
    "el",
    "the",
    "and",
    "und",
    "orange",
  ]);

  return normalize(sanitizePlaceNameForMatching(value))
    .split(" ")
    .filter((token) => token.length >= 3 && !generic.has(token));
}

function brandTokenOverlapScore(a: string, b: string): number {
  const aa = new Set(extractBrandLikeTokens(a));
  const bb = new Set(extractBrandLikeTokens(b));
  if (aa.size === 0 || bb.size === 0) return 0;
  let overlap = 0;
  for (const token of aa) {
    if (bb.has(token)) overlap += 1;
  }
  return overlap / Math.max(aa.size, bb.size);
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const q =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

function hasBadHints(text: string): boolean {
  const lower = text.toLowerCase();
  return BAD_HINTS.some((hint) => lower.includes(hint));
}

function scoreLandscape(width?: number, height?: number): number {
  if (!width || !height || height <= 0) return 0;
  const ratio = width / height;
  if (ratio >= 1.2 && ratio <= 2.2) return 8;
  if (ratio > 1 && ratio < 2.6) return 3;
  if (ratio < 0.8) return -8;
  return -2;
}

async function runWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;

  async function next() {
    for (;;) {
      const idx = cursor;
      cursor += 1;
      if (idx >= items.length) return;
      out[idx] = await worker(items[idx]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return out;
}

async function findPageIdBySearch(placeName: string): Promise<number | null> {
  type SearchResponse = { query?: { search?: Array<{ pageid?: number }> } };
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", placeName);
  url.searchParams.set("format", "json");
  url.searchParams.set("utf8", "1");
  url.searchParams.set("srlimit", "10");
  url.searchParams.set("origin", "*");

  const data = await fetchJson<SearchResponse>(url.toString());
  return data.query?.search?.[0]?.pageid ?? null;
}

async function fetchRepresentativeFileTitle(pageId: number): Promise<string | null> {
  type PageImagesResponse = { query?: { pages?: Record<string, { pageimage?: string }> } };
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "pageimages");
  url.searchParams.set("pageids", String(pageId));
  url.searchParams.set("piprop", "name");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const data = await fetchJson<PageImagesResponse>(url.toString());
  const name = data.query?.pages?.[String(pageId)]?.pageimage;
  return name ? `File:${name.replaceAll("_", " ")}` : null;
}

async function fetchPageImageTitles(pageId: number): Promise<string[]> {
  type ImagesResponse = { query?: { pages?: Record<string, { images?: Array<{ title?: string }> }> } };
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "images");
  url.searchParams.set("imlimit", "200");
  url.searchParams.set("pageids", String(pageId));
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");
  const data = await fetchJson<ImagesResponse>(url.toString());
  const images = data.query?.pages?.[String(pageId)]?.images ?? [];
  return images
    .map((img) => img.title)
    .filter((title): title is string => typeof title === "string" && /^File:/i.test(title))
    .map((title) => `File:${title.replace(/^File:/i, "").replaceAll("_", " ")}`);
}

async function findCommonsFileTitlesBySearch(query: string, maxCandidates: number): Promise<string[]> {
  type CommonsSearchResponse = {
    query?: {
      search?: Array<{ title?: string }>;
    };
  };

  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srnamespace", "6");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", String(Math.min(30, Math.max(5, maxCandidates))));
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const data = await fetchJson<CommonsSearchResponse>(url.toString());
  return (data.query?.search ?? [])
    .map((entry) => entry.title)
    .filter((title): title is string => typeof title === "string" && /^File:/i.test(title))
    .map((title) => `File:${title.replace(/^File:/i, "").replaceAll("_", " ")}`);
}

async function resolveCommonsImage(fileTitle: string): Promise<WikimediaCandidate | null> {
  type CommonsResponse = {
    query?: {
      pages?: Record<
        string,
        {
          imageinfo?: Array<{ url?: string; width?: number; height?: number }>;
          missing?: boolean;
        }
      >;
    };
  };

  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("titles", fileTitle);
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|size");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const data = await fetchJson<CommonsResponse>(url.toString());
  const pages = data.query?.pages;
  if (!pages) return null;

  for (const page of Object.values(pages)) {
    if (page.missing) continue;
    const info = page.imageinfo?.[0];
    if (!info?.url) continue;
    return { title: fileTitle, url: info.url, width: info.width, height: info.height };
  }

  return null;
}

function scoreWikimediaBase(c: WikimediaCandidate): number {
  let score = 0;
  if ((c.width ?? 0) >= 1200) score += 4;
  score += scoreLandscape(c.width, c.height);
  if (hasBadHints(c.title)) score -= 12;
  return score;
}

async function findWikimediaCandidates(placeName: string, maxCandidates: number): Promise<WikimediaCandidate[]> {
  const candidates: WikimediaCandidate[] = [];
  const pageId = await findPageIdBySearch(placeName);

  if (pageId) {
    const representative = await fetchRepresentativeFileTitle(pageId);
    if (representative && !hasBadHints(representative)) {
      const resolved = await resolveCommonsImage(representative);
      if (resolved) candidates.push(resolved);
    }

    if (candidates.length < maxCandidates) {
      const titles = Array.from(new Set(await fetchPageImageTitles(pageId)));
      for (const title of titles) {
        if (hasBadHints(title)) continue;
        const resolved = await resolveCommonsImage(title);
        if (resolved) candidates.push(resolved);
        if (candidates.length >= maxCandidates) break;
      }
    }
  }

  if (candidates.length < maxCandidates) {
    const searchQuery = `${placeName} camping OR campsite OR camper OR motorhome`;
    const titles = Array.from(new Set(await findCommonsFileTitlesBySearch(searchQuery, maxCandidates * 2)));
    for (const title of titles) {
      if (hasBadHints(title)) continue;
      const resolved = await resolveCommonsImage(title);
      if (resolved) candidates.push(resolved);
      if (candidates.length >= maxCandidates) break;
    }
  }

  return candidates;
}

function toGooglePhotos(photos: unknown): GooglePhoto[] {
  if (!Array.isArray(photos)) return [];

  return photos
    .map((photo) => {
      const item = photo as {
        name?: string;
        widthPx?: number;
        heightPx?: number;
        authorAttributions?: Array<{ displayName?: string; uri?: string }>;
      };
      const attributionText = Array.isArray(item.authorAttributions)
        ? item.authorAttributions
            .map((a) => `${a.displayName ?? ""} ${a.uri ?? ""}`.trim())
            .filter(Boolean)
            .join(" ")
        : "";

      return {
        name: item.name ?? "",
        widthPx: item.widthPx,
        heightPx: item.heightPx,
        attributionText,
      };
    })
    .filter((p) => p.name);
}

async function findGoogleMatch(
  place: PlaceRecord,
  radiusMeters: number,
  apiKey: string
): Promise<{ match: GoogleCandidate | null; reason?: string }> {
  type NearbyNewResponse = {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      location?: { latitude?: number; longitude?: number };
      photos?: unknown;
    }>;
  };

  const isHvo = place.type === "HVO_TANKSTELLE";
  const effectiveRadius = isHvo ? Math.max(radiusMeters, 1200) : radiusMeters;
  const cleanedPlaceName = sanitizePlaceNameForMatching(place.name);

  const data = await fetchJsonRequest<NearbyNewResponse>(
    "https://places.googleapis.com/v1/places:searchNearby",
    "POST",
    {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.photos",
      "Content-Type": "application/json",
    },
    {
      maxResultCount: 20,
      ...(isHvo ? { includedTypes: ["gas_station"] } : {}),
      locationRestriction: {
        circle: {
          center: { latitude: place.lat, longitude: place.lng },
          radius: effectiveRadius,
        },
      },
    }
  );

  const candidates: GoogleCandidate[] = (data.places ?? [])
    .map((r) => {
      const lat = r.location?.latitude;
      const lng = r.location?.longitude;
      const d = typeof lat === "number" && typeof lng === "number" ? distanceMeters(place.lat!, place.lng!, lat, lng) : undefined;
      return {
        placeId: r.id ?? "",
        name: r.displayName?.text ?? "",
        lat,
        lng,
        distanceMeters: d,
        photos: toGooglePhotos(r.photos),
      };
    })
    .filter((r) => r.placeId && r.name);

  if (candidates.length === 0) {
    return { match: null, reason: "No nearby Google Places result" };
  }

  let best: GoogleCandidate | null = null;
  let bestScore = -999;

  for (const c of candidates) {
    const cleanedCandidateName = sanitizePlaceNameForMatching(c.name);
    const nameSim = similarity(cleanedPlaceName, cleanedCandidateName);
    const brandSim = brandTokenOverlapScore(cleanedPlaceName, cleanedCandidateName);
    let score = isHvo ? nameSim * 8 + brandSim * 18 : nameSim * 10;
    if (typeof c.distanceMeters === "number") {
      if (c.distanceMeters <= effectiveRadius) score += 5;
      else score -= 5;
      score += Math.max(0, isHvo ? 6 - c.distanceMeters / Math.max(100, effectiveRadius / 2) : 3 - c.distanceMeters / Math.max(100, effectiveRadius));
    }
    if (isHvo && (c.photos?.length ?? 0) > 0) score += 3;

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (!best) return { match: null, reason: "No Google candidate" };
  const bestNameSim = similarity(cleanedPlaceName, sanitizePlaceNameForMatching(best.name));
  const bestBrandSim = brandTokenOverlapScore(cleanedPlaceName, sanitizePlaceNameForMatching(best.name));
  const far = typeof best.distanceMeters === "number" && best.distanceMeters > effectiveRadius * 1.5;
  const weakHvoMatch =
    isHvo &&
    bestBrandSim <= 0 &&
    bestNameSim < 0.2 &&
    typeof best.distanceMeters === "number" &&
    best.distanceMeters > 120;

  if ((!isHvo && bestNameSim < 0.45) || far || weakHvoMatch) {
    return { match: null, reason: "No confident Google place match" };
  }

  return { match: best };
}

async function findGooglePhotos(placeId: string, apiKey: string, initialPhotos?: GooglePhoto[]): Promise<GooglePhoto[]> {
  if (initialPhotos && initialPhotos.length > 0) {
    return initialPhotos;
  }

  type DetailsNewResponse = {
    id?: string;
    photos?: unknown;
  };

  const data = await fetchJsonRequest<DetailsNewResponse>(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`,
    "GET",
    {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "id,displayName,location,photos",
    }
  );

  return toGooglePhotos(data.photos);
}

async function findGoogleCandidates(
  place: PlaceRecord,
  radiusMeters: number,
  apiKey: string,
  maxCandidates: number
): Promise<ScoredCandidate[]> {
  const match = await findGoogleMatch(place, radiusMeters, apiKey);
  if (!match.match) return [];

  const photos = await findGooglePhotos(match.match.placeId, apiKey, match.match.photos);
  return photos.slice(0, maxCandidates).map((photo) => {
    const base = scoreLandscape(photo.widthPx, photo.heightPx) + ((photo.widthPx ?? 0) >= 1200 ? 5 : 0);
    const hintPenalty = hasBadHints(`${photo.name} ${photo.attributionText ?? ""}`) ? -8 : 0;
    const clientUrl = buildGooglePhotoMediaUrl(photo.name, PHOTO_MAX_WIDTH);
    const scoreUrl = new URL(clientUrl);
    scoreUrl.searchParams.set("key", apiKey);
    return {
      source: "google",
      placeType: place.type,
      url: clientUrl,
      fetchUrl: scoreUrl.toString(),
      score: base + hintPenalty,
      reason: `Google base score ${base + hintPenalty}`,
    };
  });
}

async function fetchImageBytes(url: string, timeoutMs: number): Promise<{
  ok: boolean;
  status: number;
  contentType: string;
  bytes: number;
  ms: number;
  data?: Buffer;
  message?: string;
}> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
      headers: { Accept: "image/*,*/*;q=0.8" },
    });
    const ms = Date.now() - startedAt;
    const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        contentType,
        bytes: 0,
        ms,
        message: response.statusText || "Fetch failed",
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    return {
      ok: true,
      status: response.status,
      contentType,
      bytes: data.byteLength,
      ms,
      data,
    };
  } catch (error: any) {
    return {
      ok: false,
      status: 0,
      contentType: "",
      bytes: 0,
      ms: Date.now() - startedAt,
      message: String(error?.message ?? "Fetch failed"),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function analyzeWithVision(url: string, placeType: PlaceType, includeDebug: boolean): Promise<{ score: number; reason: string; visionDebug?: VisionDebug }> {
  const visionKey = process.env.GOOGLE_CLOUD_VISION_API_KEY;
  if (!visionKey) {
    return { score: 0, reason: "Vision disabled (GOOGLE_CLOUD_VISION_API_KEY missing)" };
  }

  type VisionResponse = {
    responses?: Array<{
      labelAnnotations?: Array<{ description?: string; score?: number }>;
      faceAnnotations?: Array<unknown>;
      logoAnnotations?: Array<unknown>;
      landmarkAnnotations?: Array<unknown>;
      safeSearchAnnotation?: Record<string, string>;
      error?: { message?: string };
    }>;
  };

  const timeoutMs = envInt("HERO_VISION_TIMEOUT_MS", 12000);
  const imageFetch = await fetchImageBytes(url, timeoutMs);
  if (!imageFetch.ok || !imageFetch.data || imageFetch.bytes <= 0) {
    const message = imageFetch.message ?? "Failed to fetch image bytes";
    const reason = `Vision fetch failed: ${imageFetch.status} ${message}`;
    if (!includeDebug) return { score: -10, reason };
    return {
      score: -10,
      reason,
      visionDebug: {
        imageFetch: {
          ok: imageFetch.ok,
          status: imageFetch.status,
          contentType: imageFetch.contentType,
          bytes: imageFetch.bytes,
          ms: imageFetch.ms,
        },
        visionCall: { ok: false, ms: 0, errorMessage: "Skipped due to image fetch failure" },
        signals: {
          labelsTop5: [],
          hasFace: false,
          hasLogo: false,
          hasText: false,
          safeSearch: {},
          landmarkLikely: false,
          indoorLikely: false,
        },
      },
    };
  }

  const visionStartedAt = Date.now();
  const payload = {
    requests: [
      {
        image: { content: imageFetch.data.toString("base64") },
        features: [
          { type: "LABEL_DETECTION", maxResults: 20 },
          { type: "FACE_DETECTION", maxResults: 5 },
          { type: "LOGO_DETECTION", maxResults: 5 },
          { type: "LANDMARK_DETECTION", maxResults: 5 },
          { type: "SAFE_SEARCH_DETECTION", maxResults: 1 },
        ],
      },
    ],
  };

  let data: VisionResponse;
  try {
    data = await fetchJsonRequest<VisionResponse>(
      `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(visionKey)}`,
      "POST",
      { "Content-Type": "application/json" },
      payload,
      timeoutMs
    );
  } catch (error: any) {
    const message = String(error?.message ?? "Unknown Vision API error");
    const reason = `Vision error: ${message}`;
    if (!includeDebug) return { score: -8, reason };
    return {
      score: -8,
      reason,
      visionDebug: {
        imageFetch: {
          ok: imageFetch.ok,
          status: imageFetch.status,
          contentType: imageFetch.contentType,
          bytes: imageFetch.bytes,
          ms: imageFetch.ms,
        },
        visionCall: { ok: false, ms: Date.now() - visionStartedAt, errorMessage: message },
        signals: {
          labelsTop5: [],
          hasFace: false,
          hasLogo: false,
          hasText: false,
          safeSearch: {},
          landmarkLikely: false,
          indoorLikely: false,
        },
      },
    };
  }
  const visionMs = Date.now() - visionStartedAt;

  const item = data.responses?.[0];
  if (!item) return { score: -5, reason: "Vision empty response" };
  if (item.error?.message) return { score: -8, reason: `Vision error: ${item.error.message}` };

  const labels = (item.labelAnnotations ?? []).map((l) => ({
    description: (l.description ?? "").toLowerCase(),
    score: typeof l.score === "number" ? l.score : 0,
  }));

  const faceCount = item.faceAnnotations?.length ?? 0;
  const logoCount = item.logoAnnotations?.length ?? 0;
  const landmarkCount = item.landmarkAnnotations?.length ?? 0;
  const safeSearch = item.safeSearchAnnotation;
  const hasText = labels.some((label) => label.description.includes("text") || label.description.includes("sign"));
  const safeSearchPenalized = !!safeSearch && [safeSearch.adult, safeSearch.violence, safeSearch.racy]
    .filter(Boolean)
    .some((level) => level === "LIKELY" || level === "VERY_LIKELY");

  const typedScore = scoreVisionByPlaceType(placeType, {
    labels,
    faceCount,
    logoCount,
    landmarkCount,
    hasText,
    safeSearchPenalized,
  });

  const labelsTop5 = labels.slice(0, 5).map((label) => label.description).filter(Boolean);
  const hasFace = (item.faceAnnotations?.length ?? 0) > 0;
  const hasLogo = (item.logoAnnotations?.length ?? 0) > 0;
  const safe = item.safeSearchAnnotation ?? {};
  const landmarkLikely = (item.landmarkAnnotations?.length ?? 0) > 0;
  const indoorLikely = labels.some((label) => label.description.includes("indoor") || label.description.includes("room"));

  return {
    score: typedScore.score,
    reason: typedScore.reason,
    visionDebug: includeDebug
      ? {
          imageFetch: {
            ok: imageFetch.ok,
            status: imageFetch.status,
            contentType: imageFetch.contentType,
            bytes: imageFetch.bytes,
            ms: imageFetch.ms,
          },
          visionCall: {
            ok: true,
            ms: visionMs,
          },
          signals: {
            labelsTop5,
            hasFace,
            hasLogo,
            hasText,
            safeSearch: safe,
            landmarkLikely,
            indoorLikely,
          },
        }
      : undefined,
  };
}

async function scoreCandidates(candidates: ScoredCandidate[], includeDebug: boolean): Promise<ScoredCandidate[]> {
  const concurrency = Math.min(8, Math.max(1, envInt("HERO_AUTOFILL_CONCURRENCY", 5)));
  return runWithConcurrency(candidates, concurrency, async (candidate) => {
    try {
      const vision = await analyzeWithVision(candidate.fetchUrl ?? candidate.url, candidate.placeType, includeDebug);
      return {
        ...candidate,
        score: candidate.score + vision.score,
        reason: `${candidate.reason}; ${vision.reason}`,
        visionDebug: vision.visionDebug,
      };
    } catch (error: any) {
      return {
        ...candidate,
        reason: `${candidate.reason}; Vision error: ${String(error?.message ?? "error")}`,
      };
    }
  });
}

function isValidPlace(place: PlaceRecord): boolean {
  return typeof place.lat === "number" && Number.isFinite(place.lat) && typeof place.lng === "number" && Number.isFinite(place.lng);
}

export async function POST(req: Request) {
  try {
    const body = parseBody(await req.json().catch(() => ({})));
    const searchParams = new URL(req.url).searchParams;
    const force = parseBool(searchParams, ["force", "forceUpdateExisting", "forceUpdateExistingUrls", "forceUpdate"]);
    const dryRun = parseBool(searchParams, ["dryRun"]);
    const refresh = parseBool(searchParams, ["refresh", "rediscover"]);
    const cleanupPlaceholders = parseBool(searchParams, ["cleanupPlaceholders", "cleanPlaceholders", "placeholderCleanup"]);
    const refreshCamping = parseBool(searchParams, ["refreshCamping", "refreshCampingHeroes"]);
    const cleanupCampingPlaceholders = parseBool(searchParams, ["cleanupCampingPlaceholders", "cleanupCamping"]);
    const debugVision = parseBool(searchParams, ["debugVision"]);
    const queryLimit = parsePositiveInt(searchParams.get("limit"));
    const queryOffset = parsePositiveInt(searchParams.get("offset"));
    const queryCursor = searchParams.get("cursor")?.trim();
    const hardCap = parsePositiveInt(process.env.HERO_AUTOFILL_HARD_CAP ?? null);
    const typeFilter = parseTypeFilter(searchParams);
    const idsFilter = parseExplicitIds(searchParams.get("ids"));

    if (typeFilter.error) {
      return NextResponse.json(
        {
          totalPlaces: 0,
          processed: 0,
          updated: 0,
          skipped: 0,
          failed: 1,
          nextCursor: null,
          results: [],
          counts: { created: 0, updated: 0, skipped: 0, errors: 1 },
          capApplied: null,
          error: typeFilter.error,
        },
        { status: 400 }
      );
    }

    if (idsFilter.error) {
      return NextResponse.json(
        {
          totalPlaces: 0,
          processed: 0,
          updated: 0,
          skipped: 0,
          failed: 1,
          nextCursor: null,
          results: [],
          counts: { created: 0, updated: 0, skipped: 0, errors: 1 },
          capApplied: null,
          error: idsFilter.error,
        },
        { status: 400 }
      );
    }

    const requestedLimit = Math.max(1, queryLimit ?? body.limit ?? DEFAULT_LIMIT);
    const limit = hardCap ? Math.min(requestedLimit, hardCap) : requestedLimit;
    const capApplied = hardCap && limit < requestedLimit ? { requestedLimit, appliedLimit: limit, hardCap } : null;

    const options = {
      ...body,
      limit,
      force: body.force || force,
      refresh: body.refresh || refresh,
      refreshCamping: body.refreshCamping || refreshCamping,
      cleanupPlaceholders: body.cleanupPlaceholders || cleanupPlaceholders,
      cleanupCampingPlaceholders: body.cleanupCampingPlaceholders || cleanupCampingPlaceholders,
      dryRun: body.dryRun || dryRun,
      cursor: queryCursor && queryCursor.length > 0 ? queryCursor : body.cursor,
      offset: queryOffset ?? body.offset ?? 0,
      types: typeFilter.types ?? body.types,
    };
    const googleKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";

    if ((options.provider === "google" || options.provider === "auto") && !googleKey) {
      return NextResponse.json(
        {
          totalPlaces: 0,
          processed: 0,
          updated: 0,
          skipped: 0,
          failed: 0,
          nextCursor: null,
          results: [],
          counts: { created: 0, updated: 0, skipped: 0, errors: 0 },
          error: "Missing GOOGLE_PLACES_API_KEY (or GOOGLE_MAPS_API_KEY) env variable",
        },
        { status: 400 }
      );
    }

    const explicitIds = idsFilter.ids;
    const explicitIdsMode = Boolean(explicitIds && explicitIds.length > 0);

    const whereBase = {
      ...(options.types?.length ? { type: { in: options.types } } : {}),
      ...(explicitIdsMode ? { id: { in: explicitIds } } : {}),
    };

    const cursorId = !explicitIdsMode && options.cursor ? parsePositiveInt(options.cursor) : undefined;
    const useCursorPaging = !explicitIdsMode && typeof cursorId === "number" && cursorId > 0;
    const safeOffset = explicitIdsMode ? 0 : Math.max(0, options.offset);

    const places = (await prisma.place.findMany({
      where: whereBase,
      ...(explicitIdsMode ? {} : useCursorPaging ? { cursor: { id: cursorId }, skip: 1 } : { skip: safeOffset }),
      ...(explicitIdsMode ? {} : { take: options.limit }),
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        lat: true,
        lng: true,
        heroImageUrl: true,
        thumbnailImageId: true,
        images: {
          select: {
            id: true,
            filename: true,
          },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          take: 6,
        },
      },
    })) as PlaceRecord[];

    const totalPlaces = explicitIdsMode ? places.length : await prisma.place.count({ where: whereBase });

    const results: HeroResult[] = [];
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let created = 0;

    const placeConcurrency = Math.min(8, Math.max(1, envInt("HERO_AUTOFILL_CONCURRENCY", 5)));

    const perPlaceResults = await runWithConcurrency(places, placeConcurrency, async (place): Promise<HeroResult> => {
      const existingHeroUrl = place.heroImageUrl;
      const existingHeroIsPlaceholder = isPlaceholderHeroUrl(existingHeroUrl);
      const hasStoredGalleryHero =
        Number.isFinite(Number(place.thumbnailImageId)) ||
        (Array.isArray(place.images) && place.images.some((image) => typeof image?.filename === "string" && image.filename.trim()));
      const isCamping = place.type === "CAMPINGPLATZ";
      const shouldRefreshExisting = isCamping && (options.refresh || options.refreshCamping);
      const shouldCleanupPlaceholder = isCamping && existingHeroIsPlaceholder && (options.cleanupPlaceholders || options.cleanupCampingPlaceholders);
      const wikimediaRejectReasons: string[] = [];

      if (hasStoredGalleryHero && !options.force) {
        return {
          id: String(place.id),
          name: place.name,
          placeId: String(place.id),
          placeName: place.name,
          status: "SKIPPED",
          reason: "Stored gallery/thumbnail hero retained",
          chosenUrl: existingHeroUrl ?? undefined,
          selectionDebug: {
            sourcesTried: options.provider === "google" ? ["google"] : options.provider === "wikimedia" ? ["wikimedia"] : ["google", "wikimedia"],
            totalCandidates: 0,
            removedPlaceholder: false,
            discardedExistingHero: false,
            existingHeroWasPlaceholder: existingHeroIsPlaceholder,
            sourceDebug: [],
            noSelectionReason: "Existing local gallery hero retained (force=false)",
          },
          action: "skipped",
        };
      }

      if (existingHeroUrl && !options.force && !shouldRefreshExisting && !shouldCleanupPlaceholder) {
        return {
          id: String(place.id),
          name: place.name,
          placeId: String(place.id),
          placeName: place.name,
          status: "SKIPPED",
          reason: "heroImageUrl already set and force=false",
          chosenUrl: existingHeroUrl,
          selectionDebug: {
            sourcesTried: options.provider === "google" ? ["google"] : options.provider === "wikimedia" ? ["wikimedia"] : ["google", "wikimedia"],
            totalCandidates: 0,
            removedPlaceholder: false,
            discardedExistingHero: false,
            existingHeroWasPlaceholder: existingHeroIsPlaceholder,
            sourceDebug: [],
            noSelectionReason: "Existing heroImageUrl retained (force=false)",
          },
          action: "skipped",
        };
      }

      if (!isValidPlace(place)) {
        return {
          id: String(place.id),
          name: place.name,
          placeId: String(place.id),
          placeName: place.name,
          status: "SKIPPED",
          reason: "Invalid place coordinates (lat/lng missing)",
          action: "skipped",
        };
      }

      const candidates: ScoredCandidate[] = [];
      const sourceDebug: SourceAttemptDebug[] = [];
      const maxCandidates = options.maxCandidatesPerPlace;

      try {
        if (options.provider === "google" || options.provider === "auto") {
          const googleCandidates = await findGoogleCandidates(place, options.radiusMeters, googleKey, maxCandidates);
          const boosted = googleCandidates.map(withSourceBonus);
          candidates.push(...boosted);
          const top = boosted.sort((a, b) => b.score - a.score)[0];
          sourceDebug.push({
            source: "google",
            attempted: true,
            discovered: googleCandidates.length,
            scored: boosted.length,
            topScore: top ? Math.round(top.score) : undefined,
            topUrl: top?.url,
          });
        } else {
          sourceDebug.push({ source: "google", attempted: false, discovered: 0, scored: 0 });
        }
      } catch (error: any) {
        console.warn("hero-autofill google error", place.id, error?.message ?? error);
        sourceDebug.push({
          source: "google",
          attempted: true,
          discovered: 0,
          scored: 0,
          error: String(error?.message ?? error),
        });
      }

      try {
        if (options.provider === "wikimedia" || options.provider === "auto") {
          const wikimediaMax = place.type === "CAMPINGPLATZ" ? Math.min(30, maxCandidates * 2) : maxCandidates;
          const wiki = await findWikimediaCandidates(place.name, wikimediaMax);
          const filteredWiki =
            place.type === "CAMPINGPLATZ"
              ? wiki.filter((candidate) => {
                  const verdict = evaluateCampingWikimediaCandidate(candidate, place.name);
                  if (!verdict.accepted && verdict.reason) {
                    wikimediaRejectReasons.push(verdict.reason);
                  }
                  return verdict.accepted;
                })
              : wiki;
          const mapped = filteredWiki.map((c) => {
            const baseScore = scoreWikimediaBase(c);
            return {
              source: "wikimedia" as const,
              placeType: place.type,
              url: c.url,
              score: baseScore,
              reason: `Wikimedia base score ${baseScore}`,
            };
          });
          const boosted = mapped.map(withSourceBonus);
          candidates.push(...boosted);
          const top = boosted.sort((a, b) => b.score - a.score)[0];
          sourceDebug.push({
            source: "wikimedia",
            attempted: true,
            discovered: wiki.length,
            scored: boosted.length,
            topScore: top ? Math.round(top.score) : undefined,
            topUrl: top?.url,
            error: wikimediaRejectReasons.length > 0 ? `${wikimediaRejectReasons.length} candidate(s) rejected by camping filter` : undefined,
          });
        } else {
          sourceDebug.push({ source: "wikimedia", attempted: false, discovered: 0, scored: 0 });
        }
      } catch (error: any) {
        console.warn("hero-autofill wikimedia error", place.id, error?.message ?? error);
        const isRateLimited = isRateLimitError(error);
        sourceDebug.push({
          source: "wikimedia",
          attempted: true,
          discovered: 0,
          scored: 0,
          error: isRateLimited
            ? "Wikimedia rate-limited (HTTP 429); continuing with remaining sources"
            : String(error?.message ?? error),
        });
      }

      const uniqueCandidates = Array.from(new Map(candidates.map((c) => [c.url, c])).values())
        .sort((a, b) => b.score - a.score)
        .slice(0, maxCandidates);
      const scoredCandidates = await scoreCandidates(uniqueCandidates, debugVision);
      const selection = selectHeroCandidateByThreshold(place.type, scoredCandidates);
      const rawBestCandidate = selection.bestPreferred ?? selection.bestAcceptable ?? null;
      const bestCandidate = isCamping && rawBestCandidate && isPlaceholderHeroUrl(rawBestCandidate.url) ? null : rawBestCandidate;

      const discardedExistingHero = Boolean(existingHeroUrl) && (bestCandidate?.url ?? null) !== existingHeroUrl;

      let chosenUrl: string | undefined;
      let source: HeroSource | undefined;
      let score: number | undefined;
      let reason = "";
      let heroReason = "";

      const sourcesAttempted: HeroSource[] =
        options.provider === "google"
          ? ["google"]
          : options.provider === "wikimedia"
            ? ["wikimedia"]
            : ["google", "wikimedia"];
      if (bestCandidate) {
        chosenUrl = bestCandidate.url;
        source = bestCandidate.source;
        score = Math.round(bestCandidate.score);
        const tier = selection.bestPreferred ? "preferred" : "acceptable";
        const nonGoogleFallbackNote = source !== "google" ? " No placeholder used; acceptable non-google fallback selected." : " No placeholder used.";
        heroReason = `Selected ${tier} ${source} candidate (score ${score}; preferred>=${selection.thresholds.preferredMin}, acceptable>=${selection.thresholds.acceptableMin}). ${bestCandidate.reason}.${nonGoogleFallbackNote}`;
        reason = `Selected ${tier} ${source} candidate with score ${score}`;
      } else {
        const bestOverallScore = selection.bestOverall ? Math.round(selection.bestOverall.score) : undefined;
        const noSelectionReason =
          bestOverallScore === undefined
            ? "No candidates discovered from active sources"
            : `No acceptable real candidate (best=${bestOverallScore}, acceptable>=${selection.thresholds.acceptableMin})`;
        return {
          id: String(place.id),
          name: place.name,
          placeId: String(place.id),
          placeName: place.name,
          reason: `${noSelectionReason}; kept existing hero value (${existingHeroUrl ? "unchanged" : "null"})`,
          chosenUrl: existingHeroUrl ?? undefined,
          source: undefined,
          heroReason: `No placeholder used; ${noSelectionReason}`,
          selectionDebug: {
            sourcesTried: sourcesAttempted,
            sourceDebug,
            totalCandidates: uniqueCandidates.length,
            removedPlaceholder: false,
            discardedExistingHero: false,
            existingHeroWasPlaceholder: existingHeroIsPlaceholder,
            bestOverall: selection.bestOverall
              ? {
                  source: selection.bestOverall.source,
                  score: Math.round(selection.bestOverall.score),
                  url: selection.bestOverall.url,
                }
              : undefined,
            bestPreferredCandidate: undefined,
            acceptableFallbackCandidate: undefined,
            selectedCandidate: undefined,
            whyWikimediaRejected: wikimediaRejectReasons.length > 0 ? wikimediaRejectReasons.slice(0, 8) : undefined,
            noSelectionReason: `No placeholder used; ${noSelectionReason}`,
          },
          action: "skipped",
          status: "SKIPPED",
        };
      }

      const wasExisting = Boolean(place.heroImageUrl);
      const isForcedRescore = wasExisting && options.force;
      const resultReason = isForcedRescore
        ? `force enabled - rescored existing heroImageUrl${options.dryRun ? " (dry-run)" : ""}`
        : `${reason}${options.dryRun ? " (dry-run)" : ""}`;

      if (!options.dryRun) {
        await prisma.place.update({
          where: { id: place.id },
          data: { heroImageUrl: chosenUrl, heroScore: score, heroReason },
        });
      }

      return {
        id: String(place.id),
        name: place.name,
        placeId: String(place.id),
        placeName: place.name,
        status: "UPDATED",
        reason: resultReason,
        chosenUrl,
        source,
        score,
        heroReason,
        visionDebug: debugVision ? bestCandidate?.visionDebug : undefined,
        selectionDebug: {
          sourcesTried: sourcesAttempted,
          sourceDebug,
          totalCandidates: uniqueCandidates.length,
          removedPlaceholder: false,
          discardedExistingHero,
          existingHeroWasPlaceholder: existingHeroIsPlaceholder,
          bestOverall: selection.bestOverall
            ? {
                source: selection.bestOverall.source,
                score: Math.round(selection.bestOverall.score),
                url: selection.bestOverall.url,
              }
            : undefined,
          bestPreferredCandidate: selection.bestPreferred
            ? {
                source: selection.bestPreferred.source,
                score: Math.round(selection.bestPreferred.score),
                url: selection.bestPreferred.url,
              }
            : undefined,
          acceptableFallbackCandidate: selection.bestAcceptable
            ? {
                source: selection.bestAcceptable.source,
                score: Math.round(selection.bestAcceptable.score),
                url: selection.bestAcceptable.url,
              }
            : undefined,
          selectedCandidate: {
            source: bestCandidate.source,
            score: Math.round(bestCandidate.score),
            url: bestCandidate.url,
            tier: selection.bestPreferred ? "preferred" : "acceptable",
          },
          whyWikimediaRejected: wikimediaRejectReasons.length > 0 ? wikimediaRejectReasons.slice(0, 8) : undefined,
          noSelectionReason: undefined,
        },
        action: options.dryRun ? (isForcedRescore ? "updated" : wasExisting ? "would-update" : "would-create") : wasExisting ? "updated" : "created",
      };
    });

    for (const r of perPlaceResults) {
      results.push(r);
      if (r.status === "UPDATED") {
        updated += 1;
        if (r.action === "created" || r.action === "would-create") created += 1;
      } else if (r.status === "SKIPPED") {
        skipped += 1;
      } else {
        failed += 1;
      }
    }

    const lastPlaceId = places.length > 0 ? places[places.length - 1]?.id : null;
    let hasMore = false;

    if (!explicitIdsMode && lastPlaceId !== null) {
      if (useCursorPaging) {
        const nextPlace = await prisma.place.findFirst({
          where: { ...whereBase, id: { gt: lastPlaceId } },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        hasMore = Boolean(nextPlace);
      } else {
        hasMore = safeOffset + places.length < totalPlaces;
      }
    }

    const nextCursor = explicitIdsMode ? null : hasMore && lastPlaceId !== null ? String(lastPlaceId) : null;

    return NextResponse.json(
      {
        totalPlaces,
        processed: results.length,
        updated,
        skipped,
        failed,
        nextCursor,
        results,
        counts: { created, updated, skipped, errors: failed },
        capApplied,
        debug: {
          explicitIdsMode,
          parsedIds: explicitIdsMode ? explicitIds : undefined,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    return NextResponse.json(
      {
        totalPlaces: 0,
        processed: 0,
        updated: 0,
        skipped: 0,
        failed: 1,
        nextCursor: null,
        results: [],
        counts: { created: 0, updated: 0, skipped: 0, errors: 1 },
        capApplied: null,
        error: error?.message ?? "Unexpected error",
      },
      { status: 500 }
    );
  }
}
