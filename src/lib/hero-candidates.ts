import { buildGooglePhotoMediaUrl } from "@/lib/hero-image";

export type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

export type HeroCandidateInput = {
  id: number;
  name: string;
  type: PlaceType;
  lat: number | null;
  lng: number | null;
};

export type HeroCandidateRecord = {
  id?: number;
  source: "google" | "wikimedia";
  url: string;
  thumbUrl?: string;
  width?: number;
  height?: number;
  score: number;
  reason: string;
  rank: number;
};

type WikimediaCandidate = {
  title: string;
  url: string;
  width?: number;
  height?: number;
};

type GooglePhoto = {
  name: string;
  widthPx?: number;
  heightPx?: number;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  photos?: GooglePhoto[];
};

const FETCH_TIMEOUT_MS = 15000;
const MAX_WIKIMEDIA_CANDIDATES = 12;
const GOOGLE_PHOTO_MAX_WIDTH = 1600;
const GOOGLE_THUMB_WIDTH = 480;
const BAD_HINTS = ["logo", "icon", "map", "flag", "coat", "emblem", "text", "sign", "selfie", "portrait"];

function normalize(value: string): string {
  return String(value ?? "")
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
  if (!aa.size || !bb.size) return 0;
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

function scoreLandscape(width?: number, height?: number): number {
  if (!width || !height || height <= 0) return 0;
  const ratio = width / height;
  if (ratio >= 1.15 && ratio <= 2.4) return 8;
  if (ratio > 0.95 && ratio < 2.8) return 3;
  if (ratio < 0.8) return -8;
  return -2;
}

function hasBadHints(text: string): boolean {
  const lower = String(text ?? "").toLowerCase();
  return BAD_HINTS.some((hint) => lower.includes(hint));
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
  type CommonsSearchResponse = { query?: { search?: Array<{ title?: string }> } };
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

async function findWikimediaCandidates(placeName: string): Promise<WikimediaCandidate[]> {
  const candidates: WikimediaCandidate[] = [];
  const pageId = await findPageIdBySearch(placeName);

  if (pageId) {
    const representative = await fetchRepresentativeFileTitle(pageId);
    if (representative && !hasBadHints(representative)) {
      const resolved = await resolveCommonsImage(representative);
      if (resolved) candidates.push(resolved);
    }

    const titles = Array.from(new Set(await fetchPageImageTitles(pageId)));
    for (const title of titles) {
      if (candidates.length >= MAX_WIKIMEDIA_CANDIDATES) break;
      if (hasBadHints(title)) continue;
      const resolved = await resolveCommonsImage(title);
      if (resolved) candidates.push(resolved);
    }
  }

  if (candidates.length < MAX_WIKIMEDIA_CANDIDATES) {
    const searchTitles = await findCommonsFileTitlesBySearch(placeName, MAX_WIKIMEDIA_CANDIDATES * 2);
    for (const title of searchTitles) {
      if (candidates.length >= MAX_WIKIMEDIA_CANDIDATES) break;
      if (hasBadHints(title)) continue;
      const resolved = await resolveCommonsImage(title);
      if (resolved) candidates.push(resolved);
    }
  }

  return Array.from(new Map(candidates.map((candidate) => [candidate.url, candidate])).values());
}

async function findGoogleCandidates(place: HeroCandidateInput, googleKey: string): Promise<HeroCandidateRecord[]> {
  if (!googleKey || typeof place.lat !== "number" || typeof place.lng !== "number") return [];

  const body: Record<string, unknown> = {
    maxResultCount: 10,
    locationRestriction: {
      circle: {
        center: { latitude: place.lat, longitude: place.lng },
        radius: place.type === "SEHENSWUERDIGKEIT" ? 800 : 3000,
      },
    },
  };

  if (place.type === "SEHENSWUERDIGKEIT") {
    body.includedTypes = ["tourist_attraction", "museum", "church", "park", "historical_landmark"];
  } else {
    body.includedTypes = ["campground", "rv_park"];
  }

  const data = await fetchJsonRequest<{ places?: GooglePlace[] }>(
    "https://places.googleapis.com/v1/places:searchNearby",
    "POST",
    {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.photos",
    },
    body
  );

  const out: HeroCandidateRecord[] = [];
  for (const item of data.places ?? []) {
    const candidateName = String(item.displayName?.text ?? "").trim();
    const photos = Array.isArray(item.photos) ? item.photos : [];
    if (!candidateName || photos.length === 0) continue;

    const photo = photos[0];
    const photoName = String(photo?.name ?? "").trim();
    if (!photoName) continue;

    const distance =
      typeof item.location?.latitude === "number" && typeof item.location?.longitude === "number" && typeof place.lat === "number" && typeof place.lng === "number"
        ? distanceMeters(place.lat, place.lng, item.location.latitude, item.location.longitude)
        : null;

    const nameSimilarity = similarity(place.name, candidateName);
    const normalizedCandidate = normalize(candidateName);
    const looksCampingLike =
      normalizedCandidate.includes("camp") ||
      normalizedCandidate.includes("rv") ||
      normalizedCandidate.includes("stellplatz") ||
      normalizedCandidate.includes("wohnmobil") ||
      normalizedCandidate.includes("caravan");

    if ((place.type === "CAMPINGPLATZ" || place.type === "STELLPLATZ") && !looksCampingLike && nameSimilarity < 0.18) {
      continue;
    }
    if ((place.type === "CAMPINGPLATZ" || place.type === "STELLPLATZ") && distance !== null && distance > 5000 && nameSimilarity < 0.3) {
      continue;
    }

    let score = Math.round(nameSimilarity * 40);
    if (distance !== null) {
      if (distance <= 200) score += 12;
      else if (distance <= 800) score += 8;
      else if (distance <= 2500) score += 4;
      else score -= 6;
    }
    score += scoreLandscape(photo.widthPx, photo.heightPx);

    out.push({
      source: "google",
      url: buildGooglePhotoMediaUrl(photoName, GOOGLE_PHOTO_MAX_WIDTH),
      thumbUrl: buildGooglePhotoMediaUrl(photoName, GOOGLE_THUMB_WIDTH),
      width: photo.widthPx,
      height: photo.heightPx,
      score,
      reason: `Google Places '${candidateName}'${distance !== null ? ` (${Math.round(distance)}m)` : ""}`,
      rank: 0,
    });
  }

  return out;
}

async function findWikimediaHeroCandidates(place: HeroCandidateInput): Promise<HeroCandidateRecord[]> {
  const wiki = await findWikimediaCandidates(place.name);
  return wiki.map((candidate) => {
    const base = 8 + Math.round(similarity(place.name, candidate.title) * 18) + scoreLandscape(candidate.width, candidate.height);
    return {
      source: "wikimedia",
      url: candidate.url,
      thumbUrl: candidate.url,
      width: candidate.width,
      height: candidate.height,
      score: base,
      reason: `Wikimedia '${candidate.title}'`,
      rank: 0,
    };
  });
}

export async function discoverHeroCandidates(
  place: HeroCandidateInput,
  options?: { googleKey?: string; limit?: number }
): Promise<HeroCandidateRecord[]> {
  if (place.type === "HVO_TANKSTELLE") return [];

  const limit = Math.max(1, Math.min(12, Number(options?.limit ?? 10)));
  const googleKey = String(options?.googleKey ?? "").trim();

  const [google, wikimedia] = await Promise.allSettled([
    findGoogleCandidates(place, googleKey),
    findWikimediaHeroCandidates(place),
  ]);

  const all = [
    ...(google.status === "fulfilled" ? google.value : []),
    ...(wikimedia.status === "fulfilled" ? wikimedia.value : []),
  ];

  const deduped = Array.from(new Map(all.map((candidate) => [candidate.url, candidate])).values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  return deduped;
}
