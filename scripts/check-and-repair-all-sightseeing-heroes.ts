import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { prisma } from "../src/lib/prisma.ts";

type PlaceRow = {
  id: number;
  name: string;
  type: "SEHENSWUERDIGKEIT";
  lat: number;
  lng: number;
  heroImageUrl: string | null;
  heroScore: number | null;
  heroReason: string | null;
};

type HealthResult = {
  ok: boolean;
  status: number | null;
  contentType: string | null;
  error: string | null;
  checkedUrl: string | null;
};

type GooglePhoto = {
  name?: string;
  widthPx?: number;
  heightPx?: number;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  photos?: GooglePhoto[];
};

type HeroCandidateRecord = {
  source: "google";
  url: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
  score: number;
  reason: string;
  rank: number;
};

type SummaryRow = {
  id: number;
  name: string;
  previousHeroImageUrl: string | null;
  previousHeroScore: number | null;
  status: "healthy" | "repaired" | "failed-no-candidate" | "failed-update";
  health: HealthResult;
  nextHeroImageUrl?: string | null;
  nextHeroScore?: number | null;
  nextHeroReason?: string | null;
};

const OUT_DIR = path.resolve(process.cwd(), "data/review/sightseeing-hero-health-2026-03-17");
const FETCH_TIMEOUT_MS = 12000;

function normalize(value: string): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3);
}

function tokenOverlap(a: string, b: string): number {
  const aa = new Set(tokenize(a));
  const bb = new Set(tokenize(b));
  if (!aa.size || !bb.size) return 0;
  let overlap = 0;
  for (const token of aa) {
    if (bb.has(token)) overlap += 1;
  }
  return overlap / Math.max(aa.size, bb.size);
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const earthRadiusM = 6371000;
  const toRad = (value: number) => (value * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const q = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadiusM * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q));
}

function buildGooglePhotoMediaUrl(photoName: string, maxWidthPx: number): string {
  const cleaned = String(photoName ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return `https://places.googleapis.com/v1/${cleaned}/media?maxWidthPx=${maxWidthPx}`;
}

function isHttpUrl(input: string | null | undefined): boolean {
  try {
    const parsed = new URL(String(input ?? "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

async function fetchWithTimeout(url: string, headers: Record<string, string> = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      method: "GET",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "camping-portal-all-sightseeing-hero-check/1.0",
        ...headers,
      },
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function checkHeroUrl(url: string | null, googleKey: string): Promise<HealthResult> {
  const raw = String(url ?? "").trim();
  if (!raw) {
    return { ok: false, status: null, contentType: null, error: "missing-hero-url", checkedUrl: null };
  }

  if (!isHttpUrl(raw)) {
    return { ok: false, status: null, contentType: null, error: "non-http-hero-url", checkedUrl: raw };
  }

  const headers: Record<string, string> = {};
  if (raw.includes("places.googleapis.com")) {
    headers["X-Goog-Api-Key"] = googleKey;
  }

  try {
    const response = await fetchWithTimeout(raw, headers);
    const contentType = String(response.headers.get("content-type") ?? "").toLowerCase() || null;
    return {
      ok: response.ok && Boolean(contentType?.startsWith("image/")),
      status: response.status,
      contentType,
      error: response.ok && contentType?.startsWith("image/") ? null : "non-image-or-http-failure",
      checkedUrl: raw,
    };
  } catch (error: any) {
    return {
      ok: false,
      status: null,
      contentType: null,
      error: String(error?.message ?? "fetch-failed"),
      checkedUrl: raw,
    };
  }
}

async function fetchGooglePlaces(query: string, lat: number, lng: number, googleKey: string): Promise<GooglePlace[]> {
  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.photos",
    },
    body: JSON.stringify({
      textQuery: query,
      maxResultCount: 8,
      languageCode: "de",
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 12000,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`google-search-failed-${response.status}`);
  }

  const data = (await response.json()) as { places?: GooglePlace[] };
  return Array.isArray(data.places) ? data.places : [];
}

function buildQueries(placeName: string): string[] {
  return [placeName, `${placeName} Sehenswürdigkeit`, `${placeName} exterior`, `${placeName} panorama`];
}

async function discoverCandidates(place: PlaceRow, googleKey: string): Promise<HeroCandidateRecord[]> {
  const queryResults = await Promise.allSettled(buildQueries(place.name).map((query) => fetchGooglePlaces(query, place.lat, place.lng, googleKey)));
  const merged = queryResults
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .filter((item, index, array) => array.findIndex((entry) => String(entry.id ?? "") === String(item.id ?? "")) === index);

  return merged
    .map((candidatePlace) => {
      const candidateName = String(candidatePlace.displayName?.text ?? "").trim();
      const overlap = tokenOverlap(place.name, candidateName);
      const distance =
        typeof candidatePlace.location?.latitude === "number" && typeof candidatePlace.location?.longitude === "number"
          ? distanceMeters(place.lat, place.lng, candidatePlace.location.latitude, candidatePlace.location.longitude)
          : null;
      return { candidatePlace, candidateName, overlap, distance };
    })
    .filter((entry) => entry.candidateName && entry.overlap >= 0.18)
    .sort((a, b) => {
      const distanceA = a.distance ?? Number.MAX_SAFE_INTEGER;
      const distanceB = b.distance ?? Number.MAX_SAFE_INTEGER;
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      return distanceA - distanceB;
    })
    .flatMap((entry) =>
      (Array.isArray(entry.candidatePlace.photos) ? entry.candidatePlace.photos : []).slice(0, 4).map((photo, index) => {
        const width = Number(photo.widthPx);
        const height = Number(photo.heightPx);
        const scenicBonus = Number.isFinite(width) && Number.isFinite(height) && width > height ? 8 : 0;
        const distanceBonus =
          entry.distance == null ? 0 : entry.distance <= 300 ? 18 : entry.distance <= 1200 ? 10 : entry.distance <= 3000 ? 4 : 0;
        return {
          source: "google" as const,
          url: buildGooglePhotoMediaUrl(String(photo.name ?? ""), 1600),
          thumbUrl: buildGooglePhotoMediaUrl(String(photo.name ?? ""), 480),
          width: Number.isFinite(width) ? width : undefined,
          height: Number.isFinite(height) ? height : undefined,
          score: Math.round(entry.overlap * 100) + scenicBonus + distanceBonus - index * 4,
          reason: `Google Places '${entry.candidateName}' photo ${index + 1}${entry.distance != null ? ` (${Math.round(entry.distance)}m)` : ""}`,
          rank: index + 1,
        };
      })
    )
    .filter((candidate) => candidate.url.includes("/photos/"))
    .sort((a, b) => b.score - a.score)
    .slice(0, 8)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}

function chooseCandidate(candidates: HeroCandidateRecord[]): HeroCandidateRecord | null {
  return [...candidates].sort((a, b) => b.score - a.score)[0] ?? null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const googleKey = String(process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  if (!googleKey) throw new Error("Missing Google Places key");

  const places = (await prisma.place.findMany({
    where: { type: "SEHENSWUERDIGKEIT" },
    select: {
      id: true,
      name: true,
      type: true,
      lat: true,
      lng: true,
      heroImageUrl: true,
      heroScore: true,
      heroReason: true,
    },
    orderBy: { id: "asc" },
  })) as PlaceRow[];

  const summary: SummaryRow[] = [];
  let healthyCount = 0;
  let repairedCount = 0;
  let failedCount = 0;

  for (const place of places) {
    const health = await checkHeroUrl(place.heroImageUrl, googleKey);
    if (health.ok) {
      healthyCount += 1;
      summary.push({
        id: place.id,
        name: place.name,
        previousHeroImageUrl: place.heroImageUrl,
        previousHeroScore: place.heroScore,
        status: "healthy",
        health,
      });
      console.log(`OK      ${place.id}\t${place.name}`);
      continue;
    }

    const candidates = await discoverCandidates(place, googleKey).catch(() => []);
    const chosen = chooseCandidate(candidates);
    if (!chosen) {
      failedCount += 1;
      summary.push({
        id: place.id,
        name: place.name,
        previousHeroImageUrl: place.heroImageUrl,
        previousHeroScore: place.heroScore,
        status: "failed-no-candidate",
        health,
      });
      console.log(`NOFIX   ${place.id}\t${place.name}\t${health.error ?? health.status ?? "unknown"}`);
      continue;
    }

    try {
      await prisma.place.update({
        where: { id: place.id },
        data: {
          heroImageUrl: chosen.url,
          heroScore: chosen.score,
          heroReason: `Auto repair on 2026-03-17: replaced unhealthy hero image with ${chosen.source} candidate. ${chosen.reason}`,
          heroCandidates: {
            deleteMany: {},
            create: candidates.map((candidate, index) => ({
              source: candidate.source,
              url: candidate.url,
              thumbUrl: candidate.thumbUrl ?? null,
              width: candidate.width,
              height: candidate.height,
              score: candidate.score,
              reason: candidate.reason,
              rank: index + 1,
            })),
          },
        },
      });

      repairedCount += 1;
      summary.push({
        id: place.id,
        name: place.name,
        previousHeroImageUrl: place.heroImageUrl,
        previousHeroScore: place.heroScore,
        status: "repaired",
        health,
        nextHeroImageUrl: chosen.url,
        nextHeroScore: chosen.score,
        nextHeroReason: chosen.reason,
      });
      console.log(`FIXED   ${place.id}\t${place.name}\t-> ${chosen.source} ${chosen.score}`);
    } catch (error: any) {
      failedCount += 1;
      summary.push({
        id: place.id,
        name: place.name,
        previousHeroImageUrl: place.heroImageUrl,
        previousHeroScore: place.heroScore,
        status: "failed-update",
        health: {
          ...health,
          error: String(error?.message ?? "update-failed"),
        },
      });
      console.log(`ERROR   ${place.id}\t${place.name}\t${String(error?.message ?? "update-failed")}`);
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    totals: {
      total: places.length,
      healthy: healthyCount,
      repaired: repairedCount,
      failed: failedCount,
    },
    summary,
  };

  fs.writeFileSync(path.join(OUT_DIR, "summary.json"), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`\nSummary: total=${places.length} healthy=${healthyCount} repaired=${repairedCount} failed=${failedCount}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
