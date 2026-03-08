import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { extractGooglePhotoResourceName, isWikimediaSpecialFilePathUrl, normalizePlaceHeroImageUrlForPublic } from "@/lib/hero-image";
import { getHeroDebugPoiNames } from "@/lib/hero-debug";

export const runtime = "nodejs";

type ProbeResult = {
  target: string;
  ok: boolean;
  status?: number;
  contentType?: string | null;
  error?: string;
};

async function probe(target: string): Promise<ProbeResult> {
  try {
    const res = await fetch(target, {
      method: "GET",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "camping-portal/hero-pipeline-debug",
      },
      cache: "no-store",
      redirect: "follow",
    });

    const contentType = res.headers.get("content-type");
    return {
      target,
      ok: res.ok && String(contentType ?? "").toLowerCase().startsWith("image/"),
      status: res.status,
      contentType,
    };
  } catch (err: any) {
    return {
      target,
      ok: false,
      error: err?.message ?? "fetch failed",
    };
  }
}

export async function GET() {
  const names = getHeroDebugPoiNames();
  const places = await prisma.place.findMany({
    where: { name: { in: names } },
    select: { id: true, name: true, heroImageUrl: true, updatedAt: true, type: true, lat: true, lng: true },
    orderBy: { name: "asc" },
  });

  const rows = await Promise.all(
    places.map(async (place: any) => {
      const rawHeroImageUrl = String(place.heroImageUrl ?? "").trim() || null;
      const publicHeroImageUrl = normalizePlaceHeroImageUrlForPublic(place.id, place.heroImageUrl);
      const googlePhotoResource = extractGooglePhotoResourceName(rawHeroImageUrl);
      const isWikimediaSpecialFilePath = isWikimediaSpecialFilePathUrl(rawHeroImageUrl);

      const checks: ProbeResult[] = [];
      if (rawHeroImageUrl) {
        checks.push(await probe(rawHeroImageUrl));
      }

      return {
        id: place.id,
        name: place.name,
        type: place.type,
        lat: place.lat,
        lng: place.lng,
        updatedAt: place.updatedAt,
        rawHeroImageUrl,
        publicHeroImageUrl,
        googlePhotoResource,
        isWikimediaSpecialFilePath,
        checks,
      };
    })
  );

  return NextResponse.json({ count: rows.length, targets: names, places: rows });
}
