import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

async function parseIds(ctx: {
  params: Promise<{ id: string; candidateId: string }> | { id: string; candidateId: string };
}): Promise<{ placeId: number; candidateId: number }> {
  const params: any = await (ctx as any).params;
  return {
    placeId: Number(params?.id),
    candidateId: Number(params?.candidateId),
  };
}

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; candidateId: string }> | { id: string; candidateId: string } }
) {
  const { placeId, candidateId } = await parseIds(ctx);
  if (!Number.isFinite(placeId) || !Number.isFinite(candidateId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const candidate = await prisma.placeHeroCandidate.findFirst({
    where: { id: candidateId, placeId, isRejected: false },
  });
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  const updated = await prisma.place.update({
    where: { id: placeId },
    data: {
      heroImageUrl: candidate.url,
      heroScore: candidate.score ?? null,
      heroReason: candidate.reason ?? `Selected ${candidate.source} hero candidate`,
    },
    select: {
      id: true,
      heroImageUrl: true,
      heroScore: true,
      heroReason: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({
    ok: true,
    placeId: updated.id,
    heroImageUrl: updated.heroImageUrl,
    heroScore: updated.heroScore,
    heroReason: updated.heroReason,
    updatedAt: updated.updatedAt,
  });
}
