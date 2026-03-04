import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

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
  action: HeroAction;
  placeId: string;
  placeName: string;
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
  url: string;
  score: number;
  reason: string;
};

const MAX_LIMIT = 500;
const DEFAULT_LIMIT = 250;
const DEFAULT_RADIUS_METERS = 200;
const MAX_RADIUS_METERS = 5000;
const FETCH_TIMEOUT_MS = 15000;
const PHOTO_MAX_WIDTH = 1600;
const ALL_TYPES: PlaceType[] = ["CAMPINGPLATZ", "STELLPLATZ", "HVO_TANKSTELLE", "SEHENSWUERDIGKEIT"];
const BAD_HINTS = ["logo", "icon", "map", "flag", "coat", "emblem", "text", "sign", "selfie", "portrait"];
const POSITIVE_LABELS = [
  "landscape",
  "nature",
  "outdoor",
  "beach",
  "coast",
  "mountain",
  "forest",
  "campground",
  "building",
  "monument",
  "landmark",
];
const NEGATIVE_LABELS = [
  "person",
  "selfie",
  "portrait",
  "indoor",
  "room",
  "logo",
  "advertising",
  "sign",
  "text",
  "vehicle",
  "fuel dispenser",
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
  dryRun: boolean;
  provider: "google" | "wikimedia" | "auto";
  radiusMeters: number;
  offset: number;
  cursor?: number;
  types?: PlaceType[];
  maxCandidatesPerPlace: number;
} {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const limitValue = typeof raw.limit === "number" ? Math.floor(raw.limit) : DEFAULT_LIMIT;
  const radiusValue = typeof raw.radiusMeters === "number" ? Math.floor(raw.radiusMeters) : DEFAULT_RADIUS_METERS;
  const offsetValue = typeof raw.offset === "number" ? Math.max(0, Math.floor(raw.offset)) : 0;
  const cursorValue = typeof raw.cursor === "number" ? Math.floor(raw.cursor) : undefined;
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
    limit: Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitValue) ? limitValue : DEFAULT_LIMIT)),
    force: raw.force === true,
    dryRun: raw.dryRun === true,
    provider,
    radiusMeters: Math.min(
      MAX_RADIUS_METERS,
      Math.max(50, Number.isFinite(radiusValue) ? radiusValue : DEFAULT_RADIUS_METERS)
    ),
    offset: offsetValue,
    cursor: cursorValue && cursorValue > 0 ? cursorValue : undefined,
    types: types && types.length > 0 ? Array.from(new Set(types)) : undefined,
    maxCandidatesPerPlace: Math.min(30, Math.max(1, maxCandidatesPerPlaceRaw)),
  };
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

function buildGooglePhotoUrl(photoName: string, apiKey: string): string {
  const base = `https://places.googleapis.com/v1/${photoName}/media`;
  const url = new URL(base);
  url.searchParams.set("maxWidthPx", String(PHOTO_MAX_WIDTH));
  url.searchParams.set("key", apiKey);
  return url.toString();
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
    return {
      source: "google",
      url: buildGooglePhotoUrl(photo.name, apiKey),
      score: base + hintPenalty,
      reason: `Google base score ${base + hintPenalty}`,
    };
  });
}

async function analyzeWithVision(url: string): Promise<{ score: number; reason: string }> {
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
  const payload = {
    requests: [
      {
        image: { source: { imageUri: url } },
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

  const data = await fetchJsonRequest<VisionResponse>(
    `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(visionKey)}`,
    "POST",
    { "Content-Type": "application/json" },
    payload,
    timeoutMs
  );

  const item = data.responses?.[0];
  if (!item) return { score: -5, reason: "Vision empty response" };
  if (item.error?.message) return { score: -8, reason: `Vision error: ${item.error.message}` };

  let score = 0;
  const reasons: string[] = [];

  const labels = (item.labelAnnotations ?? []).map((l) => ({
    description: (l.description ?? "").toLowerCase(),
    score: typeof l.score === "number" ? l.score : 0,
  }));

  for (const label of labels) {
    if (POSITIVE_LABELS.some((k) => label.description.includes(k))) {
      const points = Math.round(8 * Math.max(0.2, label.score));
      score += points;
      reasons.push(`+${points} label:${label.description}`);
    }

    if (NEGATIVE_LABELS.some((k) => label.description.includes(k))) {
      const points = Math.round(10 * Math.max(0.2, label.score));
      score -= points;
      reasons.push(`-${points} label:${label.description}`);
    }
  }

  const faceCount = item.faceAnnotations?.length ?? 0;
  if (faceCount > 0) {
    const points = Math.min(35, faceCount * 12);
    score -= points;
    reasons.push(`-${points} faces:${faceCount}`);
  }

  const logoCount = item.logoAnnotations?.length ?? 0;
  if (logoCount > 0) {
    const points = Math.min(40, logoCount * 15);
    score -= points;
    reasons.push(`-${points} logos:${logoCount}`);
  }

  const landmarkCount = item.landmarkAnnotations?.length ?? 0;
  if (landmarkCount > 0) {
    const points = Math.min(35, landmarkCount * 16);
    score += points;
    reasons.push(`+${points} landmarks:${landmarkCount}`);
  }

  const safe = item.safeSearchAnnotation;
  if (safe) {
    const penalized = [safe.adult, safe.violence, safe.racy]
      .filter(Boolean)
      .some((level) => level === "LIKELY" || level === "VERY_LIKELY");
    if (penalized) {
      score -= 10;
      reasons.push("-10 safe-search");
    }
  }

  return { score, reason: reasons.length > 0 ? reasons.join("; ") : "Vision neutral" };
}

async function scoreCandidates(candidates: ScoredCandidate[]): Promise<ScoredCandidate[]> {
  const concurrency = Math.min(8, Math.max(1, envInt("HERO_AUTOFILL_CONCURRENCY", 5)));
  return runWithConcurrency(candidates, concurrency, async (candidate) => {
    try {
      const vision = await analyzeWithVision(candidate.url);
      return {
        ...candidate,
        score: candidate.score + vision.score,
        reason: `${candidate.reason}; ${vision.reason}`,
      };
    } catch (error: any) {
      return {
        ...candidate,
        reason: `${candidate.reason}; vision-fallback:${String(error?.message ?? "error")}`,
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
    const googleKey = process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "";
    const placeholder = (process.env.HERO_IMAGE_PLACEHOLDER_URL ?? "").trim();

    if ((body.provider === "google" || body.provider === "auto") && !googleKey) {
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

    const whereBase = body.types?.length ? { type: { in: body.types } } : {};
    const where = body.cursor ? { ...whereBase, id: { gt: body.cursor } } : whereBase;

    const places = (await prisma.place.findMany({
      where,
      skip: body.cursor ? 0 : body.offset,
      take: body.limit,
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

    const results: HeroResult[] = [];
    let updated = 0;
    let skipped = 0;
    let failed = 0;
    let created = 0;

    const placeConcurrency = Math.min(8, Math.max(1, envInt("HERO_AUTOFILL_CONCURRENCY", 5)));

    const perPlaceResults = await runWithConcurrency(places, placeConcurrency, async (place): Promise<HeroResult> => {
      if (place.heroImageUrl && !body.force) {
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
      const maxCandidates = body.maxCandidatesPerPlace;

      try {
        if (body.provider === "google" || body.provider === "auto") {
          const googleCandidates = await findGoogleCandidates(place, body.radiusMeters, googleKey, maxCandidates);
          candidates.push(...googleCandidates);
        }
      } catch (error: any) {
        console.warn("hero-autofill google error", place.id, error?.message ?? error);
      }

      try {
        if (body.provider === "wikimedia" || body.provider === "auto") {
          const wiki = await findWikimediaCandidates(place.name, maxCandidates);
          candidates.push(
            ...wiki.map((c) => ({
              source: "wikimedia" as const,
              url: c.url,
              score: scoreWikimediaBase(c),
              reason: `Wikimedia base score ${scoreWikimediaBase(c)}`,
            }))
          );
        }
      } catch (error: any) {
        console.warn("hero-autofill wikimedia error", place.id, error?.message ?? error);
      }

      const uniqueCandidates = Array.from(new Map(candidates.map((c) => [c.url, c])).values()).slice(0, maxCandidates);
      const scoredCandidates = await scoreCandidates(uniqueCandidates);
      const bestCandidate = [...scoredCandidates].sort((a, b) => b.score - a.score)[0] ?? null;

      let chosenUrl: string | undefined;
      let source: HeroSource | undefined;
      let score: number | undefined;
      let reason = "";
      let heroReason = "";

      if (bestCandidate) {
        chosenUrl = bestCandidate.url;
        source = bestCandidate.source;
        score = Math.round(bestCandidate.score);
        heroReason = `Fallback A used best candidate. ${bestCandidate.reason}`;
        reason = score >= 0 ? `Selected ${source} candidate with score ${score}` : `Selected low-score candidate (fallback A) from ${source} with score ${score}`;
      } else if (placeholder) {
        chosenUrl = placeholder;
        source = "placeholder";
        score = -999;
        heroReason = "Fallback B placeholder used";
        reason = "No candidates from Google/Wikimedia. Placeholder set (fallback B).";
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

      if (!body.dryRun) {
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
        reason: `${reason}${body.dryRun ? " (dry-run)" : ""}`,
        chosenUrl,
        source,
        score,
        heroReason,
        action: body.dryRun ? (wasExisting ? "would-update" : "would-create") : wasExisting ? "updated" : "created",
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

    const nextCursor = places.length > 0 ? places[places.length - 1]?.id ?? null : null;

    return NextResponse.json(
      {
        totalPlaces: places.length,
        processed: results.length,
        updated,
        skipped,
        failed,
        nextCursor,
        results,
        counts: { created, updated, skipped, errors: failed },
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
        error: error?.message ?? "Unexpected error",
      },
      { status: 500 }
    );
  }
}
