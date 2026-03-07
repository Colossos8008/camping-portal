export type TargetRegion = "normandie" | "bretagne";

export type RegionConfig = {
  key: string;
  label: string;
  iso3166_2?: string;
  country: string;
};

export type BoundingBox = {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
};

export const REGION_CONFIGS: Record<TargetRegion, RegionConfig> = {
  normandie: {
    key: "normandie",
    label: "Normandie",
    iso3166_2: "FR-NOR",
    country: "France",
  },
  bretagne: {
    key: "bretagne",
    label: "Bretagne",
    iso3166_2: "FR-BRE",
    country: "France",
  },
};

const NEGATIVE_TERMS = [
  "amusement",
  "theme_park",
  "theme park",
  "aquarium",
  "shopping",
  "mall",
  "commercial",
  "entertainment",
  "indoor",
  "family park",
  "water_park",
  "water park",
  "gaming",
  "cinema",
  "escape game",
  "laser game",
  "playground",
  "zoo",
  "animal park",
  "aire de jeu",
  "captage eau",
  "water intake",
  "water catchment",
  "utility",
  "pump station",
  "poste captage",
];

const HARD_EXCLUDE_TERMS = [
  "playground",
  "aire de jeu",
  "captage eau",
  "poste captage",
  "water intake",
  "water catchment",
  "station de pompage",
  "pump station",
  "reservoir technique",
];

const HARD_EXCLUDE_TAG_PAIRS = [
  "leisure=playground",
  "playground=yes",
  "man_made=water_works",
  "man_made=water_tower",
  "man_made=utility_pole",
  "waterway=water_point",
  "waterway=pumping_station",
  "utility=*",
  "building=service",
  "building=utility",
];

const WEAK_GENERIC_NAME_PATTERNS = [
  /^(croix|cross|wayside cross)$/,
  /^croix\b/,
  /^(calvaire)$/,
  /^(statue|statue de .+)$/,
  /^(clocher)$/,
  /^(villa)$/,
  /^(manoir)$/,
  /^(monument aux morts)$/,
];

const STRONG_CONTEXT_TERMS = [
  "viewpoint",
  "point de vue",
  "panorama",
  "scenic",
  "cliff",
  "cape",
  "cap ",
  "headland",
  "coast",
  "coastal",
  "baie",
  "bay",
  "anse",
  "pointe",
  "fort",
  "castle",
  "fortress",
  "citadel",
  "ruins",
  "dolmen",
  "menhir",
  "megalith",
  "archaeological",
  "landmark",
  "lighthouse",
  "debarquement",
  "d day",
  "resistance",
  "necropole",
  "ossuary",
  "bataille",
];

const POSITIVE_TERMS = [
  "abbey",
  "archaeological",
  "castle",
  "cathedral",
  "citadel",
  "cliff",
  "coast",
  "coastal",
  "dolmen",
  "dune",
  "fort",
  "fortress",
  "headland",
  "heritage",
  "historic",
  "history",
  "landmark",
  "lighthouse",
  "megalith",
  "memorial",
  "menhir",
  "monument",
  "old town",
  "panorama",
  "panoramic",
  "ramparts",
  "ruins",
  "scenic",
  "viewpoint",
];

export type OverpassElement = {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
};

export type SightseeingCandidate = {
  sourceId: string;
  name: string;
  lat: number;
  lng: number;
  category: string;
  tags: string[];
  source: "OSM/Overpass";
  sourceRegion: string;
  country: string;
  reason: string;
};

function normalizeText(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeName(input: string): string {
  return normalizeText(input);
}

export function parseOverpassElements(payload: unknown): OverpassElement[] {
  if (!payload || typeof payload !== "object") return [];
  const elements = (payload as { elements?: unknown }).elements;
  if (!Array.isArray(elements)) return [];

  const safe: OverpassElement[] = [];
  for (const element of elements) {
    if (!element || typeof element !== "object") continue;
    const candidate = element as OverpassElement;
    if (!["node", "way", "relation"].includes(String(candidate.type))) continue;
    if (typeof candidate.id !== "number") continue;
    safe.push(candidate);
  }
  return safe;
}

function getCoordinates(element: OverpassElement): { lat: number; lng: number } | null {
  if (typeof element.lat === "number" && typeof element.lon === "number") {
    return { lat: element.lat, lng: element.lon };
  }
  if (element.center && typeof element.center.lat === "number" && typeof element.center.lon === "number") {
    return { lat: element.center.lat, lng: element.center.lon };
  }
  return null;
}

function isLikelyNegative(tags: Record<string, string>, searchableText: string): boolean {
  const tagPairs = Object.entries(tags).map(([k, v]) => `${k}=${v}`.toLowerCase());

  if (tags.tourism === "theme_park" || tags.tourism === "aquarium" || tags.leisure === "amusement_arcade") {
    return true;
  }

  if (tags.shop || tags.commercial || tags.mall === "yes") {
    return true;
  }

  return NEGATIVE_TERMS.some((term) => searchableText.includes(term) || tagPairs.some((pair) => pair.includes(term)));
}

function isHardExcluded(tags: Record<string, string>, searchableText: string): boolean {
  const tagPairs = Object.entries(tags).map(([k, v]) => `${k}=${v}`.toLowerCase());
  if (HARD_EXCLUDE_TERMS.some((term) => searchableText.includes(term))) return true;

  return HARD_EXCLUDE_TAG_PAIRS.some((pair) => {
    if (pair.endsWith("=*")) {
      const key = pair.slice(0, -2);
      return tagPairs.some((tagPair) => tagPair.startsWith(`${key}=`));
    }
    return tagPairs.includes(pair);
  });
}

function hasStrongContext(tags: Record<string, string>, searchableText: string): boolean {
  if (tags.tourism === "viewpoint") return true;
  if (["castle", "fort", "fortress", "ruins", "archaeological_site"].includes(tags.historic ?? "")) return true;
  if ((tags.site_type ?? "").includes("megalith") || (tags.site_type ?? "").includes("archaeological")) return true;
  if (tags.megalith_type) return true;
  if (tags.man_made === "lighthouse") return true;

  return STRONG_CONTEXT_TERMS.some((term) => searchableText.includes(term));
}

function isWeakGenericCandidate(name: string, tags: Record<string, string>, searchableText: string): boolean {
  const normalizedName = normalizeText(name);
  const isWeakName = WEAK_GENERIC_NAME_PATTERNS.some((pattern) => pattern.test(normalizedName));

  if (!isWeakName) return false;
  if (hasStrongContext(tags, searchableText)) return false;

  return true;
}

function classifyCategory(tags: Record<string, string>, searchableText: string): string {
  if (tags.man_made === "lighthouse") return "lighthouse";
  if (["castle", "fort", "fortress"].includes(tags.historic ?? "")) return "castle_fortress";
  if (tags.historic === "ruins" || tags.ruins === "yes") return "ruins";
  if (["memorial", "monument"].includes(tags.historic ?? "")) return "memorial_monument";
  if ((tags.historic ?? "").includes("archaeological") || (tags.site_type ?? "").includes("archaeological")) return "archaeological_site";
  if ((tags.site_type ?? "").includes("megalith") || tags.megalith_type || searchableText.includes("dolmen") || searchableText.includes("menhir")) {
    return "megalithic_site";
  }
  if (tags.tourism === "viewpoint" || searchableText.includes("viewpoint") || searchableText.includes("panorama")) return "viewpoint";
  if (tags.natural || searchableText.includes("cliff") || searchableText.includes("coast")) return "nature_landmark";
  if (["cathedral", "abbey", "church"].includes(tags.building ?? "") || searchableText.includes("cathedral") || searchableText.includes("abbey")) {
    return "historic_architecture";
  }
  if (searchableText.includes("old town") || searchableText.includes("historic center") || searchableText.includes("historic centre")) {
    return "historic_old_town";
  }
  return "landmark";
}

function collectTags(tags: Record<string, string>): string[] {
  return Object.entries(tags)
    .filter(([, value]) => typeof value === "string" && value.trim().length > 0)
    .map(([key, value]) => `${key}:${value}`)
    .slice(0, 40);
}

function hasPositiveSignal(tags: Record<string, string>, searchableText: string): boolean {
  if (hasStrongContext(tags, searchableText)) return true;

  let supportingSignals = 0;
  if (tags.tourism === "attraction") supportingSignals += 1;
  if (tags.historic) supportingSignals += 1;
  if (tags.heritage) supportingSignals += 1;
  if (tags.natural) supportingSignals += 1;

  if (POSITIVE_TERMS.some((term) => searchableText.includes(term))) supportingSignals += 1;

  return supportingSignals >= 2;
}

export function normalizeCandidate(
  element: OverpassElement,
  region: RegionConfig,
  options?: { onReject?: (reason: string) => void }
): SightseeingCandidate | null {
  const tags = element.tags ?? {};
  const name = String(tags.name ?? "").trim();
  if (!name) {
    options?.onReject?.("missing name");
    return null;
  }

  const coords = getCoordinates(element);
  if (!coords) {
    options?.onReject?.("missing coordinates");
    return null;
  }

  const searchableText = normalizeText(
    [
      name,
      tags.description,
      tags.historic,
      tags.natural,
      tags.tourism,
      tags.site_type,
      tags.man_made,
      tags.building,
      tags["heritage:operator"],
      tags.wikipedia,
      tags.wikidata,
      tags.place,
      tags.seamark_type,
    ]
      .filter(Boolean)
      .join(" ")
  );

  if (isHardExcluded(tags, searchableText)) {
    options?.onReject?.("hard negative filter");
    return null;
  }
  if (isLikelyNegative(tags, searchableText)) {
    options?.onReject?.("negative filter");
    return null;
  }
  if (isWeakGenericCandidate(name, tags, searchableText)) {
    options?.onReject?.("generic weak candidate without strong context");
    return null;
  }
  if (!hasPositiveSignal(tags, searchableText)) {
    options?.onReject?.("insufficient positive signal");
    return null;
  }

  const category = classifyCategory(tags, searchableText);

  return {
    sourceId: `osm:${element.type}/${element.id}`,
    name,
    lat: roundCoord(coords.lat),
    lng: roundCoord(coords.lng),
    category,
    tags: collectTags(tags),
    source: "OSM/Overpass",
    sourceRegion: region.key,
    country: region.country,
    reason: `OSM match category=${category}`,
  };
}

function roundCoord(v: number): number {
  return Math.round(v * 1_000_000) / 1_000_000;
}

export function buildOverpassQuery(
  region: RegionConfig,
  options?: { bbox?: BoundingBox | null; around?: { lat: number; lng: number; radiusKm: number } | null }
): string {
  const aroundClause = options?.around
    ? `(around:${Math.round(options.around.radiusKm * 1_000)},${options.around.lat},${options.around.lng})`
    : null;

  const bboxClause = options?.bbox
    ? `(${options.bbox.minLat},${options.bbox.minLon},${options.bbox.maxLat},${options.bbox.maxLon})`
    : aroundClause ?? "(area.searchArea)";

  const areaScope = options?.around
    ? ""
    : `area["ISO3166-2"="${region.iso3166_2}"]["admin_level"="4"]->.searchArea;\n`;

  return `
[out:json][timeout:120];
${areaScope}(
  nwr["tourism"="attraction"]${bboxClause};
  nwr["tourism"="viewpoint"]${bboxClause};
  nwr["historic"]${bboxClause};
  nwr["heritage"]${bboxClause};
  nwr["natural"]${bboxClause};
  nwr["man_made"="lighthouse"]${bboxClause};
  nwr["historic"~"castle|fort|fortress|ruins|memorial|monument|archaeological_site",i]${bboxClause};
  nwr["ruins"="yes"]${bboxClause};
  nwr["building"~"abbey|cathedral|church|chapel|castle",i]${bboxClause};
  nwr["site_type"~"megalith|dolmen|menhir|archaeological",i]${bboxClause};
  nwr["megalith_type"]${bboxClause};
);
out center tags;
`.trim();
}

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const earthRadius = 6_371_000;
  const dLat = toRadians(bLat - aLat);
  const dLng = toRadians(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(aLat)) * Math.cos(toRadians(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

export function areLikelySamePlace(input: {
  nameA: string;
  latA: number;
  lngA: number;
  nameB: string;
  latB: number;
  lngB: number;
}): boolean {
  const normA = normalizeName(input.nameA);
  const normB = normalizeName(input.nameB);
  const distance = distanceMeters(input.latA, input.lngA, input.latB, input.lngB);

  if (distance <= 40) return true;
  if (normA === normB && distance <= 250) return true;
  if ((normA.includes(normB) || normB.includes(normA)) && distance <= 120) return true;

  return false;
}
