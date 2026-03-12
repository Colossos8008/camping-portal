import { buildGooglePhotoMediaUrl } from "@/lib/hero-image";

export type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

export type HeroCandidateInput = {
  id: number;
  name: string;
  type: PlaceType;
  lat: number | null;
  lng: number | null;
  heroImageUrl?: string | null;
};

export type HeroCandidateRecord = {
  id?: number;
  source: "google" | "wikimedia" | "website";
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
  websiteUri?: string;
};

type WebsiteImageCandidate = {
  url: string;
  width?: number;
  height?: number;
  reason: string;
};

const FETCH_TIMEOUT_MS = 15000;
const MAX_WIKIMEDIA_CANDIDATES = 16;
const GOOGLE_PHOTO_MAX_WIDTH = 1600;
const GOOGLE_THUMB_WIDTH = 480;
const MIN_TARGET_RESULTS = 6;
const BAD_HINTS = ["logo", "icon", "map", "flag", "coat", "emblem", "text", "sign", "selfie", "portrait"];
const EXCLUDED_CAMPING_HINTS = ["hotel", "cottage", "bedroom", "spa", "apartment", "ferienwohnung", "guesthouse", "villa", "lodge", "resort", "hostel"];
const EXCLUDED_SIGHTSEEING_HINTS = ["selfie", "portrait", "logo", "plan", "map"];
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

function normalize(value: string): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeMeaningful(value: string): string[] {
  return normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !GENERIC_TOKENS.has(token));
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

function hasSpecificNameSignal(placeName: string, candidateName: string): boolean {
  const placeTokens = tokenizeMeaningful(placeName);
  const candidateTokens = new Set(tokenizeMeaningful(candidateName));
  return placeTokens.some((token) => candidateTokens.has(token));
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (x: number) => (x * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const q = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
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

function containsHint(text: string, hints: string[]): boolean {
  const lower = normalize(text);
  return hints.some((hint) => lower.includes(normalize(hint)));
}

function hasBadHints(text: string): boolean {
  return containsHint(text, BAD_HINTS);
}

function looksCampingLike(name: string): boolean {
  const normalized = normalize(name);
  return normalized.includes("camp") || normalized.includes("rv") || normalized.includes("stellplatz") || normalized.includes("wohnmobil") || normalized.includes("caravan");
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string): T[] {
  const map = new Map<string, T>();
  for (const item of items) {
    const key = getKey(item);
    if (!map.has(key)) map.set(key, item);
  }
  return Array.from(map.values());
}

function dedupeKey(candidate: HeroCandidateRecord): string {
  const direct = String(candidate.thumbUrl ?? candidate.url ?? "").trim();
  return `${candidate.source}:${direct}`;
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

async function fetchText(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (compatible; camping-portal/1.0; +https://camping-portal.vercel.app)",
      },
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function resolveMaybeRelativeUrl(baseUrl: string, raw: string): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return null;
  }
}

function extractMetaContent(html: string, names: string[]): string | null {
  for (const name of names) {
    const quoted = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regexes = [
      new RegExp(`<meta[^>]+(?:property|name)=["']${quoted}["'][^>]+content=["']([^"']+)["']`, "i"),
      new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${quoted}["']`, "i"),
    ];
    for (const regex of regexes) {
      const match = html.match(regex);
      if (match?.[1]) return match[1];
    }
  }
  return null;
}

async function fetchWebsiteImageCandidate(websiteUrl: string, placeName: string): Promise<WebsiteImageCandidate | null> {
  try {
    const html = await fetchText(websiteUrl, 12000);
    const image =
      extractMetaContent(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) ??
      extractMetaContent(html, ["og:image:url"]);
    const resolved = resolveMaybeRelativeUrl(websiteUrl, String(image ?? ""));
    if (!resolved || hasBadHints(resolved)) return null;
    return {
      url: resolved,
      reason: `Website image for '${placeName}'`,
    };
  } catch {
    return null;
  }
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
  url.searchParams.set("srlimit", String(Math.min(40, Math.max(5, maxCandidates))));
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

async function findWikimediaCandidates(placeName: string): Promise<WikimediaCandidate[]> {
  const candidates: WikimediaCandidate[] = [];
  const searchQueries = uniqueBy(
    [
      placeName,
      placeName.replace(/\b(campingplatz|camping|campground|stellplatz)\b/gi, "").trim(),
      `${placeName} exterior`,
      `${placeName} panorama`,
    ].filter(Boolean),
    (value) => normalize(value)
  );

  const pageId = await findPageIdBySearch(placeName);
  if (pageId) {
    const representative = await fetchRepresentativeFileTitle(pageId);
    if (representative && !hasBadHints(representative)) {
      const resolved = await resolveCommonsImage(representative);
      if (resolved) candidates.push(resolved);
    }

    for (const title of await fetchPageImageTitles(pageId)) {
      if (candidates.length >= MAX_WIKIMEDIA_CANDIDATES) break;
      if (hasBadHints(title)) continue;
      const resolved = await resolveCommonsImage(title);
      if (resolved) candidates.push(resolved);
    }
  }

  for (const query of searchQueries) {
    if (candidates.length >= MAX_WIKIMEDIA_CANDIDATES) break;
    const searchTitles = await findCommonsFileTitlesBySearch(query, MAX_WIKIMEDIA_CANDIDATES * 2);
    for (const title of searchTitles) {
      if (candidates.length >= MAX_WIKIMEDIA_CANDIDATES) break;
      if (hasBadHints(title)) continue;
      const resolved = await resolveCommonsImage(title);
      if (resolved) candidates.push(resolved);
    }
  }

  return uniqueBy(candidates, (candidate) => candidate.url);
}

async function runGoogleSearchNearby(place: HeroCandidateInput, googleKey: string): Promise<GooglePlace[]> {
  if (!googleKey || typeof place.lat !== "number" || typeof place.lng !== "number") return [];
  const body: Record<string, unknown> = {
    maxResultCount: 12,
    locationRestriction: {
      circle: {
        center: { latitude: place.lat, longitude: place.lng },
        radius: place.type === "SEHENSWUERDIGKEIT" ? 2000 : 5000,
      },
    },
  };
  if (place.type === "SEHENSWUERDIGKEIT") {
    body.includedTypes = ["tourist_attraction", "museum", "church", "park", "historical_landmark"];
  } else {
    body.includedTypes = ["campground", "rv_park", "lodging"];
  }

  const data = await fetchJsonRequest<{ places?: GooglePlace[] }>(
    "https://places.googleapis.com/v1/places:searchNearby",
    "POST",
    {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.photos,places.websiteUri",
    },
    body
  );
  return Array.isArray(data.places) ? data.places : [];
}

async function runGoogleSearchText(place: HeroCandidateInput, googleKey: string): Promise<GooglePlace[]> {
  if (!googleKey) return [];
  const query =
    place.type === "SEHENSWUERDIGKEIT"
      ? `${place.name}`
      : `${place.name} ${place.type === "STELLPLATZ" ? "stellplatz wohnmobil" : "camping campground"}`;
  const body: Record<string, unknown> = {
    textQuery: query,
    maxResultCount: 8,
    languageCode: "de",
  };
  if (typeof place.lat === "number" && typeof place.lng === "number") {
    body.locationBias = {
      circle: {
        center: { latitude: place.lat, longitude: place.lng },
        radius: place.type === "SEHENSWUERDIGKEIT" ? 8000 : 12000,
      },
    };
  }

  const data = await fetchJsonRequest<{ places?: GooglePlace[] }>(
    "https://places.googleapis.com/v1/places:searchText",
    "POST",
    {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": googleKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.location,places.photos,places.websiteUri",
    },
    body
  );
  return Array.isArray(data.places) ? data.places : [];
}

function mergeGooglePlaces(groups: GooglePlace[][]): GooglePlace[] {
  const merged = new Map<string, GooglePlace>();
  for (const group of groups) {
    for (const item of group) {
      const key = String(item.id ?? normalize(item.displayName?.text ?? ""));
      if (!key) continue;
      const prev = merged.get(key);
      if (!prev) {
        merged.set(key, item);
        continue;
      }
      merged.set(key, {
        ...prev,
        ...item,
        photos: uniqueBy([...(prev.photos ?? []), ...(item.photos ?? [])], (photo) => String(photo.name ?? "")),
        websiteUri: prev.websiteUri ?? item.websiteUri,
      });
    }
  }
  return Array.from(merged.values());
}

function scoreGooglePlaceMatch(place: HeroCandidateInput, candidateName: string, distance: number | null): number {
  const overlap = tokenOverlap(place.name, candidateName);
  const nameScore = similarity(place.name, candidateName);
  const hasSignal = hasSpecificNameSignal(place.name, candidateName);
  const isCamping = place.type === "CAMPINGPLATZ" || place.type === "STELLPLATZ";
  const campingLike = looksCampingLike(candidateName);

  let score = Math.round(nameScore * 34) + Math.round(overlap * 34);
  if (hasSignal) score += 12;
  if (isCamping && campingLike) score += 12;
  if (distance !== null) {
    if (distance <= 150) score += 18;
    else if (distance <= 500) score += 12;
    else if (distance <= 1200) score += 6;
    else if (distance <= 3000) score += 1;
    else if (distance <= 6000) score -= 6;
    else score -= 14;
  }
  return score;
}

function shouldKeepGooglePlace(place: HeroCandidateInput, candidateName: string, distance: number | null, relaxed: boolean): boolean {
  const overlap = tokenOverlap(place.name, candidateName);
  const nameScore = similarity(place.name, candidateName);
  const hasSignal = hasSpecificNameSignal(place.name, candidateName);
  const isCamping = place.type === "CAMPINGPLATZ" || place.type === "STELLPLATZ";

  if (isCamping && containsHint(candidateName, EXCLUDED_CAMPING_HINTS) && !relaxed) return false;
  if (!isCamping && containsHint(candidateName, EXCLUDED_SIGHTSEEING_HINTS) && !relaxed) return false;

  if (relaxed) {
    if (distance !== null && distance > 25000 && nameScore < 0.2 && overlap < 0.2) return false;
    return hasSignal || nameScore >= 0.18 || overlap >= 0.18 || (distance !== null && distance < 1200);
  }

  if (isCamping) {
    if (!looksCampingLike(candidateName) && !hasSignal && nameScore < 0.45 && overlap < 0.4) return false;
    if (distance !== null && distance > 6000 && nameScore < 0.55 && overlap < 0.5) return false;
    return hasSignal || looksCampingLike(candidateName) || distance === null || distance <= 2500;
  }

  if (!hasSignal && nameScore < 0.35 && overlap < 0.28) return false;
  if (distance !== null && distance > 8000 && nameScore < 0.45 && overlap < 0.35) return false;
  return true;
}

async function findGoogleCandidates(place: HeroCandidateInput, googleKey: string, relaxed = false): Promise<HeroCandidateRecord[]> {
  if (!googleKey) return [];
  const [nearby, text] = await Promise.allSettled([runGoogleSearchNearby(place, googleKey), runGoogleSearchText(place, googleKey)]);
  const merged = mergeGooglePlaces([
    nearby.status === "fulfilled" ? nearby.value : [],
    text.status === "fulfilled" ? text.value : [],
  ]);

  const basePlaces = merged
    .map((item) => {
      const candidateName = String(item.displayName?.text ?? "").trim();
      const distance =
        typeof item.location?.latitude === "number" &&
        typeof item.location?.longitude === "number" &&
        typeof place.lat === "number" &&
        typeof place.lng === "number"
          ? distanceMeters(place.lat, place.lng, item.location.latitude, item.location.longitude)
          : null;
      return { item, candidateName, distance, score: scoreGooglePlaceMatch(place, candidateName, distance) };
    })
    .filter(({ candidateName, distance }) => candidateName && shouldKeepGooglePlace(place, candidateName, distance, relaxed))
    .sort((a, b) => b.score - a.score)
    .slice(0, relaxed ? 8 : 5);

  const out: HeroCandidateRecord[] = [];
  for (const { item, candidateName, distance, score } of basePlaces) {
    const photos = uniqueBy(Array.isArray(item.photos) ? item.photos : [], (photo) => String(photo.name ?? ""));
    const photosPerPlace = relaxed ? 3 : 4;
    for (const [index, photo] of photos.slice(0, photosPerPlace).entries()) {
      const photoName = String(photo?.name ?? "").trim();
      if (!photoName) continue;
      out.push({
        source: "google",
        url: buildGooglePhotoMediaUrl(photoName, GOOGLE_PHOTO_MAX_WIDTH),
        thumbUrl: buildGooglePhotoMediaUrl(photoName, GOOGLE_THUMB_WIDTH),
        width: photo.widthPx,
        height: photo.heightPx,
        score: score + scoreLandscape(photo.widthPx, photo.heightPx) - index * 4,
        reason: `Google Places '${candidateName}'${distance !== null ? ` (${Math.round(distance)}m)` : ""} photo ${index + 1}`,
        rank: 0,
      });
    }

    if (item.websiteUri) {
      const websiteImage = await fetchWebsiteImageCandidate(item.websiteUri, candidateName);
      if (websiteImage) {
        out.push({
          source: "website",
          url: websiteImage.url,
          thumbUrl: websiteImage.url,
          width: websiteImage.width,
          height: websiteImage.height,
          score: score + 6 + scoreLandscape(websiteImage.width, websiteImage.height),
          reason: `${websiteImage.reason} via ${candidateName}`,
          rank: 0,
        });
      }
    }
  }

  return uniqueBy(out, (candidate) => dedupeKey(candidate));
}

function shouldKeepWikiCandidate(place: HeroCandidateInput, candidate: WikimediaCandidate, relaxed: boolean): boolean {
  if (!relaxed && hasBadHints(candidate.title)) return false;
  const overlap = tokenOverlap(place.name, candidate.title);
  const nameScore = similarity(place.name, candidate.title);
  const hasSignal = hasSpecificNameSignal(place.name, candidate.title);
  if (place.type === "SEHENSWUERDIGKEIT" && containsHint(candidate.title, EXCLUDED_SIGHTSEEING_HINTS) && !relaxed) return false;
  if (place.type !== "SEHENSWUERDIGKEIT" && containsHint(candidate.title, EXCLUDED_CAMPING_HINTS) && !relaxed) return false;
  return relaxed ? overlap >= 0.15 || nameScore >= 0.18 || hasSignal : overlap >= 0.3 || nameScore >= 0.35 || hasSignal;
}

async function findWikimediaHeroCandidates(place: HeroCandidateInput, relaxed = false): Promise<HeroCandidateRecord[]> {
  const wiki = await findWikimediaCandidates(place.name);
  return wiki
    .filter((candidate) => shouldKeepWikiCandidate(place, candidate, relaxed))
    .map((candidate) => {
      const overlap = tokenOverlap(place.name, candidate.title);
      const nameScore = similarity(place.name, candidate.title);
      let base = 10 + Math.round(nameScore * 18) + Math.round(overlap * 20) + scoreLandscape(candidate.width, candidate.height);
      if (hasSpecificNameSignal(place.name, candidate.title)) base += 6;
      if (candidate.width && candidate.height && candidate.width >= 1000 && candidate.height >= 700) base += 3;
      if (relaxed) base -= 2;
      return {
        source: "wikimedia" as const,
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

function injectExistingHero(place: HeroCandidateInput, candidates: HeroCandidateRecord[]): HeroCandidateRecord[] {
  const current = String(place.heroImageUrl ?? "").trim();
  if (!current) return candidates;
  if (candidates.some((candidate) => String(candidate.url ?? "").trim() === current)) return candidates;
  return [
    ...candidates,
    {
      source: "website",
      url: current,
      thumbUrl: current,
      score: 6,
      reason: "Aktuelles Hero-Bild als Fallback",
      rank: 0,
    },
  ];
}

export async function discoverHeroCandidates(
  place: HeroCandidateInput,
  options?: { googleKey?: string; limit?: number }
): Promise<HeroCandidateRecord[]> {
  if (place.type === "HVO_TANKSTELLE") return [];

  const limit = Math.max(1, Math.min(16, Number(options?.limit ?? 10)));
  const googleKey = String(options?.googleKey ?? "").trim();

  const [strictGoogle, strictWiki] = await Promise.allSettled([
    findGoogleCandidates(place, googleKey, false),
    findWikimediaHeroCandidates(place, false),
  ]);

  let all = [
    ...(strictGoogle.status === "fulfilled" ? strictGoogle.value : []),
    ...(strictWiki.status === "fulfilled" ? strictWiki.value : []),
  ];

  if (all.length < Math.min(MIN_TARGET_RESULTS, limit)) {
    const [relaxedGoogle, relaxedWiki] = await Promise.allSettled([
      findGoogleCandidates(place, googleKey, true),
      findWikimediaHeroCandidates(place, true),
    ]);
    all = [
      ...all,
      ...(relaxedGoogle.status === "fulfilled" ? relaxedGoogle.value : []),
      ...(relaxedWiki.status === "fulfilled" ? relaxedWiki.value : []),
    ];
  }

  all = injectExistingHero(place, all);

  return uniqueBy(all, (candidate) => dedupeKey(candidate))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
