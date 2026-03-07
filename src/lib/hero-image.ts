const GOOGLE_PLACES_HOST = "places.googleapis.com";
const GOOGLE_PHOTO_RESOURCE_PATTERN = /^(places\/[\w-]+\/photos\/[\w-]+)$/;
const WIKIMEDIA_SPECIAL_FILEPATH_HOST = "commons.wikimedia.org";

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

  if (isWikimediaSpecialFilePathUrl(raw)) {
    const proxyPath = buildPlaceHeroProxyPath(placeId);
    if (proxyPath) return proxyPath;
  }

  return raw;
}
