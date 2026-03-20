import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  deriveLearnedPreferencesFromFeedback,
  discoverHeroCandidates,
  type HeroCandidateFeedbackSample,
  type HeroCandidateRecord,
  type PlaceType,
} from "@/lib/hero-candidates";
import { isSuspiciousGenericGooglePlaceMatch } from "@/lib/google-place-name-guard";

export const runtime = "nodejs";

function parsePlaceId(ctx: { params: Promise<{ id: string }> | { id: string } }): Promise<number> {
  return Promise.resolve((ctx as any).params).then((params) => Number((params as any)?.id));
}

function normalizeStoredCandidates(place: { name: string; type: PlaceType }, items: any[]): HeroCandidateRecord[] {
  return items
    .map((item: any, index: number) => ({
      id: typeof item.id === "number" ? item.id : undefined,
      source: item.source === "google" || item.source === "website" ? item.source : "wikimedia",
      url: String(item.url ?? ""),
      thumbUrl: String(item.thumbUrl ?? "").trim() || undefined,
      width: typeof item.width === "number" ? item.width : undefined,
      height: typeof item.height === "number" ? item.height : undefined,
      score: normalizePersistedScore(item.score, item.userFeedback),
      reason: String(item.reason ?? ""),
      rank: typeof item.rank === "number" ? item.rank : index + 1,
      userFeedback:
        item.userFeedback === "UP" || item.userFeedback === "DOWN" ? item.userFeedback : null,
    }))
    .filter(
      (item) =>
        !isSuspiciousGenericGooglePlaceMatch({
          placeName: place.name,
          placeType: place.type,
          reason: item.reason,
          source: item.source,
        })
    );
}

function candidateKey(item: { source?: string | null; url?: string | null }): string {
  return `${String(item.source ?? "").trim().toLowerCase()}::${String(item.url ?? "").trim()}`;
}

function toStoredCreateData(
  placeId: number,
  candidate: HeroCandidateRecord,
  index: number,
  feedback?: "UP" | "DOWN" | null
) {
  return {
    placeId,
    source: candidate.source,
    url: candidate.url,
    thumbUrl: candidate.thumbUrl ?? null,
    width: candidate.width ?? null,
    height: candidate.height ?? null,
    score: candidate.score,
    reason: candidate.reason,
    rank: index + 1,
    isRejected: feedback === "DOWN",
    userFeedback: feedback ?? null,
    feedbackUpdatedAt: feedback ? new Date() : null,
  };
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const placeId = await parsePlaceId(ctx);
  if (!Number.isFinite(placeId)) return NextResponse.json({ error: "Invalid place id" }, { status: 400 });

  const place = await prisma.place.findUnique({
    where: { id: placeId },
    select: {
      id: true,
      name: true,
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
    supported: true,
    candidates: normalizeStoredCandidates({ name: place.name, type: place.type as PlaceType }, place.heroCandidates),
  });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const placeId = await parsePlaceId(ctx);
  if (!Number.isFinite(placeId)) return NextResponse.json({ error: "Invalid place id" }, { status: 400 });

  const payload = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(12, Number(payload?.limit ?? 8)));
  const reloadRound = Math.max(0, Number(payload?.reloadRound ?? 0));
  const requestExcludeKeys = new Set<string>(
    Array.isArray(payload?.excludeKeys) ? payload.excludeKeys.map((item: unknown) => String(item ?? "").trim()).filter(Boolean) : []
  );

  const place = await prisma.place.findUnique({
    where: { id: placeId },
    select: {
      id: true,
      name: true,
      type: true,
      lat: true,
      lng: true,
      heroImageUrl: true,
      heroCandidates: {
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      },
    },
  });

  if (!place) return NextResponse.json({ error: "Place not found" }, { status: 404 });

  const googleKey = String(process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  const historicalFeedback = await prisma.placeHeroCandidate.findMany({
    where: {
      userFeedback: { in: ["UP", "DOWN"] },
      place: { type: place.type as PlaceType },
    },
    orderBy: [{ feedbackUpdatedAt: "desc" }, { id: "desc" }],
    take: 300,
    select: {
      source: true,
      url: true,
      reason: true,
      userFeedback: true,
    },
  });

  const feedbackSamples: HeroCandidateFeedbackSample[] = historicalFeedback
    .map((item: { source: string; url: string; reason: string | null; userFeedback: string | null }) => ({
      source: item.source === "google" || item.source === "website" ? item.source : "wikimedia",
      url: String(item.url ?? ""),
      reason: String(item.reason ?? ""),
      userFeedback: item.userFeedback === "UP" || item.userFeedback === "DOWN" ? item.userFeedback : null,
    }))
    .filter((item: HeroCandidateFeedbackSample | { userFeedback: null }): item is HeroCandidateFeedbackSample => item.userFeedback === "UP" || item.userFeedback === "DOWN");

  const learnedPreferences = deriveLearnedPreferencesFromFeedback(place.type as PlaceType, feedbackSamples);
  const explorationLevel = Math.max(1, Math.min(4, Math.floor(requestExcludeKeys.size / 3) + 1));

  const candidates = await discoverHeroCandidates(
    {
      id: place.id,
      name: place.name,
      type: place.type as PlaceType,
      lat: place.lat,
      lng: place.lng,
      heroImageUrl: place.heroImageUrl,
    },
    {
      googleKey,
      limit,
      excludeKeys: Array.from(requestExcludeKeys),
      preferences: learnedPreferences,
      explorationLevel,
      reloadRound,
    }
  );

  const fallbackCandidates =
    candidates.length >= Math.max(3, Math.min(limit, 5))
      ? []
      : await discoverHeroCandidates(
          {
            id: place.id,
            name: place.name,
            type: place.type as PlaceType,
            lat: place.lat,
            lng: place.lng,
            heroImageUrl: place.heroImageUrl,
          },
          {
            googleKey,
            limit,
            preferences: learnedPreferences,
            explorationLevel: explorationLevel + 1,
            reloadRound: reloadRound + 1,
          }
        );

  const combinedDiscovered = dedupeByIdentity([...candidates, ...fallbackCandidates]);

  const existing: Array<{
    id: number;
    source: string;
    url: string;
    thumbUrl: string | null;
    width: number | null;
    height: number | null;
    score: number | null;
    reason: string | null;
    rank: number | null;
    isRejected: boolean;
    userFeedback: string | null;
  }> = place.heroCandidates ?? [];
  const rejectedKeys = new Set(
    existing
      .filter((item) => item.userFeedback === "DOWN" || item.isRejected)
      .map((item) => candidateKey(item))
  );
  const positiveByKey = new Map(
    existing
      .filter(
        (item) =>
          !isSuspiciousGenericGooglePlaceMatch({
            placeName: place.name,
            placeType: place.type as PlaceType,
            reason: String(item.reason ?? ""),
            source: String(item.source ?? ""),
          })
      )
      .filter((item) => item.userFeedback === "UP" && !item.isRejected)
      .map((item) => [candidateKey(item), item])
  );

  const filteredDiscovered = combinedDiscovered.filter(
    (candidate) =>
      !rejectedKeys.has(candidateKey(candidate)) &&
      !isSuspiciousGenericGooglePlaceMatch({
        placeName: place.name,
        placeType: place.type as PlaceType,
        reason: candidate.reason,
        source: candidate.source,
      })
  );
  const merged: HeroCandidateRecord[] = [];
  const seen = new Set<string>();

  for (const positive of positiveByKey.values()) {
    const key = candidateKey(positive);
    const refreshed = filteredDiscovered.find((candidate) => candidateKey(candidate) === key);
    const score = Math.max(
      normalizePersistedScore(positive.score, positive.userFeedback),
      Number(refreshed?.score ?? 0)
    );
    merged.push({
      id: positive.id,
      source: (positive.source === "google" || positive.source === "website" ? positive.source : "wikimedia") as
        | "google"
        | "wikimedia"
        | "website",
      url: String(refreshed?.url ?? positive.url ?? ""),
      thumbUrl: String(refreshed?.thumbUrl ?? positive.thumbUrl ?? "").trim() || undefined,
      width: typeof refreshed?.width === "number" ? refreshed.width : positive.width ?? undefined,
      height: typeof refreshed?.height === "number" ? refreshed.height : positive.height ?? undefined,
      score,
      reason: String(refreshed?.reason ?? positive.reason ?? "Positive manual feedback"),
      rank: merged.length + 1,
      userFeedback: "UP",
    });
    seen.add(key);
  }

  let newCandidatesLoaded = 0;
  for (const candidate of filteredDiscovered) {
    const key = candidateKey(candidate);
    if (seen.has(key)) continue;
    if (!positiveByKey.has(key) && !requestExcludeKeys.has(key)) {
      newCandidatesLoaded += 1;
    }
    merged.push({ ...candidate, rank: merged.length + 1, userFeedback: null });
    seen.add(key);
  }

  const keepRejectedIds = existing
    .filter((item) => item.userFeedback === "DOWN" || item.isRejected)
    .map((item) => item.id)
    .filter((value): value is number => typeof value === "number");
  const keepPositiveIds = merged
    .map((item) => item.id)
    .filter((value): value is number => typeof value === "number");
  const keepIds = [...new Set([...keepRejectedIds, ...keepPositiveIds])];

  await prisma.placeHeroCandidate.deleteMany({
    where: {
      placeId: place.id,
      ...(keepIds.length ? { id: { notIn: keepIds } } : {}),
    },
  });

  for (const [index, candidate] of merged.entries()) {
    if (typeof candidate.id === "number") {
      await prisma.placeHeroCandidate.update({
        where: { id: candidate.id },
        data: {
          source: candidate.source,
          url: candidate.url,
          thumbUrl: candidate.thumbUrl ?? null,
          width: candidate.width ?? null,
          height: candidate.height ?? null,
          score: candidate.score,
          reason: candidate.reason,
          rank: index + 1,
          isRejected: false,
          userFeedback: candidate.userFeedback ?? null,
          feedbackUpdatedAt: candidate.userFeedback ? new Date() : null,
        },
      });
    } else {
      await prisma.placeHeroCandidate.create({
        data: toStoredCreateData(place.id, candidate, index, candidate.userFeedback ?? null),
      });
    }
  }

  const stored = await prisma.placeHeroCandidate.findMany({
    where: { placeId: place.id, isRejected: false },
    orderBy: [{ rank: "asc" }, { score: "desc" }, { id: "asc" }],
  });

  return NextResponse.json({
    placeId: place.id,
    supported: true,
    candidates: normalizeStoredCandidates({ name: place.name, type: place.type as PlaceType }, stored),
    newCandidatesLoaded,
    preservedPositiveCount: positiveByKey.size,
  });
}

function dedupeByIdentity(candidates: HeroCandidateRecord[]): HeroCandidateRecord[] {
  const seen = new Set<string>();
  const out: HeroCandidateRecord[] = [];
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function normalizePersistedScore(score: unknown, feedback: unknown): number {
  const numeric = typeof score === "number" ? score : Number(score ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  if (feedback === "UP" && numeric >= 1000) {
    return 100;
  }
  return numeric;
}
