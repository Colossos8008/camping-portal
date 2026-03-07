import { rateSightseeing, type SightseeingPlaceLikeInput, type SightseeingRatingResult } from "@/lib/sightseeing-rating";

type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

type PlaceLike = {
  id: number;
  name: string;
  type: PlaceType;
  heroReason?: string | null;
  ratingDetail?: { note?: string | null } | null;
  natureScore?: number | null;
  architectureScore?: number | null;
  historyScore?: number | null;
  uniquenessScore?: number | null;
  spontaneityScore?: number | null;
  calmScore?: number | null;
  sightseeingTotalScore?: number | null;
  sightRelevanceType?: SightseeingRatingResult["sightRelevanceType"] | null;
  sightVisitModePrimary?: SightseeingRatingResult["sightVisitModePrimary"] | null;
  sightVisitModeSecondary?: SightseeingRatingResult["sightVisitModeSecondary"] | null;
  crowdRiskScore?: number | null;
  bestVisitHint?: string | null;
  summaryWhyItMatches?: string | null;
};

export function placeToSightseeingInput(place: PlaceLike): SightseeingPlaceLikeInput {
  return {
    name: place.name,
    type: place.type,
    description: [place.heroReason, place.ratingDetail?.note].filter((x) => typeof x === "string" && x.trim().length > 0).join(" "),
  };
}

function hasExistingSightseeingRating(place: PlaceLike): boolean {
  return Boolean(
    place.natureScore != null ||
      place.architectureScore != null ||
      place.historyScore != null ||
      place.uniquenessScore != null ||
      place.spontaneityScore != null ||
      place.calmScore != null ||
      place.sightseeingTotalScore != null ||
      place.sightRelevanceType != null ||
      place.sightVisitModePrimary != null ||
      place.sightVisitModeSecondary != null ||
      place.crowdRiskScore != null ||
      (typeof place.bestVisitHint === "string" && place.bestVisitHint.trim().length > 0) ||
      (typeof place.summaryWhyItMatches === "string" && place.summaryWhyItMatches.trim().length > 0)
  );
}

export function buildSightseeingAutofillUpdate(place: PlaceLike, force = false): {
  skip: boolean;
  reason?: string;
  rating?: SightseeingRatingResult;
  data?: SightseeingRatingResult;
} {
  if (place.type !== "SEHENSWUERDIGKEIT") return { skip: true, reason: "not-sightseeing-type" };
  if (!force && hasExistingSightseeingRating(place)) return { skip: true, reason: "already-rated" };

  const rating = rateSightseeing(placeToSightseeingInput(place));
  return { skip: false, rating, data: rating };
}
