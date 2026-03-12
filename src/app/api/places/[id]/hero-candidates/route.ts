import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { discoverHeroCandidates, type HeroCandidateRecord, type PlaceType } from "@/lib/hero-candidates";

export const runtime = "nodejs";

function parsePlaceId(ctx: { params: Promise<{ id: string }> | { id: string } }): Promise<number> {
  return Promise.resolve((ctx as any).params).then((params) => Number((params as any)?.id));
}

function normalizeStoredCandidates(items: any[]): HeroCandidateRecord[] {
  return items.map((item: any, index: number) => ({
    id: typeof item.id === "number" ? item.id : undefined,
    source: item.source === "google" ? "google" : "wikimedia",
    url: String(item.url ?? ""),
    thumbUrl: String(item.thumbUrl ?? "").trim() || undefined,
    width: typeof item.width === "number" ? item.width : undefined,
    height: typeof item.height === "number" ? item.height : undefined,
    score: typeof item.score === "number" ? item.score : 0,
    reason: String(item.reason ?? ""),
    rank: typeof item.rank === "number" ? item.rank : index + 1,
  }));
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const placeId = await parsePlaceId(ctx);
  if (!Number.isFinite(placeId)) return NextResponse.json({ error: "Invalid place id" }, { status: 400 });

  const place = await prisma.place.findUnique({
    where: { id: placeId },
    select: {
      id: true,
      type: true,
      heroCandidates: {
        where: { isRejected: false },
        orderBy: [{ rank: "asc" }, { score: "desc" }, { id: "asc" }],
      },
    },
  });

  if (!place) return NextResponse.json({ error: "Place not found" }, { status: 404 });

  return NextResponse.json({
    placeId: place.id,
    supported: place.type !== "HVO_TANKSTELLE",
    candidates: normalizeStoredCandidates(place.heroCandidates),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const placeId = await parsePlaceId(ctx);
  if (!Number.isFinite(placeId)) return NextResponse.json({ error: "Invalid place id" }, { status: 400 });

  const payload = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(12, Number(payload?.limit ?? 8)));

  const place = await prisma.place.findUnique({
    where: { id: placeId },
    select: { id: true, name: true, type: true, lat: true, lng: true },
  });

  if (!place) return NextResponse.json({ error: "Place not found" }, { status: 404 });
  if (place.type === "HVO_TANKSTELLE") {
    return NextResponse.json({ error: "Hero candidates are disabled for HVO places" }, { status: 400 });
  }

  const googleKey = String(process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  const candidates = await discoverHeroCandidates(
    {
      id: place.id,
      name: place.name,
      type: place.type as PlaceType,
      lat: place.lat,
      lng: place.lng,
    },
    { googleKey, limit }
  );

  await prisma.$transaction([
    prisma.placeHeroCandidate.deleteMany({ where: { placeId: place.id } }),
    ...(candidates.length
      ? [
          prisma.placeHeroCandidate.createMany({
            data: candidates.map((candidate) => ({
              placeId: place.id,
              source: candidate.source,
              url: candidate.url,
              thumbUrl: candidate.thumbUrl ?? null,
              width: candidate.width ?? null,
              height: candidate.height ?? null,
              score: candidate.score,
              reason: candidate.reason,
              rank: candidate.rank,
            })),
          }),
        ]
      : []),
  ]);

  const stored = await prisma.placeHeroCandidate.findMany({
    where: { placeId: place.id, isRejected: false },
    orderBy: [{ rank: "asc" }, { score: "desc" }, { id: "asc" }],
  });

  return NextResponse.json({
    placeId: place.id,
    supported: true,
    candidates: normalizeStoredCandidates(stored),
  });
}
