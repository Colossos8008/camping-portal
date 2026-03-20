import type { PlaceType } from "@/lib/hero-type-scoring";

export type HeroCandidateSource = "google" | "wikimedia";

export type HeroCandidate = {
  source: HeroCandidateSource;
  score: number;
  url: string;
};

export const HERO_SCORE_THRESHOLDS: Record<PlaceType, { preferredMin: number; acceptableMin: number }> = {
  CAMPINGPLATZ: { preferredMin: 30, acceptableMin: 6 },
  STELLPLATZ: { preferredMin: 30, acceptableMin: 6 },
  HVO_TANKSTELLE: { preferredMin: 8, acceptableMin: 8 },
  SEHENSWUERDIGKEIT: { preferredMin: 18, acceptableMin: 4 },
};

export function selectHeroCandidateByThreshold<T extends HeroCandidate>(placeType: PlaceType, candidates: T[]) {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const thresholds = HERO_SCORE_THRESHOLDS[placeType];
  const bestOverall = sorted[0] ?? null;
  const bestPreferred = sorted.find((candidate) => candidate.score >= thresholds.preferredMin) ?? null;
  const bestAcceptable =
    sorted.find((candidate) => candidate.score >= thresholds.acceptableMin && candidate.score < thresholds.preferredMin) ?? null;

  return {
    thresholds,
    bestOverall,
    bestPreferred,
    bestAcceptable,
    chosen: bestPreferred ?? bestAcceptable ?? null,
  };
}
