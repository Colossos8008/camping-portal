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
const GENERIC_TOKENS = new Set([
  "the",
  "and",
  "der",
  "die",
  "das",
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "of",
  "am",
  "an",
  "im",
  "in",
  "bei",
  "zum",
  "zur",
  "camping",
  "campingplatz",
  "campground",
  "rv",
  "park",
  "aire",
  "wohnmobil",
  "stellplatz",
  "sehenswurdigkeit",
  "museum",
  "kirche",
  "church",
  "fortress",
  "castle",
  "schloss",
  "burg",
  "altstadt",
  "stadt",
]);
const EXCLUDED_CAMPING_HINTS = [
  "hotel",
  "cottage",
  "bedroom",
  "spa",
  "apartment",
  "ferienwohnung",
  "guesthouse",
  "villa",
  "lodge",
  "resort",
  "hostel",
  "maison",
  "gite",
  "chambre",
];
const EXCLUDED_SIGHTSEEING_HINTS = ["selfie", "portrait", "logo", "plan", "map", "interior", "inside"];

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

function tokenizeMeaningful(value: string): string[] {
  return normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !GENERIC_TOKENS.has(token));
}

function tokenOverlap(a: string, b: string): number {
  const aa = new Set(tokenizeMeaningful(a));
  const bb = new Set(tokenizeMeaningful(b));
  if (!aa.size || !bb.size) return 0;
  let overlap = 0;
  for (const token of aa) {
    if (bb.has(token)) overlap += 1;
  }
  return overlap / Math.max(aa.size, bb.size);
}

function containsExcludedHint(text: string, hints: string[]): boolean {
  const lower = normalize(text);
  return hints.some((hint) => lower.includes(normalize(hint)));
}

function hasSpecificNameSignal(placeName: string, candidateName: string): boolean {
  const placeTokens = tokenizeMeaningful(placeName);
  const candidateTokens = new Set(tokenizeMeaningful(candidateName));
  if (!placeTokens.length || !candidateTokens.size) return false;
  return placeTokens.some((token) => candidateTokens.has(token));
}

function looksCampingLike(name: string): boolean {
  const normalized = normalize(name);
  return (
    normalized.includes("camp") ||
    normalized.includes("rv") ||
    normalized.includes("stellplatz") ||
    normalized.includes("wohnmobil") ||
    normalized.includes("caravan")
  );
}

function dedupeKey(candidate: HeroCandidateRecord): string {
  const direct = String(candidate.thumbUrl ?? candidate.url ?? "").trim();
  if (!direct) return `${candidate.source}:${candidate.reason}`;
  return `${candidate.source}:${direct}`;
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
    const overlap = tokenOverlap(place.name, candidateName);
    const campingLike = looksCampingLike(candidateName);
    const hasSpecificSignal = hasSpecificNameSignal(place.name, candidateName);
    const isCamping = place.type === "CAMPINGPLATZ" || place.type === "STELLPLATZ";

    if (isCamping) {
      if (containsExcludedHint(place.name, EXCLUDED_CAMPING_HINTS)) continue;
      if (!campingLike && overlap < 0.45 && nameSimilarity < 0.55) continue;
      if (!hasSpecificSignal && distance !== null && distance > 400) continue;
      if (distance !== null && distance > 1500 && overlap < 0.6 && nameSimilarity < 0.7) continue;
      if (distance !== null && distance > 3000) continue;
    } else {
      if (containsExcludedHint(candidateName, EXCLUDED_SIGHTSEEING_HINTS)) continue;
      if (!hasSpecificSignal && overlap < 0.35 && nameSimilarity < 0.45) continue;
      if (distance !== null && distance > 2000 && overlap < 0.5 && nameSimilarity < 0.6) continue;
    }

    let score = Math.round(nameSimilarity * 34) + Math.round(overlap * 28);
    if (hasSpecificSignal) score += 8;
    if (campingLike && isCamping) score += 6;
    if (distance !== null) {
      if (distance <= 120) score += 14;
      else if (distance <= 350) score += 10;
      else if (distance <= 800) score += 5;
      else if (distance <= 1500) score += 1;
      else score -= 10;
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
  return wiki
    .filter((candidate) => {
      if (place.type === "SEHENSWUERDIGKEIT") {
        if (containsExcludedHint(candidate.title, EXCLUDED_SIGHTSEEING_HINTS)) return false;
      }
      const overlap = tokenOverlap(place.name, candidate.title);
      const nameScore = similarity(place.name, candidate.title);
      return overlap >= 0.35 || nameScore >= 0.45 || hasSpecificNameSignal(place.name, candidate.title);
    })
    .map((candidate) => {
      const overlap = tokenOverlap(place.name, candidate.title);
      const nameScore = similarity(place.name, candidate.title);
      let base = 8 + Math.round(nameScore * 18) + Math.round(overlap * 16) + scoreLandscape(candidate.width, candidate.height);
      if (hasSpecificNameSignal(place.name, candidate.title)) base += 5;
      if (candidate.width && candidate.height && candidate.width >= 1000 && candidate.height >= 700) base += 3;
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

  const deduped = Array.from(new Map(all.map((candidate) => [dedupeKey(candidate), candidate])).values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

  return deduped;
}
