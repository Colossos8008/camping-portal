import sharp from "sharp";
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
  pageUrl?: string;
};

type SearchResultPage = {
  url: string;
  title: string;
};

type CandidateSignature = {
  candidate: HeroCandidateRecord;
  signature: string | null;
};

type ImageInspection = {
  signature: string | null;
  width?: number;
  height?: number;
  format?: string;
  hasAlpha?: boolean;
};

const FETCH_TIMEOUT_MS = 15000;
const MAX_WIKIMEDIA_CANDIDATES = 16;
const GOOGLE_PHOTO_MAX_WIDTH = 1600;
const GOOGLE_THUMB_WIDTH = 480;
const MIN_TARGET_RESULTS = 6;
const MAX_SEARCH_RESULT_PAGES = 8;
const BAD_HINTS = [
  "logo",
  "icon",
  "map",
  "flag",
  "coat",
  "emblem",
  "text",
  "sign",
  "selfie",
  "portrait",
  "badge",
  "classification",
  "adac",
  "award",
  "partner",
  "sponsor",
  "shop",
  "stars",
  "stern",
  "button",
  "favicon",
  "open graph",
  "opengraph",
  "share image",
  "social share",
];
const EXCLUDED_CAMPING_HINTS = ["hotel", "cottage", "bedroom", "spa", "apartment", "ferienwohnung", "guesthouse", "villa", "lodge", "resort", "hostel"];
const EXCLUDED_SIGHTSEEING_HINTS = ["selfie", "portrait", "logo", "plan", "map"];
const GALLERY_LINK_HINTS = ["galerie", "gallery", "bilder", "photos", "fotos", "camping", "camp", "accommodation", "hebergement"];
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

function isHttpUrl(input: string): boolean {
  try {
    const parsed = new URL(String(input ?? "").trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isLikelyImageUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return /\.(jpg|jpeg|png|webp|avif)(\?|$)/i.test(lower) || lower.includes("/image") || lower.includes("/media");
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

async function fetchBuffer(url: string, timeoutMs = FETCH_TIMEOUT_MS): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; camping-portal/1.0; +https://camping-portal.vercel.app)",
      },
      signal: controller.signal,
      cache: "no-store",
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
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

function parseHtmlPageLinks(html: string, baseUrl: string): string[] {
  const matches = new Set<string>();
  const linkRegex = /<a[^>]+href=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(linkRegex)) {
    const resolved = resolveMaybeRelativeUrl(baseUrl, String(match[1] ?? ""));
    if (!resolved || !isHttpUrl(resolved)) continue;
    matches.add(resolved);
    if (matches.size >= 60) break;
  }
  return Array.from(matches);
}

function shouldKeepSearchResultUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const full = `${host}${parsed.pathname}`.toLowerCase();
    if (host.includes("duckduckgo.com")) return false;
    if (host.includes("google.") || host.includes("bing.com")) return false;
    if (host.includes("facebook.com") || host.includes("instagram.com") || host.includes("youtube.com")) return false;
    if (host.includes("tripadvisor.") || host.includes("booking.com") || host.includes("airbnb.")) return false;
    if (host.includes("wikipedia.org") || host.includes("wikimedia.org")) return false;
    if (full.includes("/logo") || full.includes("/icon")) return false;
    return true;
  } catch {
    return false;
  }
}

function shouldKeepInternalGalleryLink(baseUrl: string, url: string): boolean {
  try {
    const base = new URL(baseUrl);
    const parsed = new URL(url);
    if (parsed.hostname !== base.hostname) return false;
    const normalizedPath = normalize(parsed.pathname);
    if (!normalizedPath || normalizedPath === normalize(base.pathname)) return false;
    return GALLERY_LINK_HINTS.some((hint) => normalizedPath.includes(normalize(hint)));
  } catch {
    return false;
  }
}

function decodeDuckDuckGoTarget(raw: string): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return decodeURIComponent(uddg);
    if (parsed.hostname !== "duckduckgo.com") return parsed.toString();
  } catch {
    // fall through
  }
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parseHtmlImageCandidates(html: string, websiteUrl: string): string[] {
  const matches = new Set<string>();
  const metaImage =
    extractMetaContent(html, ["og:image:secure_url", "og:image", "twitter:image", "twitter:image:src"]) ??
    extractMetaContent(html, ["og:image:url"]);

  const metaResolved = resolveMaybeRelativeUrl(websiteUrl, String(metaImage ?? ""));
  if (metaResolved) matches.add(metaResolved);

  const imageRegex = /<(img|source)[^>]+(?:src|data-src|data-lazy-src|srcset)=["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(imageRegex)) {
    const raw = String(match[2] ?? "").trim();
    if (!raw) continue;
    const first = raw.split(",")[0]?.trim().split(/\s+/)[0]?.trim() ?? "";
    const resolved = resolveMaybeRelativeUrl(websiteUrl, first);
    if (!resolved) continue;
    const lower = resolved.toLowerCase();
    if (!isLikelyImageUrl(lower)) continue;
    if (hasBadHints(lower)) continue;
    matches.add(resolved);
    if (matches.size >= 12) break;
  }

  const styleRegex = /url\((['"]?)(https?:\/\/[^'")]+|\/[^'")]+)\1\)/gi;
  for (const match of html.matchAll(styleRegex)) {
    const resolved = resolveMaybeRelativeUrl(websiteUrl, String(match[2] ?? ""));
    if (!resolved) continue;
    const lower = resolved.toLowerCase();
    if (!isLikelyImageUrl(lower)) continue;
    if (hasBadHints(lower)) continue;
    matches.add(resolved);
    if (matches.size >= 16) break;
  }

  const jsonImageRegex = /"image"\s*:\s*(\[[^\]]+\]|"[^"]+")/gi;
  for (const match of html.matchAll(jsonImageRegex)) {
    const raw = String(match[1] ?? "");
    const urls = Array.from(raw.matchAll(/https?:\/\/[^"'\\\]]+/gi)).map((item) => item[0]);
    for (const url of urls) {
      const resolved = resolveMaybeRelativeUrl(websiteUrl, url);
      if (!resolved) continue;
      const lower = resolved.toLowerCase();
      if (!isLikelyImageUrl(lower)) continue;
      if (hasBadHints(lower)) continue;
      matches.add(resolved);
      if (matches.size >= 16) break;
    }
    if (matches.size >= 16) break;
  }

  return Array.from(matches.values());
}

function mapWebsiteImages(urls: string[], placeName: string, reasonPrefix: string, pageUrl?: string): WebsiteImageCandidate[] {
  return urls.slice(0, 12).map((url, index) => ({
    url,
    pageUrl,
    reason: index === 0 ? `${reasonPrefix} image for '${placeName}'` : `${reasonPrefix} gallery image ${index + 1} for '${placeName}'`,
  }));
}

async function fetchWebsiteImageCandidates(
  websiteUrl: string,
  placeName: string,
  options?: { reasonPrefix?: string; includeLinkedPages?: boolean }
): Promise<WebsiteImageCandidate[]> {
  try {
    const html = await fetchText(websiteUrl, 12000);
    const reasonPrefix = String(options?.reasonPrefix ?? "Website").trim() || "Website";
    const includeLinkedPages = options?.includeLinkedPages !== false;
    const directImages = mapWebsiteImages(parseHtmlImageCandidates(html, websiteUrl), placeName, reasonPrefix, websiteUrl);

    if (!includeLinkedPages) {
      return directImages;
    }

    const internalPages = parseHtmlPageLinks(html, websiteUrl)
      .filter((url) => shouldKeepInternalGalleryLink(websiteUrl, url))
      .slice(0, 4);

    if (!internalPages.length) {
      return directImages;
    }

    const linkedImageGroups = await Promise.allSettled(
      internalPages.map(async (pageUrl) => {
        const pageHtml = await fetchText(pageUrl, 10000);
        return mapWebsiteImages(parseHtmlImageCandidates(pageHtml, pageUrl), placeName, reasonPrefix, pageUrl);
      })
    );

    return uniqueBy(
      [
        ...directImages,
        ...linkedImageGroups.flatMap((group) => (group.status === "fulfilled" ? group.value : [])),
      ],
      (candidate) => candidate.url
    );
  } catch {
    return [];
  }
}

async function discoverPagesFromDuckDuckGo(place: HeroCandidateInput): Promise<SearchResultPage[]> {
  const queries = uniqueBy(
    [
      place.name,
      `${place.name} ${place.type === "SEHENSWUERDIGKEIT" ? "official photos" : "official camping photos"}`,
      `${place.name} site officiel photos`,
      `${place.name} galerie`,
    ],
    (value) => normalize(value)
  );

  const discovered: SearchResultPage[] = [];

  for (const query of queries) {
    if (discovered.length >= MAX_SEARCH_RESULT_PAGES) break;
    try {
      const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const html = await fetchText(searchUrl, 12000);
      const resultRegex = /<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      for (const match of html.matchAll(resultRegex)) {
        if (discovered.length >= MAX_SEARCH_RESULT_PAGES) break;
        const target = decodeDuckDuckGoTarget(String(match[1] ?? ""));
        if (!target || !shouldKeepSearchResultUrl(target)) continue;
        const title = String(match[2] ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (!title) continue;
        discovered.push({ url: target, title });
      }
    } catch {
      // skip failed query
    }
  }

  return uniqueBy(discovered, (entry) => entry.url).slice(0, MAX_SEARCH_RESULT_PAGES);
}

async function findDiscoveredWebsiteCandidates(place: HeroCandidateInput): Promise<HeroCandidateRecord[]> {
  const pages = await discoverPagesFromDuckDuckGo(place);
  if (!pages.length) return [];

  const pageGroups = await Promise.allSettled(
    pages.map(async (page, pageIndex) => {
      const images = await fetchWebsiteImageCandidates(page.url, place.name, {
        reasonPrefix: "Web search",
        includeLinkedPages: false,
      });
      return images.slice(0, 6).map((image, imageIndex) => {
        const pageOverlap = tokenOverlap(place.name, `${page.title} ${page.url}`);
        const pageSimilarity = similarity(place.name, `${page.title} ${page.url}`);
        const hasSignal = hasSpecificNameSignal(place.name, `${page.title} ${page.url}`);
        let score = 24 + Math.round(pageOverlap * 30) + Math.round(pageSimilarity * 24) - pageIndex * 4 - imageIndex * 2;
        if (hasSignal) score += 8;
        if ((place.type === "CAMPINGPLATZ" || place.type === "STELLPLATZ") && looksCampingLike(`${page.title} ${page.url}`)) {
          score += 6;
        }
        return {
          source: "website" as const,
          url: image.url,
          thumbUrl: image.url,
          width: image.width,
          height: image.height,
          score,
          reason: `${image.reason} via ${new URL(page.url).hostname}`,
          rank: 0,
        };
      });
    })
  );

  return uniqueBy(
    pageGroups.flatMap((group) => (group.status === "fulfilled" ? group.value : [])),
    (candidate) => dedupeKey(candidate)
  );
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
    if (isCamping) {
      if (!looksCampingLike(candidateName)) return false;
      if (!hasSignal && distance !== null && distance > 1500) return false;
    }
    return hasSignal || nameScore >= 0.18 || overlap >= 0.18 || (distance !== null && distance < 1200);
  }

  if (isCamping) {
    if (!looksCampingLike(candidateName)) return false;
    if (!hasSignal && distance !== null && distance > 1200) return false;
    if (distance !== null && distance > 6000 && nameScore < 0.55 && overlap < 0.5) return false;
    return hasSignal || (looksCampingLike(candidateName) && (distance === null || distance <= 500));
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
      const websiteImages = await fetchWebsiteImageCandidates(item.websiteUri, candidateName, {
        reasonPrefix: "Official website",
        includeLinkedPages: true,
      });
      for (const [index, websiteImage] of websiteImages.slice(0, relaxed ? 4 : 5).entries()) {
        out.push({
          source: "website",
          url: websiteImage.url,
          thumbUrl: websiteImage.url,
          width: websiteImage.width,
          height: websiteImage.height,
          score: score + 12 + scoreLandscape(websiteImage.width, websiteImage.height) - index * 3,
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
  if ((place.type === "CAMPINGPLATZ" || place.type === "STELLPLATZ") && !looksCampingLike(`${candidate.title} ${candidate.url}`)) {
    return false;
  }
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

function entityKeyFromCandidate(candidate: HeroCandidateRecord): string {
  if (candidate.source === "website") {
    try {
      const parsed = new URL(candidate.url);
      const firstSegment = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
      return `${candidate.source}:${parsed.hostname.toLowerCase()}:${normalize(firstSegment)}`;
    } catch {
      return `${candidate.source}:${normalize(candidate.url)}`;
    }
  }
  const quoted = String(candidate.reason ?? "").match(/'([^']+)'/);
  if (quoted?.[1]) {
    const tokens = tokenizeMeaningful(quoted[1]).sort().join("-");
    return `${candidate.source}:${tokens || normalize(quoted[1])}`;
  }
  try {
    const parsed = new URL(candidate.url);
    return `${candidate.source}:${parsed.hostname.toLowerCase()}`;
  } catch {
    return `${candidate.source}:${normalize(candidate.reason)}`;
  }
}

function entityCap(candidate: HeroCandidateRecord): number {
  if (candidate.source === "google") return 2;
  if (candidate.source === "website") return 4;
  return 2;
}

async function inspectImage(url: string): Promise<ImageInspection> {
  try {
    const buffer = await fetchBuffer(url, 10000);
    const image = sharp(buffer).rotate();
    const metadata = await image.metadata();
    const raw = await image.resize(8, 8, { fit: "fill" }).grayscale().raw().toBuffer();
    if (!raw.length) return { signature: null };
    const avg = raw.reduce((sum, value) => sum + value, 0) / raw.length;
    return {
      signature: Array.from(raw, (value) => (value >= avg ? "1" : "0")).join(""),
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      hasAlpha: metadata.hasAlpha,
    };
  } catch {
    return { signature: null };
  }
}

function signatureDistance(a: string, b: string): number {
  const length = Math.min(a.length, b.length);
  let distance = Math.abs(a.length - b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] !== b[i]) distance += 1;
  }
  return distance;
}

async function dedupeCandidatesVisually(candidates: HeroCandidateRecord[]): Promise<HeroCandidateRecord[]> {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const topForSignature = sorted.slice(0, Math.min(64, sorted.length));
  const inspections = await Promise.all(
    topForSignature.map(async (candidate) => ({
      candidate,
      inspection: await inspectImage(String(candidate.thumbUrl ?? candidate.url ?? "").trim()),
    }))
  );
  const inspectionMap = new Map<string, ImageInspection>(inspections.map((entry) => [dedupeKey(entry.candidate), entry.inspection]));

  const kept: HeroCandidateRecord[] = [];
  const keptSignatures: CandidateSignature[] = [];
  const entityCounts = new Map<string, number>();

  for (const candidate of sorted) {
    const inspection = inspectionMap.get(dedupeKey(candidate));
    const width = inspection?.width ?? candidate.width ?? undefined;
    const height = inspection?.height ?? candidate.height ?? undefined;
    const format = String(inspection?.format ?? "").toLowerCase();
    const hasAlpha = inspection?.hasAlpha === true;
    const combinedText = `${candidate.url} ${candidate.reason}`;

    if (hasBadHints(combinedText)) continue;
    if (width && height && (width < 500 || height < 320)) continue;
    if (width && height && width / Math.max(1, height) < 0.7) continue;
    if (format === "png" && hasAlpha) continue;
    if (!inspection?.signature) continue;

    const entityKey = entityKeyFromCandidate(candidate);
    const currentCount = entityCounts.get(entityKey) ?? 0;
    if (currentCount >= entityCap(candidate)) continue;

    const signature = inspection?.signature ?? null;
    if (
      signature &&
      keptSignatures.some((entry) => entry.signature && signatureDistance(signature, entry.signature) <= 16)
    ) {
      continue;
    }

    kept.push(candidate);
    entityCounts.set(entityKey, currentCount + 1);
    keptSignatures.push({ candidate, signature });
  }

  return kept;
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

  if (all.length < limit) {
    const discoveredPages = await findDiscoveredWebsiteCandidates(place).catch(() => []);
    all = [...all, ...discoveredPages];
  }

  if (all.length < Math.min(MIN_TARGET_RESULTS, limit)) {
    const [relaxedGoogle, relaxedWiki, relaxedDiscovered] = await Promise.allSettled([
      findGoogleCandidates(place, googleKey, true),
      findWikimediaHeroCandidates(place, true),
      findDiscoveredWebsiteCandidates(place),
    ]);
    all = [
      ...all,
      ...(relaxedGoogle.status === "fulfilled" ? relaxedGoogle.value : []),
      ...(relaxedWiki.status === "fulfilled" ? relaxedWiki.value : []),
      ...(relaxedDiscovered.status === "fulfilled" ? relaxedDiscovered.value : []),
    ];
  }

  const visuallyDeduped = await dedupeCandidatesVisually(uniqueBy(all, (candidate) => dedupeKey(candidate)));

  return visuallyDeduped
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((candidate, index) => ({ ...candidate, rank: index + 1 }));
}
