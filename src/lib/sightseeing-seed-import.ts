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
  source: "OSM/Overpass" | "curated-preset";
  sourceRegion: string;
  country: string;
  reason: string;
};

export type NearbyQueryPart = {
  key: string;
  label: string;
  clauses: string[];
};

export type ImportMode = "default" | "highlight";

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
  options?: { bbox?: BoundingBox | null; around?: { lat: number; lng: number; radiusKm: number } | null; mode?: ImportMode }
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

  const mode = options?.mode ?? "default";

  const clauses =
    mode === "highlight"
      ? [
          'nwr["historic"~"castle|fort|fortress|ruins|memorial|monument|city_gate",i]',
          'nwr["historic"="castle"]',
          'nwr["historic"="manor"]',
          'nwr["ruins"="yes"]',
          'nwr["building"~"abbey|monastery|cathedral|castle|palace",i]',
          'nwr["amenity"="place_of_worship"]["building"~"cathedral|abbey|monastery",i]',
          'nwr["tourism"="attraction"]["name"~"castle|fort|fortress|citadel|abbey|monastery|cathedral|dom|palace|schloss|burg|old town|historic (center|centre)|altstadt|deutsches eck|landmark|icon",i]',
          'nwr["tourism"="viewpoint"]["name"~"castle|fort|fortress|citadel|abbey|cathedral|dom|palace|schloss|burg|landmark|deutsches eck",i]',
          'nwr["aerialway"~"cable_car|gondola",i]["tourism"="attraction"]',
          'nwr["railway"="funicular"]["tourism"="attraction"]',
          'nwr["name"~"old town|historic (center|centre)|altstadt",i]',
        ]
      : [
          'nwr["tourism"="attraction"]',
          'nwr["tourism"="viewpoint"]',
          'nwr["historic"]',
          'nwr["heritage"]',
          'nwr["natural"]',
          'nwr["man_made"="lighthouse"]',
          'nwr["historic"~"castle|fort|fortress|ruins|memorial|monument|archaeological_site",i]',
          'nwr["ruins"="yes"]',
          'nwr["building"~"abbey|cathedral|church|chapel|castle",i]',
          'nwr["site_type"~"megalith|dolmen|menhir|archaeological",i]',
          'nwr["megalith_type"]',
        ];

  const body = clauses.map((clause) => `  ${clause}${bboxClause};`).join("\n");

  return `
[out:json][timeout:120];
${areaScope}(
${body}
);
out center tags;
`.trim();
}

const NEARBY_QUERY_PARTS: NearbyQueryPart[] = [
  {
    key: "nature_viewpoint",
    label: "Natur/Aussicht/Küste/Viewpoint",
    clauses: [
      'nwr["tourism"="viewpoint"]',
      'nwr["natural"]',
      'nwr["tourism"="attraction"]["natural"]',
      'nwr["tourism"="attraction"]["name"~"viewpoint|panorama|scenic|coast|cliff|cape|headland",i]',
    ],
  },
  {
    key: "fortress_ruins_castle",
    label: "Fort/Fortress/Ruins/Castle/Ramparts",
    clauses: [
      'nwr["historic"~"castle|fort|fortress|ruins",i]',
      'nwr["historic"="castle"]',
      'nwr["ruins"="yes"]',
      'nwr["building"~"castle",i]',
      'nwr["name"~"ramparts",i]',
    ],
  },
  {
    key: "lighthouse_landmark",
    label: "Lighthouse/Phare/Landmark",
    clauses: [
      'nwr["man_made"="lighthouse"]',
      'nwr["tourism"="attraction"]["name"~"lighthouse|phare|landmark",i]',
      'nwr["historic"]["name"~"lighthouse|phare|landmark",i]',
    ],
  },
  {
    key: "archaeological_megalithic",
    label: "Archaeological/Megalithic/Prehistoric",
    clauses: [
      'nwr["historic"~"archaeological_site",i]',
      'nwr["site_type"~"megalith|dolmen|menhir|archaeological|prehistoric",i]',
      'nwr["megalith_type"]',
      'nwr["name"~"dolmen|menhir|megalith|prehistoric",i]',
    ],
  },
  {
    key: "memorial_monument",
    label: "Memorial/Historic/Monument",
    clauses: [
      'nwr["historic"~"memorial|monument",i]',
      'nwr["heritage"]',
      'nwr["tourism"="attraction"]["historic"]',
      'nwr["name"~"memorial|monument",i]',
    ],
  },
];

const HIGHLIGHT_NEARBY_QUERY_PARTS: NearbyQueryPart[] = [
  {
    key: "fortress_castle_palace",
    label: "Burg/Festung/Schloss/Zitadelle",
    clauses: [
      'nwr["historic"~"castle|fort|fortress|city_gate",i]',
      'nwr["building"~"castle|palace",i]',
      'nwr["name"~"castle|fort|fortress|citadel|palace|schloss|burg|festung",i]',
      'nwr["tourism"="attraction"]["name"~"schloss|burg|citadel|fortress|festung",i]',
    ],
  },
  {
    key: "abbey_cathedral_monastery",
    label: "Abtei/Kloster/Dom/Kathedrale",
    clauses: [
      'nwr["building"~"abbey|monastery|cathedral",i]',
      'nwr["amenity"="place_of_worship"]["name"~"abbey|abtei|monastery|kloster|cathedral|dom",i]',
      'nwr["tourism"="attraction"]["name"~"abbey|abtei|kloster|cathedral|dom",i]',
    ],
  },
  {
    key: "historic_center_landmark",
    label: "Altstadt/Landmarken/Hauptziele",
    clauses: [
      'nwr["name"~"old town|historic (center|centre)|altstadt|deutsches eck|landmark|icon",i]',
      'nwr["tourism"="attraction"]["name"~"old town|altstadt|deutsches eck|landmark",i]',
      'nwr["historic"~"memorial|monument",i]["name"~"national|major|deutsches eck|denkmal",i]',
    ],
  },
  {
    key: "major_ruins_memorial",
    label: "Bedeutende Ruinen/Gedenkorte",
    clauses: [
      'nwr["historic"="ruins"]["name"~"castle|fort|abbey|monastery|palace|schloss|burg",i]',
      'nwr["ruins"="yes"]["name"~"castle|fort|abbey|monastery|palace|schloss|burg",i]',
      'nwr["historic"~"memorial|monument",i]["wikipedia"]',
      'nwr["historic"~"memorial|monument",i]["wikidata"]',
    ],
  },
  {
    key: "touristic_cable_car",
    label: "Touristische Seilbahn/Funicular",
    clauses: [
      'nwr["aerialway"~"cable_car|gondola",i]["name"]',
      'nwr["railway"="funicular"]["name"]',
      'nwr["aerialway"]["tourism"="attraction"]',
    ],
  },
];

export function getNearbyQueryParts(mode: ImportMode = "default"): NearbyQueryPart[] {
  return mode === "highlight" ? HIGHLIGHT_NEARBY_QUERY_PARTS : NEARBY_QUERY_PARTS;
}

const HIGHLIGHT_NAME_SIGNALS = [
  { pattern: /\b(deutsches\s+eck|deutsche\s+eck)\b/, score: 10 },
  { pattern: /\b(citadel|zitadelle|fortress|festung)\b/, score: 9 },
  { pattern: /\b(castle|schloss|burg|palace)\b/, score: 8 },
  { pattern: /\b(abbey|abtei|monastery|kloster|cathedral|dom)\b/, score: 8 },
  { pattern: /\b(old\s+town|historic\s+(centre|center)|altstadt)\b/, score: 8 },
  { pattern: /\b(landmark|icon|seilbahn|cable\s+car)\b/, score: 5 },
];

const HIGHLIGHT_CATEGORY_SCORES: Record<string, number> = {
  castle_fortress: 14,
  historic_old_town: 13,
  historic_architecture: 11,
  ruins: 9,
  memorial_monument: 7,
  lighthouse: 6,
  landmark: 6,
  viewpoint: 3,
  nature_landmark: 2,
  archaeological_site: 2,
  megalithic_site: 1,
};

const HIGHLIGHT_HARD_EXCLUDES = [/\b(cross|croix|wayside\s+cross|calvaire)\b/, /\b(bench|liege|ruhebank)\b/, /\b(technik|technical|water\s+works|pump\s+station|mast|tower\s+base)\b/];

export function scoreHighlightCandidate(candidate: SightseeingCandidate): number {
  const tagMap = new Map(
    candidate.tags
      .map((entry) => {
        const idx = entry.indexOf(":");
        if (idx === -1) return null;
        return [entry.slice(0, idx), entry.slice(idx + 1)] as const;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry))
  );

  const searchable = normalizeText(
    [candidate.name, candidate.category, ...candidate.tags.map((tag) => tag.replace(":", " "))].join(" ")
  );

  if (HIGHLIGHT_HARD_EXCLUDES.some((pattern) => pattern.test(searchable))) return -999;

  let score = HIGHLIGHT_CATEGORY_SCORES[candidate.category] ?? 0;

  for (const signal of HIGHLIGHT_NAME_SIGNALS) {
    if (signal.pattern.test(searchable)) score += signal.score;
  }

  if (tagMap.has("wikipedia")) score += 7;
  if (tagMap.has("wikidata")) score += 6;
  if (tagMap.get("tourism") === "attraction") score += 2;
  if (tagMap.get("historic") === "ruins") score += 1;

  if (tagMap.get("tourism") === "viewpoint" && !/\b(landmark|castle|fort|citadel|schloss|burg|deutsches\s+eck)\b/.test(searchable)) {
    score -= 7;
  }

  if ((tagMap.get("aerialway") || tagMap.get("railway") === "funicular") && !/(seilbahn|cable\s+car|gondola|funicular|koblenz)/.test(searchable)) {
    score -= 6;
  }

  return score;
}

export function buildOverpassQueryFromClauses(input: {
  region: RegionConfig;
  clauses: string[];
  options?: { bbox?: BoundingBox | null; around?: { lat: number; lng: number; radiusKm: number } | null };
}): string {
  const aroundClause = input.options?.around
    ? `(around:${Math.round(input.options.around.radiusKm * 1_000)},${input.options.around.lat},${input.options.around.lng})`
    : null;

  const bboxClause = input.options?.bbox
    ? `(${input.options.bbox.minLat},${input.options.bbox.minLon},${input.options.bbox.maxLat},${input.options.bbox.maxLon})`
    : aroundClause ?? "(area.searchArea)";

  const areaScope = input.options?.around
    ? ""
    : `area["ISO3166-2"="${input.region.iso3166_2}"]["admin_level"="4"]->.searchArea;\n`;

  const body = input.clauses.map((clause) => `  ${clause}${bboxClause};`).join("\n");

  return `
[out:json][timeout:120];
${areaScope}(
${body}
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
