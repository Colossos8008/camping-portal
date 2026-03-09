export const POI_DECISION_TYPES = [
  "SINGLE_STRUCTURE",
  "SQUARE",
  "OLD_TOWN_OR_ENSEMBLE",
  "NATURE_DESTINATION",
  "SITE_COMPLEX",
  "UNESCO_OR_TOP_POI",
] as const;

export type PoiDecisionType = (typeof POI_DECISION_TYPES)[number];

export type SourceName =
  | "wikidata"
  | "google_places"
  | "osm"
  | "nominatim"
  | "geonames"
  | "unesco_register"
  | "official_register"
  | "unknown";

export type DecisionAction = "AUTO_ACCEPT" | "MANUAL_REVIEW" | "AUTO_REJECT";

export type PoiDecisionInput = {
  elementType: "node" | "way" | "relation";
  tags: Record<string, string>;
  hasName: boolean;
  hasWikidata: boolean;
  hasWikipedia: boolean;
  hasGeoNamesRef: boolean;
  hasUnescoRef: boolean;
  coordinateConfidence: number;
};

export type PoiDecisionResult = {
  poiType: PoiDecisionType;
  identityPrimarySource: SourceName;
  coordinatePrimarySource: SourceName;
  preferredCoordinateMode: "POINT" | "AREA_CENTER" | "ENTRANCE_POINT" | "VIEWPOINT" | "COMPLEX_SITE";
  identityHierarchy: SourceName[];
  coordinateHierarchy: SourceName[];
  action: DecisionAction;
  reason: string;
};

function detectPoiType(elementType: "node" | "way" | "relation", tags: Record<string, string>): PoiDecisionType {
  const tourism = tags.tourism ?? "";
  const historic = tags.historic ?? "";
  const place = tags.place ?? "";
  const leisure = tags.leisure ?? "";
  const natural = tags.natural ?? "";
  const boundary = tags.boundary ?? "";
  const landuse = tags.landuse ?? "";
  const site = tags.site ?? "";

  if (
    tags["heritage:operator"]?.toLowerCase().includes("unesco") ||
    tags["heritage"] === "1" ||
    tags["unesco"] === "yes" ||
    tags["ref:unesco"]
  ) {
    return "UNESCO_OR_TOP_POI";
  }

  if (place === "square") return "SQUARE";

  if (
    place === "neighbourhood" ||
    place === "quarter" ||
    boundary === "administrative" ||
    boundary === "historic" ||
    landuse === "residential"
  ) {
    return "OLD_TOWN_OR_ENSEMBLE";
  }

  if (
    natural.length > 0 ||
    tourism === "viewpoint" ||
    leisure === "nature_reserve" ||
    tags.protect_class != null
  ) {
    return "NATURE_DESTINATION";
  }

  if (
    elementType === "relation" ||
    site.length > 0 ||
    leisure === "park" ||
    tourism === "museum" ||
    historic === "archaeological_site"
  ) {
    return "SITE_COMPLEX";
  }

  if (
    ["castle", "fort", "church", "monument", "memorial", "ruins", "manor"].includes(historic) ||
    ["church", "cathedral", "museum"].includes(tourism) ||
    ["church", "cathedral", "museum"].includes(tags.building ?? "")
  ) {
    return "SINGLE_STRUCTURE";
  }

  return "SINGLE_STRUCTURE";
}

function preferredCoordinateModeForType(poiType: PoiDecisionType): PoiDecisionResult["preferredCoordinateMode"] {
  switch (poiType) {
    case "SINGLE_STRUCTURE":
      return "ENTRANCE_POINT";
    case "SQUARE":
      return "AREA_CENTER";
    case "OLD_TOWN_OR_ENSEMBLE":
      return "AREA_CENTER";
    case "NATURE_DESTINATION":
      return "VIEWPOINT";
    case "SITE_COMPLEX":
      return "COMPLEX_SITE";
    case "UNESCO_OR_TOP_POI":
      return "AREA_CENTER";
  }
}

function sourceHierarchyForType(poiType: PoiDecisionType): Pick<PoiDecisionResult, "identityHierarchy" | "coordinateHierarchy"> {
  switch (poiType) {
    case "SINGLE_STRUCTURE":
      return {
        identityHierarchy: ["wikidata", "google_places", "osm", "nominatim", "geonames", "official_register"],
        coordinateHierarchy: ["google_places", "osm", "nominatim", "wikidata", "geonames"],
      };
    case "SQUARE":
      return {
        identityHierarchy: ["wikidata", "osm", "google_places", "nominatim", "geonames"],
        coordinateHierarchy: ["osm", "nominatim", "google_places", "wikidata", "geonames"],
      };
    case "OLD_TOWN_OR_ENSEMBLE":
      return {
        identityHierarchy: ["wikidata", "official_register", "osm", "geonames", "nominatim"],
        coordinateHierarchy: ["osm", "nominatim", "wikidata", "geonames"],
      };
    case "NATURE_DESTINATION":
      return {
        identityHierarchy: ["wikidata", "osm", "geonames", "nominatim", "google_places"],
        coordinateHierarchy: ["google_places", "osm", "nominatim", "geonames", "wikidata"],
      };
    case "SITE_COMPLEX":
      return {
        identityHierarchy: ["wikidata", "official_register", "osm", "nominatim", "geonames"],
        coordinateHierarchy: ["osm", "nominatim", "google_places", "wikidata", "geonames"],
      };
    case "UNESCO_OR_TOP_POI":
      return {
        identityHierarchy: ["unesco_register", "wikidata", "official_register", "osm", "geonames"],
        coordinateHierarchy: ["google_places", "osm", "nominatim", "wikidata", "geonames"],
      };
  }
}

function resolveTopIdentitySource(input: PoiDecisionInput, hierarchy: SourceName[]): SourceName {
  for (const source of hierarchy) {
    if (source === "wikidata" && input.hasWikidata) return source;
    if (source === "unesco_register" && input.hasUnescoRef) return source;
    if (source === "geonames" && input.hasGeoNamesRef) return source;
    if (source === "osm") return source;
  }
  return "unknown";
}

export function decidePoiGovernancePolicy(input: PoiDecisionInput): PoiDecisionResult {
  const poiType = detectPoiType(input.elementType, input.tags);
  const preferredCoordinateMode = preferredCoordinateModeForType(poiType);
  const { identityHierarchy, coordinateHierarchy } = sourceHierarchyForType(poiType);
  const identityPrimarySource = resolveTopIdentitySource(input, identityHierarchy);
  const coordinatePrimarySource = coordinateHierarchy[0] ?? "unknown";

  if (!input.hasName) {
    return {
      poiType,
      identityPrimarySource,
      coordinatePrimarySource,
      preferredCoordinateMode,
      identityHierarchy,
      coordinateHierarchy,
      action: "AUTO_REJECT",
      reason: "missing-name",
    };
  }

  if (poiType === "UNESCO_OR_TOP_POI" && !input.hasUnescoRef) {
    return {
      poiType,
      identityPrimarySource,
      coordinatePrimarySource,
      preferredCoordinateMode,
      identityHierarchy,
      coordinateHierarchy,
      action: "MANUAL_REVIEW",
      reason: "top-poi-without-unesco-reference",
    };
  }

  if (input.coordinateConfidence < 0.45) {
    return {
      poiType,
      identityPrimarySource,
      coordinatePrimarySource,
      preferredCoordinateMode,
      identityHierarchy,
      coordinateHierarchy,
      action: "AUTO_REJECT",
      reason: "low-coordinate-confidence",
    };
  }

  if (input.hasWikidata && input.coordinateConfidence >= 0.82 && preferredCoordinateMode !== "COMPLEX_SITE") {
    return {
      poiType,
      identityPrimarySource,
      coordinatePrimarySource,
      preferredCoordinateMode,
      identityHierarchy,
      coordinateHierarchy,
      action: "AUTO_ACCEPT",
      reason: "wikidata-identity-high-coordinate-confidence",
    };
  }

  if (input.coordinateConfidence >= 0.74 && (input.hasWikidata || input.hasWikipedia)) {
    return {
      poiType,
      identityPrimarySource,
      coordinatePrimarySource,
      preferredCoordinateMode,
      identityHierarchy,
      coordinateHierarchy,
      action: "MANUAL_REVIEW",
      reason: "strong-signals-but-human-check-needed",
    };
  }

  return {
    poiType,
    identityPrimarySource,
    coordinatePrimarySource,
    preferredCoordinateMode,
    identityHierarchy,
    coordinateHierarchy,
    action: "MANUAL_REVIEW",
    reason: "default-manual-review",
  };
}
