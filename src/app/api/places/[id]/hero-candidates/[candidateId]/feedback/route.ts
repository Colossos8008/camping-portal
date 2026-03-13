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
  req: Request,
  ctx: { params: Promise<{ id: string; candidateId: string }> | { id: string; candidateId: string } }
) {
  const { placeId, candidateId } = await parseIds(ctx);
  if (!Number.isFinite(placeId) || !Number.isFinite(candidateId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const voteRaw = String(body?.vote ?? "").trim().toUpperCase();
  const vote = voteRaw === "UP" || voteRaw === "DOWN" ? voteRaw : null;
  if (!vote) return NextResponse.json({ error: "Invalid vote" }, { status: 400 });

  const candidate = await prisma.placeHeroCandidate.findFirst({
    where: { id: candidateId, placeId },
  });
  if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });

  const updated = await prisma.placeHeroCandidate.update({
    where: { id: candidate.id },
    data: {
      userFeedback: vote,
      isRejected: vote === "DOWN",
      ...(vote === "UP" ? { rank: 0 } : {}),
      feedbackUpdatedAt: new Date(),
    },
    select: {
      id: true,
      placeId: true,
      userFeedback: true,
      isRejected: true,
    },
  });

  return NextResponse.json({
    ok: true,
    candidateId: updated.id,
    placeId: updated.placeId,
    userFeedback: updated.userFeedback,
    isRejected: updated.isRejected,
  });
}
