import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  buildGooglePhotoMediaUrl,
  buildGoogleStreetViewImageUrl,
  extractGooglePhotoResourceName,
  extractGoogleStreetViewLocation,
  isWikimediaSpecialFilePathUrl,
} from "@/lib/hero-image";
import { isHeroDebugPoiName } from "@/lib/hero-debug";

export const runtime = "nodejs";

const DEFAULT_PLACEHOLDER = "/hero-placeholder.jpg";
const GOOGLE_PHOTO_MAX_WIDTH = 1600;
const SUPABASE_BUCKET = "place-images";

function parsePlaceId(req: NextRequest): number {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const placesIdx = parts.lastIndexOf("places");
  const idStr = placesIdx >= 0 ? parts[placesIdx + 1] : "";
  return Number(idStr);
}

function isHeroProxyPath(input: string | null | undefined): boolean {
  return /^\/api\/places\/\d+\/hero(?:\?.*)?$/.test(String(input ?? "").trim());
}

function isHttpUrl(input: string | null | undefined): boolean {
  try {
    const value = String(input ?? "").trim();
    if (!value) return false;
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function cacheControl(maxAgeSeconds: number): string {
  return `public, max-age=${Math.max(60, maxAgeSeconds)}, s-maxage=${Math.max(300, maxAgeSeconds)}, stale-while-revalidate=86400`;
}

function encodeStoragePath(path: string): string {
  return path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildSupabasePublicImageUrl(path: string | null | undefined): string | null {
  const normalizedPath = String(path ?? "").trim().replace(/^\/+/, "");
  if (!normalizedPath) return null;
  const baseUrl = String(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/$/, "");
  if (!baseUrl) return null;
  return `${baseUrl}/storage/v1/object/public/${SUPABASE_BUCKET}/${encodeStoragePath(normalizedPath)}`;
}

function getDebugFlag(req: NextRequest): boolean {
  const value = req.nextUrl.searchParams.get("debug");
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true";
}

async function streamGooglePhoto(photoResourceName: string, apiKey: string): Promise<Response | null> {
  const url = new URL(buildGooglePhotoMediaUrl(photoResourceName, GOOGLE_PHOTO_MAX_WIDTH));
  url.searchParams.set("key", apiKey);
  const googleUrl = url.toString();
  const upstream = await fetch(googleUrl, {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      Accept: "image/*,*/*;q=0.8",
    },
    cache: "no-store",
    redirect: "follow",
  });

  if (!upstream.ok || !upstream.body) {
    return null;
  }

  const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) {
    return null;
  }

  const headers = new Headers();
  headers.set("Content-Type", contentType.split(";")[0]?.trim() || "image/jpeg");
  headers.set("Cache-Control", cacheControl(3600 * 24 * 7));

  return new Response(upstream.body, { status: 200, headers });
}

async function streamGoogleStreetView(
  lat: number,
  lng: number,
  apiKey: string
): Promise<Response | null> {
  const streetViewUrl = buildGoogleStreetViewImageUrl(lat, lng, apiKey, {
    width: 1600,
    height: 900,
    fov: 90,
    pitch: 0,
  });
  const upstream = await fetch(streetViewUrl, {
    method: "GET",
    headers: {
      Accept: "image/*,*/*;q=0.8",
    },
    cache: "no-store",
    redirect: "follow",
  });

  if (!upstream.ok || !upstream.body) {
    return null;
  }

  const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) {
    return null;
  }

  const headers = new Headers();
  headers.set("Content-Type", contentType.split(";")[0]?.trim() || "image/jpeg");
  headers.set("Cache-Control", cacheControl(3600 * 24 * 7));

  return new Response(upstream.body, { status: 200, headers });
}

async function streamRemoteImage(url: string): Promise<Response | null> {
  const upstream = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "image/*,*/*;q=0.8",
      "User-Agent": "camping-portal/hero-proxy",
    },
    cache: "no-store",
    redirect: "follow",
  });

  if (!upstream.ok || !upstream.body) return null;

  const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("image/")) return null;

  const arrayBuffer = await upstream.arrayBuffer();
  const body = Buffer.from(arrayBuffer);
  if (!body.length) return null;

  const headers = new Headers();
  headers.set("Content-Type", contentType.split(";")[0]?.trim() || "image/jpeg");
  headers.set("Cache-Control", cacheControl(3600 * 24 * 7));
  headers.set("Content-Length", String(body.length));

  return new Response(body, { status: 200, headers });
}

async function streamStoredImage(filename: string, apiKey: string): Promise<Response | null> {
  const trimmed = String(filename ?? "").trim();
  if (!trimmed) return null;

  const googlePhotoResource = extractGooglePhotoResourceName(trimmed);
  if (googlePhotoResource && apiKey) {
    return streamGooglePhoto(googlePhotoResource, apiKey);
  }

  const googleStreetViewLocation = extractGoogleStreetViewLocation(trimmed);
  if (googleStreetViewLocation && apiKey) {
    return streamGoogleStreetView(googleStreetViewLocation.lat, googleStreetViewLocation.lng, apiKey);
  }

  if (isWikimediaSpecialFilePathUrl(trimmed) || isHttpUrl(trimmed)) {
    return streamRemoteImage(trimmed);
  }

  const publicUrl = buildSupabasePublicImageUrl(trimmed);
  if (!publicUrl) return null;
  return streamRemoteImage(publicUrl);
}


function appendDecisionHeaders(res: Response | NextResponse, meta: { placeId: number; source: string; targeted: boolean; usedPlaceholder: boolean; placeUpdatedAt?: Date | null }): Response | NextResponse {
  res.headers.set("X-Hero-Place-Id", String(meta.placeId));
  res.headers.set("X-Hero-Source", meta.source);
  res.headers.set("X-Hero-Targeted-Debug", meta.targeted ? "1" : "0");
  res.headers.set("X-Hero-Used-Placeholder", meta.usedPlaceholder ? "1" : "0");
  if (meta.placeUpdatedAt) {
    res.headers.set("X-Hero-Place-Updated-At", new Date(meta.placeUpdatedAt).toISOString());
  }
  return res;
}

function redirectTo(req: NextRequest, value: string, cacheSeconds: number): NextResponse {
  const target = value.startsWith("/") ? new URL(value, req.nextUrl.origin) : new URL(value);
  const response = NextResponse.redirect(target, 307);
  response.headers.set("Cache-Control", cacheControl(cacheSeconds));
  return response;
}

export async function GET(req: NextRequest) {
  const placeId = parsePlaceId(req);
  if (!Number.isFinite(placeId)) {
    return NextResponse.json({ error: "Invalid place id" }, { status: 400 });
  }

  const place = await prisma.place.findUnique({
    where: { id: placeId },
    select: {
      id: true,
      name: true,
      heroImageUrl: true,
      updatedAt: true,
      thumbnailImage: {
        select: {
          id: true,
          filename: true,
        },
      },
      images: {
        select: {
          id: true,
          filename: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      },
    },
  });

  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const heroImageUrl = String(place.heroImageUrl ?? "").trim();
  const storedFallbackImageCandidates = [
    ...(place.thumbnailImage?.filename ? [String(place.thumbnailImage.filename).trim()] : []),
    ...((place.images ?? []).map((image: { filename?: string | null }) => String(image?.filename ?? "").trim()).filter(Boolean)),
  ].filter((value, index, all) => all.indexOf(value) === index && value !== heroImageUrl);
  const targetedDebugPoi = isHeroDebugPoiName(place.name);
  const googlePhotoResource = extractGooglePhotoResourceName(heroImageUrl);
  const googleStreetViewLocation = extractGoogleStreetViewLocation(heroImageUrl);
  const googleApiKey = String(process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  const debug = getDebugFlag(req);

  if (debug) {
    const checks: { target: string; ok: boolean; status?: number; contentType?: string | null; error?: string }[] = [];

    const probe = async (target: string) => {
      try {
        const r = await fetch(target, {
          method: "GET",
          headers: {
            Accept: "image/*,*/*;q=0.8",
            "User-Agent": "camping-portal/hero-proxy-diagnose",
          },
          cache: "no-store",
          redirect: "follow",
        });
        const type = r.headers.get("content-type");
        checks.push({
          target,
          ok: r.ok && String(type ?? "").toLowerCase().startsWith("image/"),
          status: r.status,
          contentType: type,
        });
      } catch (err: any) {
        checks.push({ target, ok: false, error: err?.message ?? "fetch failed" });
      }
    };

    if (googlePhotoResource && googleApiKey) {
      await probe(buildGooglePhotoMediaUrl(googlePhotoResource, GOOGLE_PHOTO_MAX_WIDTH));
    }
    if (googleStreetViewLocation && googleApiKey) {
      await probe(buildGoogleStreetViewImageUrl(googleStreetViewLocation.lat, googleStreetViewLocation.lng, googleApiKey));
    }
    if (heroImageUrl && isHttpUrl(heroImageUrl)) {
      await probe(heroImageUrl);
    }

    return NextResponse.json({
      placeId,
      placeName: place.name,
      targetedDebugPoi,
      placeUpdatedAt: place.updatedAt ? new Date(place.updatedAt).toISOString() : null,
      heroImageUrl: heroImageUrl || null,
      googlePhotoResource,
      googleStreetViewLocation,
      hasGoogleApiKey: Boolean(googleApiKey),
      placeholder: String(process.env.HERO_IMAGE_PLACEHOLDER_URL ?? "").trim() || DEFAULT_PLACEHOLDER,
      cacheRequestHeaders: {
        "if-none-match": req.headers.get("if-none-match"),
        "if-modified-since": req.headers.get("if-modified-since"),
        "cache-control": req.headers.get("cache-control"),
      },
      checks,
    });
  }

  if (googlePhotoResource && googleApiKey) {
    try {
      const response = await streamGooglePhoto(googlePhotoResource, googleApiKey);
      if (response) return appendDecisionHeaders(response, { placeId, source: "google-photo", targeted: targetedDebugPoi, usedPlaceholder: false, placeUpdatedAt: place.updatedAt });
    } catch {
      // keep existing fallback behavior
    }
  }

  if (googleStreetViewLocation && googleApiKey) {
    try {
      const response = await streamGoogleStreetView(googleStreetViewLocation.lat, googleStreetViewLocation.lng, googleApiKey);
      if (response) return appendDecisionHeaders(response, { placeId, source: "google-streetview", targeted: targetedDebugPoi, usedPlaceholder: false, placeUpdatedAt: place.updatedAt });
    } catch {
      // keep existing fallback behavior
    }
  }

  if (heroImageUrl && isHeroProxyPath(heroImageUrl)) {
    const placeholder = String(process.env.HERO_IMAGE_PLACEHOLDER_URL ?? "").trim() || DEFAULT_PLACEHOLDER;
    if (placeholder.startsWith("/")) return appendDecisionHeaders(redirectTo(req, placeholder, 3600 * 24), { placeId, source: "placeholder-self-proxy-guard", targeted: targetedDebugPoi, usedPlaceholder: true, placeUpdatedAt: place.updatedAt });
    if (isHttpUrl(placeholder)) return appendDecisionHeaders(redirectTo(req, placeholder, 3600 * 24), { placeId, source: "placeholder-self-proxy-guard", targeted: targetedDebugPoi, usedPlaceholder: true, placeUpdatedAt: place.updatedAt });
  }

  if (heroImageUrl) {
    if (heroImageUrl.startsWith("/")) return appendDecisionHeaders(redirectTo(req, heroImageUrl, 3600 * 24), { placeId, source: "local-path", targeted: targetedDebugPoi, usedPlaceholder: false, placeUpdatedAt: place.updatedAt });

    if (isWikimediaSpecialFilePathUrl(heroImageUrl) || isHttpUrl(heroImageUrl)) {
      try {
        const response = await streamRemoteImage(heroImageUrl);
        if (response) return appendDecisionHeaders(response, { placeId, source: "remote-http", targeted: targetedDebugPoi, usedPlaceholder: false, placeUpdatedAt: place.updatedAt });
      } catch {
        // keep existing fallback behavior
      }
    }

    try {
      const response = await streamStoredImage(heroImageUrl, googleApiKey);
      if (response) {
        return appendDecisionHeaders(response, {
          placeId,
          source: "hero-storage-path",
          targeted: targetedDebugPoi,
          usedPlaceholder: false,
          placeUpdatedAt: place.updatedAt,
        });
      }
    } catch {
      // keep existing fallback behavior
    }
  }

  for (const fallbackImage of storedFallbackImageCandidates) {
    try {
      const response = await streamStoredImage(fallbackImage, googleApiKey);
      if (response) {
        return appendDecisionHeaders(response, {
          placeId,
          source: fallbackImage === String(place.thumbnailImage?.filename ?? "").trim() ? "thumbnail-image" : "gallery-image",
          targeted: targetedDebugPoi,
          usedPlaceholder: false,
          placeUpdatedAt: place.updatedAt,
        });
      }
    } catch {
      // keep trying other stored images before placeholder
    }
  }

  const placeholder = String(process.env.HERO_IMAGE_PLACEHOLDER_URL ?? "").trim() || DEFAULT_PLACEHOLDER;
  if (placeholder.startsWith("/")) return appendDecisionHeaders(redirectTo(req, placeholder, 3600 * 24), { placeId, source: "placeholder", targeted: targetedDebugPoi, usedPlaceholder: true, placeUpdatedAt: place.updatedAt });
  if (isHttpUrl(placeholder)) return appendDecisionHeaders(redirectTo(req, placeholder, 3600 * 24), { placeId, source: "placeholder", targeted: targetedDebugPoi, usedPlaceholder: true, placeUpdatedAt: place.updatedAt });

  return appendDecisionHeaders(redirectTo(req, DEFAULT_PLACEHOLDER, 3600 * 24), { placeId, source: "placeholder", targeted: targetedDebugPoi, usedPlaceholder: true, placeUpdatedAt: place.updatedAt });
}
