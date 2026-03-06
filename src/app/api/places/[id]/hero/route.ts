import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildGooglePhotoMediaUrl, extractGooglePhotoResourceName } from "@/lib/hero-image";

export const runtime = "nodejs";

const DEFAULT_PLACEHOLDER = "/hero-placeholder.jpg";
const GOOGLE_PHOTO_MAX_WIDTH = 1600;

function parsePlaceId(req: NextRequest): number {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const placesIdx = parts.lastIndexOf("places");
  const idStr = placesIdx >= 0 ? parts[placesIdx + 1] : "";
  return Number(idStr);
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

async function streamGooglePhoto(photoResourceName: string, apiKey: string): Promise<Response | null> {
  const googleUrl = buildGooglePhotoMediaUrl(photoResourceName, GOOGLE_PHOTO_MAX_WIDTH);
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

  const headers = new Headers();
  const contentType = upstream.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
  headers.set("Content-Type", contentType);
  headers.set("Cache-Control", cacheControl(3600 * 24 * 7));

  return new Response(upstream.body, { status: 200, headers });
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
    select: { id: true, heroImageUrl: true },
  });

  if (!place) {
    return NextResponse.json({ error: "Place not found" }, { status: 404 });
  }

  const heroImageUrl = String(place.heroImageUrl ?? "").trim();
  const googlePhotoResource = extractGooglePhotoResourceName(heroImageUrl);
  const googleApiKey = String(process.env.GOOGLE_MAPS_API_KEY ?? "").trim();

  if (googlePhotoResource && googleApiKey) {
    try {
      const response = await streamGooglePhoto(googlePhotoResource, googleApiKey);
      if (response) return response;
    } catch {
      // keep existing fallback behavior
    }
  }

  if (heroImageUrl) {
    if (heroImageUrl.startsWith("/")) return redirectTo(req, heroImageUrl, 3600 * 24);
    if (isHttpUrl(heroImageUrl)) return redirectTo(req, heroImageUrl, 3600 * 24);
  }

  const placeholder = String(process.env.HERO_IMAGE_PLACEHOLDER_URL ?? "").trim() || DEFAULT_PLACEHOLDER;
  if (placeholder.startsWith("/")) return redirectTo(req, placeholder, 3600 * 24);
  if (isHttpUrl(placeholder)) return redirectTo(req, placeholder, 3600 * 24);

  return redirectTo(req, DEFAULT_PLACEHOLDER, 3600 * 24);
}
