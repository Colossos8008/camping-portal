import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HeroAction = "created" | "updated" | "skipped" | "error" | "would-create" | "would-update";
type HeroSource = "google" | "wikimedia";
type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

type HeroResult = {
  placeId: string;
  placeName: string;
  action: HeroAction;
  chosenUrl?: string;
  source?: HeroSource;
  reason?: string;
};

type PlaceRecord = {
  id: number;
  name: string;
  type: PlaceType;
  lat: number;
  lng: number;
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
};

type GooglePhoto = {
  photoReference: string;
  width?: number;
  height?: number;
  htmlAttributions?: string[];
};

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const DEFAULT_RADIUS_METERS = 200;
const MAX_RADIUS_METERS = 5000;
const FETCH_TIMEOUT_MS = 15000;
const CONCURRENCY = 3;
const PHOTO_MAX_WIDTH = 1600;
const ALL_TYPES: PlaceType[] = ["CAMPINGPLATZ", "STELLPLATZ", "HVO_TANKSTELLE", "SEHENSWUERDIGKEIT"];
const BAD_HINTS = ["logo", "icon", "map", "flag", "coat", "emblem"];

function parseBody(value: unknown): {
  limit: number;
  force: boolean;
  dryRun: boolean;
  provider: HeroSource;
  radiusMeters: number;
  types?: PlaceType[];
} {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const limitValue = typeof raw.limit === "number" ? Math.floor(raw.limit) : DEFAULT_LIMIT;
  const radiusValue = typeof raw.radiusMeters === "number" ? Math.floor(raw.radiusMeters) : DEFAULT_RADIUS_METERS;
  const provider = raw.provider === "wikimedia" ? "wikimedia" : "google";
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
    radiusMeters: Math.min(MAX_RADIUS_METERS, Math.max(50, Number.isFinite(radiusValue) ? radiusValue : DEFAULT_RADIUS_METERS)),
    types: types && types.length > 0 ? Array.from(new Set(types)) : undefined,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
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
  if (ratio >= 1.2 && ratio <= 2.2) return 6;
  if (ratio > 1 && ratio < 2.6) return 2;
  if (ratio < 0.8) return -6;
  return -1;
}

async function runWithConcurrency<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
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

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, () => next()));
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
  url.searchParams.set("srlimit", "5");
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
  url.searchParams.set("imlimit", "50");
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
      pages?: Record<string, { imageinfo?: Array<{ url?: string; width?: number; height?: number }>; missing?: boolean }>;
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

function scoreWikimedia(c: WikimediaCandidate): number {
  let score = 0;
  if ((c.width ?? 0) >= 1200) score += 4;
  score += scoreLandscape(c.width, c.height);
  if (hasBadHints(c.title)) score -= 10;
  return score;
}

async function findHeroFromWikimedia(placeName: string): Promise<{ candidate: WikimediaCandidate | null; reason?: string }> {
  const pageId = await findPageIdBySearch(placeName);
  if (!pageId) return { candidate: null, reason: "No Wikipedia page found" };

  const candidates: WikimediaCandidate[] = [];
  const representative = await fetchRepresentativeFileTitle(pageId);
  if (representative && !hasBadHints(representative)) {
    const resolved = await resolveCommonsImage(representative);
    if (resolved) candidates.push(resolved);
  }

  if (candidates.length === 0) {
    const titles = Array.from(new Set(await fetchPageImageTitles(pageId)));
    for (const title of titles) {
      if (hasBadHints(title)) continue;
      const resolved = await resolveCommonsImage(title);
      if (resolved) candidates.push(resolved);
      if (candidates.length >= 10) break;
    }
  }

  if (candidates.length === 0) return { candidate: null, reason: "No suitable Wikimedia Commons image" };
  return { candidate: candidates.sort((a, b) => scoreWikimedia(b) - scoreWikimedia(a))[0] };
}

async function findGoogleMatch(place: PlaceRecord, radiusMeters: number, apiKey: string): Promise<{ match: GoogleCandidate | null; reason?: string }> {
  type NearbyResponse = {
    results?: Array<{
      place_id?: string;
      name?: string;
      geometry?: { location?: { lat?: number; lng?: number } };
    }>;
    status?: string;
    error_message?: string;
  };

  const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
  url.searchParams.set("location", `${place.lat},${place.lng}`);
  url.searchParams.set("radius", String(radiusMeters));
  url.searchParams.set("keyword", place.name);
  url.searchParams.set("key", apiKey);

  const data = await fetchJson<NearbyResponse>(url.toString());
  if (data.status && data.status !== "OK" && data.status !== "ZERO_RESULTS") {
    throw new Error(`Google Nearby Search failed: ${data.status}${data.error_message ? ` (${data.error_message})` : ""}`);
  }

  const candidates: GoogleCandidate[] = (data.results ?? [])
    .map((r) => {
      const lat = r.geometry?.location?.lat;
      const lng = r.geometry?.location?.lng;
      const d = typeof lat === "number" && typeof lng === "number" ? distanceMeters(place.lat, place.lng, lat, lng) : undefined;
      return {
        placeId: r.place_id ?? "",
        name: r.name ?? "",
        lat,
        lng,
        distanceMeters: d,
      };
    })
    .filter((r) => r.placeId && r.name);

  if (candidates.length === 0) {
    return { match: null, reason: "no nearby results" };
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

  if (!best) return { match: null, reason: "no candidate" };
  const bestNameSim = similarity(place.name, best.name);
  const far = typeof best.distanceMeters === "number" && best.distanceMeters > radiusMeters * 1.5;
  if (bestNameSim < 0.45 || far) {
    return { match: null, reason: "no confident place match" };
  }

  return { match: best };
}

async function findGooglePhotos(placeId: string, apiKey: string): Promise<GooglePhoto[]> {
  type DetailsResponse = {
    result?: {
      photos?: Array<{
        photo_reference?: string;
        width?: number;
        height?: number;
        html_attributions?: string[];
      }>;
    };
    status?: string;
    error_message?: string;
  };

  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "photos,name");
  url.searchParams.set("key", apiKey);

  const data = await fetchJson<DetailsResponse>(url.toString());
  if (data.status && data.status !== "OK") {
    throw new Error(`Google Place Details failed: ${data.status}${data.error_message ? ` (${data.error_message})` : ""}`);
  }

  return (data.result?.photos ?? [])
    .map((p) => ({
      photoReference: p.photo_reference ?? "",
      width: p.width,
      height: p.height,
      htmlAttributions: p.html_attributions,
    }))
    .filter((p) => p.photoReference);
}

function scoreGooglePhoto(photo: GooglePhoto): number {
  let score = 0;
  if ((photo.width ?? 0) >= 1200) score += 5;
  score += scoreLandscape(photo.width, photo.height);
  const attrib = (photo.htmlAttributions ?? []).join(" ");
  if (hasBadHints(attrib)) score -= 6;
  return score;
}

function buildGooglePhotoUrl(photoReference: string, apiKey: string): string {
  const url = new URL("https://maps.googleapis.com/maps/api/place/photo");
  url.searchParams.set("maxwidth", String(PHOTO_MAX_WIDTH));
  url.searchParams.set("photo_reference", photoReference);
  url.searchParams.set("key", apiKey);
  return url.toString();
}

async function findHeroFromGoogle(place: PlaceRecord, radiusMeters: number, apiKey: string): Promise<{ chosenUrl: string | null; reason?: string }> {
  const match = await findGoogleMatch(place, radiusMeters, apiKey);
  if (!match.match) return { chosenUrl: null, reason: match.reason ?? "no confident place match" };

  const photos = await findGooglePhotos(match.match.placeId, apiKey);
  if (photos.length === 0) {
    return { chosenUrl: null, reason: "no photos returned by place details" };
  }

  const best = [...photos].sort((a, b) => scoreGooglePhoto(b) - scoreGooglePhoto(a))[0];
  if (scoreGooglePhoto(best) < 0) {
    return { chosenUrl: null, reason: "no suitable hero photo" };
  }

  return { chosenUrl: buildGooglePhotoUrl(best.photoReference, apiKey) };
}

export async function POST(req: Request) {
  try {
    const body = parseBody(await req.json().catch(() => ({})));

    if (body.provider === "google" && !process.env.GOOGLE_MAPS_API_KEY) {
      return NextResponse.json(
        {
          counts: { created: 0, updated: 0, skipped: 0, errors: 0 },
          results: [],
          error: "Missing GOOGLE_MAPS_API_KEY env variable",
        },
        { status: 400 }
      );
    }

    const where = body.types?.length ? { type: { in: body.types } } : undefined;

    const places = (await prisma.place.findMany({
      where,
      take: body.limit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        type: true,
        lat: true,
        lng: true,
        heroImageUrl: true,
      },
    })) as PlaceRecord[];

    const counts = { created: 0, updated: 0, skipped: 0, errors: 0 };
    const googleKey = process.env.GOOGLE_MAPS_API_KEY ?? "";

    const results = await runWithConcurrency(places, async (place): Promise<HeroResult> => {
      if (place.heroImageUrl && !body.force) {
        counts.skipped += 1;
        return {
          placeId: String(place.id),
          placeName: place.name,
          action: "skipped",
          source: body.provider,
          reason: "heroImageUrl already set",
          chosenUrl: place.heroImageUrl,
        };
      }

      try {
        let chosenUrl: string | null = null;
        let reason: string | undefined;

        if (body.provider === "google") {
          const found = await findHeroFromGoogle(place, body.radiusMeters, googleKey);
          chosenUrl = found.chosenUrl;
          reason = found.reason;
        } else {
          const found = await findHeroFromWikimedia(place.name);
          chosenUrl = found.candidate?.url ?? null;
          reason = found.reason;
        }

        if (!chosenUrl) {
          counts.skipped += 1;
          return {
            placeId: String(place.id),
            placeName: place.name,
            action: "skipped",
            source: body.provider,
            reason: reason ?? "No image found",
          };
        }

        const isUpdate = Boolean(place.heroImageUrl);

        if (body.dryRun) {
          if (isUpdate) {
            counts.updated += 1;
            return {
              placeId: String(place.id),
              placeName: place.name,
              action: "would-update",
              source: body.provider,
              chosenUrl,
              reason: "Dry run",
            };
          }

          counts.created += 1;
          return {
            placeId: String(place.id),
            placeName: place.name,
            action: "would-create",
            source: body.provider,
            chosenUrl,
            reason: "Dry run",
          };
        }

        await prisma.place.update({ where: { id: place.id }, data: { heroImageUrl: chosenUrl } });

        if (isUpdate) {
          counts.updated += 1;
          return {
            placeId: String(place.id),
            placeName: place.name,
            action: "updated",
            chosenUrl,
            source: body.provider,
          };
        }

        counts.created += 1;
        return {
          placeId: String(place.id),
          placeName: place.name,
          action: "created",
          chosenUrl,
          source: body.provider,
        };
      } catch (error: any) {
        counts.errors += 1;
        return {
          placeId: String(place.id),
          placeName: place.name,
          action: "error",
          source: body.provider,
          reason: error?.message ?? "Unexpected error",
        };
      }
    });

    return NextResponse.json({ counts, results }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      {
        counts: { created: 0, updated: 0, skipped: 0, errors: 1 },
        results: [],
        error: error?.message ?? "Unexpected error",
      },
      { status: 500 }
    );
  }
}
