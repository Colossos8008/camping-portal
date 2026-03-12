export const COORDINATE_MODES = ["POINT", "AREA_CENTER", "ENTRANCE_POINT", "VIEWPOINT", "COMPLEX_SITE"] as const;
export type CoordinateMode = (typeof COORDINATE_MODES)[number];

export const POI_REVIEW_STATES = ["PENDING", "AUTO_ACCEPT", "AUTO_REJECT", "MANUAL_REVIEW"] as const;
export type PoiReviewState = (typeof POI_REVIEW_STATES)[number];

import { decidePoiGovernancePolicy } from "./poi-source-decision-tree";

type OsmLikeElement = {
  type: "node" | "way" | "relation";
  id: number;
  tags?: Record<string, string>;
};

export type DerivedPoiGovernance = {
  poiDecisionType: string;
  identityPrimarySource: string;
  coordinatePrimarySource: string;
  identitySourceHierarchy: string[];
  coordinateSourceHierarchy: string[];
  canonicalSource: string;
  canonicalSourceId: string;
  wikidataId: string | null;
  osmType: string;
  osmId: bigint;
  wikipediaTitle: string | null;
  wikipediaUrl: string | null;
  coordinateSource: string;
  coordinateConfidence: number;
  coordinateMode: CoordinateMode;
  geometryType: string;
  suggestedReviewState: PoiReviewState;
  suggestedReviewReason: string;
};

function toWikipediaTitle(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  const parts = cleaned.split(":");
  return parts.length > 1 ? parts.slice(1).join(":") : cleaned;
}

function toWikipediaUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw.trim();
  if (!cleaned) return null;
  if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) return cleaned;

  const [lang, ...rest] = cleaned.split(":");
  if (!lang || rest.length === 0) return null;
  const title = rest.join(":").replace(/\s+/g, "_");
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`;
}

function inferCoordinateMode(tags: Record<string, string>, elementType: "node" | "way" | "relation"): CoordinateMode {
  if (tags.tourism === "viewpoint") return "VIEWPOINT";
  if (tags.entrance === "yes") return "ENTRANCE_POINT";

  if (elementType === "relation") return "COMPLEX_SITE";

  if (
    tags.place === "square" ||
    tags.place === "neighbourhood" ||
    tags.landuse != null ||
    tags.boundary != null ||
    tags.leisure === "park"
  ) {
    return "AREA_CENTER";
  }

  return "POINT";
}

function inferGeometryType(elementType: "node" | "way" | "relation"): string {
  if (elementType === "node") return "POINT";
  if (elementType === "way") return "WAY";
  return "RELATION";
}

export function derivePoiGovernanceFromOsmElement(element: OsmLikeElement): DerivedPoiGovernance {
  const tags = element.tags ?? {};
  const wikidataId = tags.wikidata?.trim() || null;
  const wikipediaTitle = toWikipediaTitle(tags.wikipedia);
  const wikipediaUrl = toWikipediaUrl(tags.wikipedia);
  const coordinateMode = inferCoordinateMode(tags, element.type);

  const canonicalSource = wikidataId
    ? "wikidata"
    : wikipediaTitle
      ? "wikipedia"
      : "osm";

  const canonicalSourceId = wikidataId
    ? wikidataId
    : wikipediaTitle
      ? `wikipedia:${wikipediaTitle}`
      : `osm:${element.type}/${element.id}`;

  let coordinateConfidence = 0.58;
  if (wikidataId) coordinateConfidence += 0.2;
  if (wikipediaTitle) coordinateConfidence += 0.12;
  if (element.type === "node") coordinateConfidence += 0.08;
  if (coordinateMode === "COMPLEX_SITE") coordinateConfidence -= 0.12;
  if (coordinateMode === "AREA_CENTER") coordinateConfidence -= 0.07;
  if (coordinateMode === "VIEWPOINT") coordinateConfidence += 0.04;

  coordinateConfidence = Math.max(0, Math.min(1, Number(coordinateConfidence.toFixed(2))));

  const decision = decidePoiGovernancePolicy({
    elementType: element.type,
    tags,
    hasName: Boolean(tags.name?.trim()),
    hasWikidata: Boolean(wikidataId),
    hasWikipedia: Boolean(wikipediaTitle),
    hasGeoNamesRef: Boolean(tags["geonames:id"] || tags.geonames),
    hasUnescoRef: Boolean(tags["ref:unesco"] || tags["heritage:operator"]?.toLowerCase().includes("unesco")),
    coordinateConfidence,
  });

  const suggestedReviewState: PoiReviewState = decision.action;
  const suggestedReviewReason = decision.reason;

  return {
    poiDecisionType: decision.poiType,
    identityPrimarySource: decision.identityPrimarySource,
    coordinatePrimarySource: decision.coordinatePrimarySource,
    identitySourceHierarchy: decision.identityHierarchy,
    coordinateSourceHierarchy: decision.coordinateHierarchy,
    canonicalSource,
    canonicalSourceId,
    wikidataId,
    osmType: element.type,
    osmId: BigInt(element.id),
    wikipediaTitle,
    wikipediaUrl,
    coordinateSource: "osm-overpass",
    coordinateConfidence,
    coordinateMode: decision.preferredCoordinateMode,
    geometryType: inferGeometryType(element.type),
    suggestedReviewState,
    suggestedReviewReason,
  };
}
