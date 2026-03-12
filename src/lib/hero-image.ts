const GOOGLE_PLACES_HOST = "places.googleapis.com";
const GOOGLE_PHOTO_RESOURCE_PATTERN = /^(places\/[\w-]+\/photos\/[\w-]+)$/;
const WIKIMEDIA_SPECIAL_FILEPATH_HOST = "commons.wikimedia.org";
const GOOGLE_STREET_VIEW_PATTERN = /^google-streetview:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/i;

function safeUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function normalizePhotoResourceName(raw: string): string | null {
  const trimmed = String(raw ?? "").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  if (!trimmed) return null;
  if (!GOOGLE_PHOTO_RESOURCE_PATTERN.test(trimmed)) return null;
  return trimmed;
}

export function isGooglePlacesPhotoUrl(input: string | null | undefined): boolean {
  const raw = String(input ?? "").trim();
  if (!raw) return false;

  const parsed = safeUrl(raw);
  if (!parsed) return false;

  return parsed.hostname.toLowerCase() === GOOGLE_PLACES_HOST && parsed.pathname.includes("/media");
}

export function isGooglePhotoReference(input: string | null | undefined): boolean {
  return extractGooglePhotoResourceName(input) !== null;
}

export function extractGooglePhotoResourceName(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  if (GOOGLE_PHOTO_RESOURCE_PATTERN.test(raw)) {
    return normalizePhotoResourceName(raw);
  }

  const parsed = safeUrl(raw);
  if (!parsed) return null;
  if (parsed.hostname.toLowerCase() !== GOOGLE_PLACES_HOST) return null;

  const withoutPrefix = parsed.pathname.replace(/^\/v1\//, "").replace(/\/media$/, "");
  return normalizePhotoResourceName(withoutPrefix);
}

export function buildGooglePhotoMediaUrl(photoResourceName: string, maxWidthPx: number): string {
  const normalized = normalizePhotoResourceName(photoResourceName);
  if (!normalized) {
    throw new Error("Invalid Google photo resource name");
  }

  const base = `https://${GOOGLE_PLACES_HOST}/v1/${normalized}/media`;
  const url = new URL(base);
  const width = Number.isFinite(maxWidthPx) ? Math.max(128, Math.floor(maxWidthPx)) : 1600;
  url.searchParams.set("maxWidthPx", String(width));
  return url.toString();
}

export function buildPlaceHeroProxyPath(placeId: number | string | null | undefined): string | null {
  const idNum = Number(placeId);
  if (!Number.isFinite(idNum) || idNum <= 0) return null;
  return `/api/places/${Math.trunc(idNum)}/hero`;
}

export function buildGoogleStreetViewReference(lat: number, lng: number): string {
  return `google-streetview:${lat},${lng}`;
}

export function extractGoogleStreetViewLocation(
  input: string | null | undefined
): { lat: number; lng: number } | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  const match = raw.match(GOOGLE_STREET_VIEW_PATTERN);
  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
}

export function isGoogleStreetViewReference(input: string | null | undefined): boolean {
  return extractGoogleStreetViewLocation(input) !== null;
}

export function buildGoogleStreetViewImageUrl(
  lat: number,
  lng: number,
  apiKey: string,
  opts?: { width?: number; height?: number; fov?: number; pitch?: number }
): string {
  const url = new URL("https://maps.googleapis.com/maps/api/streetview");
  url.searchParams.set("location", `${lat},${lng}`);
  url.searchParams.set("size", `${Math.max(640, Math.floor(opts?.width ?? 1600))}x${Math.max(360, Math.floor(opts?.height ?? 900))}`);
  url.searchParams.set("source", "outdoor");
  url.searchParams.set("fov", String(Math.max(30, Math.min(120, Math.floor(opts?.fov ?? 90)))));
  url.searchParams.set("pitch", String(Math.max(-30, Math.min(30, Math.floor(opts?.pitch ?? 0)))));
  url.searchParams.set("key", apiKey);
  return url.toString();
}

export function isWikimediaSpecialFilePathUrl(input: string | null | undefined): boolean {
  const parsed = safeUrl(String(input ?? "").trim());
  if (!parsed) return false;
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  if (parsed.hostname.toLowerCase() !== WIKIMEDIA_SPECIAL_FILEPATH_HOST) return false;
  return parsed.pathname.toLowerCase().startsWith("/wiki/special:filepath/");
}

export function normalizePlaceHeroImageUrlForPublic(
  placeId: number | string | null | undefined,
  heroImageUrl: string | null | undefined
): string | null {
  const raw = String(heroImageUrl ?? "").trim();
  if (!raw) return null;

  if (isGooglePhotoReference(raw)) {
    const proxyPath = buildPlaceHeroProxyPath(placeId);
    if (proxyPath) return proxyPath;
  }

  if (isGoogleStreetViewReference(raw)) {
    const proxyPath = buildPlaceHeroProxyPath(placeId);
    if (proxyPath) return proxyPath;
  }

  if (isWikimediaSpecialFilePathUrl(raw)) {
    const proxyPath = buildPlaceHeroProxyPath(placeId);
    if (proxyPath) return proxyPath;
  }

  return raw;
}
