import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildGooglePhotoMediaUrl } from "@/lib/hero-image";
import { scoreVisionByPlaceType } from "@/lib/hero-type-scoring";
import { selectHeroCandidateByThreshold } from "@/lib/hero-candidate-selection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HeroSource = "google" | "wikimedia" | "placeholder";
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
    sourcesTried: Array<Exclude<HeroSource, "placeholder">>;
    totalCandidates: number;
    bestOverall?: { source: Exclude<HeroSource, "placeholder">; score: number; url: string };
    bestPreferredCandidate?: { source: Exclude<HeroSource, "placeholder">; score: number; url: string };
    acceptableFallbackCandidate?: { source: Exclude<HeroSource, "placeholder">; score: number; url: string };
    placeholderReason?: string;
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
  source: Exclude<HeroSource, "placeholder">;
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


function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function parseBody(value: unknown): {
  limit: number;
  force: boolean;
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

function parsePositiveInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
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
  const pageId = await findPageIdBySearch(placeName);
  if (!pageId) return [];

  const candidates: WikimediaCandidate[] = [];
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
      locationRestriction: {
        circle: {
          center: { latitude: place.lat, longitude: place.lng },
          radius: radiusMeters,
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
    const nameSim = similarity(place.name, c.name);
    let score = nameSim * 10;
    if (typeof c.distanceMeters === "number") {
      if (c.distanceMeters <= radiusMeters) score += 5;
      else score -= 5;
      score += Math.max(0, 3 - c.distanceMeters / Math.max(100, radiusMeters));
    }

    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }

  if (!best) return { match: null, reason: "No Google candidate" };
  const bestNameSim = similarity(place.name, best.name);
  const far = typeof best.distanceMeters === "number" && best.distanceMeters > radiusMeters * 1.5;
  if (bestNameSim < 0.45 || far) {
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
    const debugVision = parseBool(searchParams, ["debugVision"]);
    const queryLimit = parsePositiveInt(searchParams.get("limit"));
    const queryOffset = parsePositiveInt(searchParams.get("offset"));
    const queryCursor = searchParams.get("cursor")?.trim();
    const hardCap = parsePositiveInt(process.env.HERO_AUTOFILL_HARD_CAP ?? null);
    const requestedLimit = Math.max(1, queryLimit ?? body.limit ?? DEFAULT_LIMIT);
    const limit = hardCap ? Math.min(requestedLimit, hardCap) : requestedLimit;
    const capApplied = hardCap && limit < requestedLimit ? { requestedLimit, appliedLimit: limit, hardCap } : null;

    const options = {
      ...body,
      limit,
      force: body.force || force,
      dryRun: body.dryRun || dryRun,
      cursor: queryCursor && queryCursor.length > 0 ? queryCursor : body.cursor,
      offset: queryOffset ?? body.offset ?? 0,
    };
    const googleKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
    const placeholder = (process.env.HERO_IMAGE_PLACEHOLDER_URL ?? "").trim();

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

    const whereBase = options.types?.length ? { type: { in: options.types } } : {};
    const cursorId = options.cursor ? parsePositiveInt(options.cursor) : undefined;
    const useCursorPaging = typeof cursorId === "number" && cursorId > 0;
    const safeOffset = Math.max(0, options.offset);

    const places = (await prisma.place.findMany({
      where: whereBase,
      ...(useCursorPaging ? { cursor: { id: cursorId }, skip: 1 } : { skip: safeOffset }),
      take: options.limit,
      orderBy: { id: "asc" },
      select: {
        id: true,
        name: true,
        type: true,
        lat: true,
        lng: true,
        heroImageUrl: true,
      },
    })) as PlaceRecord[];

    const totalPlaces = await prisma.place.count({ where: whereBase });

    const results: HeroResult[] = [];
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let created = 0;

    const placeConcurrency = Math.min(8, Math.max(1, envInt("HERO_AUTOFILL_CONCURRENCY", 5)));

    const perPlaceResults = await runWithConcurrency(places, placeConcurrency, async (place): Promise<HeroResult> => {
      if (place.heroImageUrl && !options.force) {
        return {
          id: String(place.id),
          name: place.name,
          placeId: String(place.id),
          placeName: place.name,
          status: "SKIPPED",
          reason: "heroImageUrl already set and force=false",
          chosenUrl: place.heroImageUrl,
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
      const maxCandidates = options.maxCandidatesPerPlace;

      try {
        if (options.provider === "google" || options.provider === "auto") {
          const googleCandidates = await findGoogleCandidates(place, options.radiusMeters, googleKey, maxCandidates);
          candidates.push(...googleCandidates);
        }
      } catch (error: any) {
        console.warn("hero-autofill google error", place.id, error?.message ?? error);
      }

      try {
        if (options.provider === "wikimedia" || options.provider === "auto") {
          const wiki = await findWikimediaCandidates(place.name, maxCandidates);
          candidates.push(
            ...wiki.map((c) => ({
              source: "wikimedia" as const,
              placeType: place.type,
              url: c.url,
              score: scoreWikimediaBase(c),
              reason: `Wikimedia base score ${scoreWikimediaBase(c)}`,
            }))
          );
        }
      } catch (error: any) {
        console.warn("hero-autofill wikimedia error", place.id, error?.message ?? error);
      }

      const uniqueCandidates = Array.from(new Map(candidates.map((c) => [c.url, c])).values())
        .sort((a, b) => b.score - a.score)
        .slice(0, maxCandidates);
      const scoredCandidates = await scoreCandidates(uniqueCandidates, debugVision);
      const selection = selectHeroCandidateByThreshold(place.type, scoredCandidates);
      const bestCandidate = selection.bestPreferred ?? selection.bestAcceptable ?? null;

      let chosenUrl: string | undefined;
      let source: HeroSource | undefined;
      let score: number | undefined;
      let reason = "";
      let heroReason = "";

      const sourcesTried = Array.from(new Set(uniqueCandidates.map((c) => c.source)));

      if (bestCandidate) {
        chosenUrl = bestCandidate.url;
        source = bestCandidate.source;
        score = Math.round(bestCandidate.score);
        const tier = selection.bestPreferred ? "preferred" : "acceptable";
        heroReason = `Selected ${tier} ${source} candidate (score ${score}; preferred>=${selection.thresholds.preferredMin}, acceptable>=${selection.thresholds.acceptableMin}). ${bestCandidate.reason}`;
        reason = `Selected ${tier} ${source} candidate with score ${score}`;
      } else if (placeholder) {
        chosenUrl = placeholder;
        source = "placeholder";
        score = -999;
        const bestOverallScore = selection.bestOverall ? Math.round(selection.bestOverall.score) : undefined;
        heroReason =
          bestOverallScore === undefined
            ? "Placeholder used: no source candidate discovered"
            : `Placeholder used: best real candidate score ${bestOverallScore} is below acceptable threshold ${selection.thresholds.acceptableMin}`;
        reason =
          bestOverallScore === undefined
            ? "No candidates from Google/Wikimedia. Placeholder set as last resort."
            : `No acceptable real candidate (best=${bestOverallScore}, acceptable>=${selection.thresholds.acceptableMin}). Placeholder set as last resort.`;
      } else {
        return {
          id: String(place.id),
          name: place.name,
          placeId: String(place.id),
          placeName: place.name,
          status: "FAILED",
          reason: "No candidate found and HERO_IMAGE_PLACEHOLDER_URL is missing",
          action: "error",
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
          sourcesTried,
          totalCandidates: uniqueCandidates.length,
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
          placeholderReason: source === "placeholder" ? heroReason : undefined,
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

    if (lastPlaceId !== null) {
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

    const nextCursor = hasMore && lastPlaceId !== null ? String(lastPlaceId) : null;

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
