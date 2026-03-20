import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FailureRow = {
  id: number;
  name: string;
  descriptionOk: boolean;
  descriptionLength: number;
  heroOk: boolean;
  heroStatus: number | null;
  heroLocation: string | null;
  heroContentType: string | null;
  heroUsedPlaceholder: string | null;
  thumbnailImageId: number | null;
  heroImageUrl: string | null;
};

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

async function verifyHero(origin: string, placeId: number) {
  const first = await fetch(`${origin}/api/places/${placeId}/hero`, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
  });

  const status = first.status;
  const location = clean(first.headers.get("location")) || null;
  const contentType = clean(first.headers.get("content-type")) || null;
  const usedPlaceholder = clean(first.headers.get("x-hero-used-placeholder")) || null;

  if (usedPlaceholder === "1") {
    return { ok: false, status, location, contentType, usedPlaceholder };
  }

  if (status >= 300 && status < 400) {
    if (!location || /hero-placeholder/i.test(location)) {
      return { ok: false, status, location, contentType, usedPlaceholder };
    }

    const next = await fetch(location, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "camping-portal-admin-quality-report/1.0",
      },
    }).catch(() => null);

    const nextType = clean(next?.headers.get("content-type")) || null;
    return {
      ok: Boolean(next?.ok) && nextType != null && nextType.toLowerCase().startsWith("image/"),
      status,
      location,
      contentType: nextType,
      usedPlaceholder,
    };
  }

  return {
    ok: first.ok && contentType != null && contentType.toLowerCase().startsWith("image/"),
    status,
    location,
    contentType,
    usedPlaceholder,
  };
}

export async function GET(req: NextRequest) {
  try {
    const origin = req.nextUrl.origin;
    const places = await prisma.place.findMany({
      where: { type: "SEHENSWUERDIGKEIT" },
      select: {
        id: true,
        name: true,
        sightDescription: true,
        heroImageUrl: true,
        thumbnailImageId: true,
      },
      orderBy: { id: "asc" },
    });

    const failures: FailureRow[] = [];

    for (const place of places) {
      const description = clean(place.sightDescription);
      const descriptionLength = description.length;
      const descriptionOk = descriptionLength >= 48;
      const hero = await verifyHero(origin, place.id);

      if (!descriptionOk || !hero.ok) {
        failures.push({
          id: place.id,
          name: place.name,
          descriptionOk,
          descriptionLength,
          heroOk: hero.ok,
          heroStatus: hero.status,
          heroLocation: hero.location,
          heroContentType: hero.contentType,
          heroUsedPlaceholder: hero.usedPlaceholder,
          thumbnailImageId: place.thumbnailImageId ?? null,
          heroImageUrl: clean(place.heroImageUrl) || null,
        });
      }
    }

    const missingDescription = failures.filter((item) => !item.descriptionOk).length;
    const brokenHero = failures.filter((item) => !item.heroOk).length;

    return NextResponse.json({
      ok: true,
      checkedAt: new Date().toISOString(),
      total: places.length,
      passed: places.length - failures.length,
      failed: failures.length,
      counts: {
        missingDescription,
        brokenHero,
      },
      failures,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}
