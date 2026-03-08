import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCuratedPresetCandidates } from "../src/lib/curated-sightseeing-presets.ts";

type PriorityTarget = {
  key: string;
  name: string;
  query: string;
  requiredNameTerms: string[];
  requiredDisplayTerms?: string[];
  requiredAddressTerms?: string[];
  forbiddenDisplayTerms?: string[];
  preferredClassTypes?: Array<{ className: string; typeName?: string }>;
  strictClassTypes?: Array<{ className: string; typeName?: string }>;
  maxDistanceMeters: number;
  maxDistanceMetersStrict?: number;
  customGuardrail?: (hit: NominatimHit) => boolean;
};

type NominatimHit = {
  place_id?: number;
  display_name?: string;
  lat?: string;
  lon?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  category?: string;
  name?: string;
  importance?: number;
};

const CURATED_FILE = "src/lib/curated-sightseeing-presets.ts";

const PRIORITY_TARGETS: PriorityTarget[] = [
  {
    key: "deutsches-eck",
    name: "Deutsches Eck",
    query: "Deutsches Eck, Koblenz",
    requiredNameTerms: ["deutsches", "eck"],
    requiredDisplayTerms: ["koblenz"],
    preferredClassTypes: [{ className: "tourism" }, { className: "historic" }, { className: "leisure" }],
    maxDistanceMeters: 2_000,
  },
  {
    key: "altstadt-koblenz",
    name: "Altstadt Koblenz",
    query: "Altstadt Koblenz",
    requiredNameTerms: ["altstadt"],
    requiredDisplayTerms: ["koblenz"],
    requiredAddressTerms: ["koblenz"],
    forbiddenDisplayTerms: ["strasse", "straße", "weg", "haus", "hotel", "parkplatz"],
    strictClassTypes: [
      { className: "boundary", typeName: "administrative" },
      { className: "place", typeName: "suburb" },
      { className: "place", typeName: "quarter" },
      { className: "place", typeName: "neighbourhood" },
    ],
    maxDistanceMeters: 2_500,
    maxDistanceMetersStrict: 1_800,
    customGuardrail: (hit) => {
      const label = normalize(String(hit.display_name ?? ""));
      return label.includes("altstadt") && (label.includes("koblenz") || label.includes("mitte"));
    },
  },
  {
    key: "kurfuerstliches-schloss-koblenz",
    name: "Kurfürstliches Schloss Koblenz",
    query: "Kurfürstliches Schloss Koblenz",
    requiredNameTerms: ["schloss"],
    requiredDisplayTerms: ["koblenz"],
    strictClassTypes: [{ className: "historic", typeName: "castle" }, { className: "tourism", typeName: "attraction" }],
    maxDistanceMeters: 1_500,
  },
  {
    key: "marksburg",
    name: "Marksburg",
    query: "Marksburg Braubach",
    requiredNameTerms: ["marksburg"],
    requiredDisplayTerms: ["braubach"],
    strictClassTypes: [{ className: "historic", typeName: "castle" }, { className: "tourism", typeName: "attraction" }],
    maxDistanceMeters: 1_500,
  },
  {
    key: "burg-lahneck",
    name: "Burg Lahneck",
    query: "Burg Lahneck Lahnstein",
    requiredNameTerms: ["burg", "lahneck"],
    requiredDisplayTerms: ["lahnstein"],
    strictClassTypes: [{ className: "historic", typeName: "castle" }, { className: "tourism", typeName: "attraction" }],
    maxDistanceMeters: 1_500,
  },
  {
    key: "geysir-andernach",
    name: "Geysir Andernach",
    query: "Geysir Andernach",
    requiredNameTerms: ["geysir"],
    requiredDisplayTerms: ["andernach"],
    forbiddenDisplayTerms: ["strasse", "straße", "weg", "parkplatz", "bahnhof"],
    strictClassTypes: [
      { className: "tourism", typeName: "attraction" },
      { className: "amenity", typeName: "museum" },
      { className: "natural", typeName: "geyser" },
    ],
    maxDistanceMeters: 1_200,
    customGuardrail: (hit) => {
      const label = normalize(String(hit.display_name ?? ""));
      return label.includes("geysir") && (label.includes("erlebniszentrum") || label.includes("attraction") || label.includes("museum") || label.includes("andernach"));
    },
  },
  {
    key: "liebfrauenkirche-koblenz",
    name: "Liebfrauenkirche Koblenz",
    query: "Liebfrauenkirche Koblenz",
    requiredNameTerms: ["liebfrauenkirche"],
    requiredDisplayTerms: ["koblenz"],
    strictClassTypes: [{ className: "amenity", typeName: "place_of_worship" }, { className: "building", typeName: "church" }],
    maxDistanceMeters: 1_500,
  },
  {
    key: "jesuitenplatz",
    name: "Jesuitenplatz",
    query: "Jesuitenplatz Koblenz",
    requiredNameTerms: ["jesuitenplatz"],
    requiredDisplayTerms: ["koblenz"],
    forbiddenDisplayTerms: ["strasse", "straße", "weg", "hausnummer"],
    strictClassTypes: [{ className: "highway", typeName: "pedestrian" }, { className: "place", typeName: "square" }],
    maxDistanceMeters: 1_500,
  },
  {
    key: "kurhaus-bad-ems",
    name: "Kurhaus Bad Ems",
    query: "Kurhaus Bad Ems",
    requiredNameTerms: ["kurhaus"],
    requiredDisplayTerms: ["bad ems"],
    forbiddenDisplayTerms: ["strasse", "straße", "weg", "parkplatz", "bahnhof"],
    strictClassTypes: [{ className: "historic", typeName: "building" }, { className: "tourism", typeName: "attraction" }, { className: "building" }],
    maxDistanceMeters: 900,
    customGuardrail: (hit) => {
      const label = normalize(String(hit.display_name ?? ""));
      return label.includes("kurhaus") && label.includes("bad ems");
    },
  },
];

const REJECT_CLASS_TYPES = [
  { className: "highway", typeName: "residential" },
  { className: "highway", typeName: "service" },
  { className: "highway", typeName: "tertiary" },
  { className: "highway", typeName: "secondary" },
  { className: "railway" },
  { className: "route" },
  { className: "landuse" },
  { className: "shop" },
];

function matchesClassType(hit: NominatimHit, matcher: { className: string; typeName?: string }): boolean {
  const hitClass = normalize(String(hit.class ?? hit.category ?? ""));
  const hitType = normalize(String(hit.type ?? hit.addresstype ?? ""));
  const className = normalize(matcher.className);
  const typeName = matcher.typeName ? normalize(matcher.typeName) : "";

  if (hitClass !== className) return false;
  if (!typeName) return true;
  return hitType === typeName;
}

function normalize(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const earthRadius = 6_371_000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

function parseArgs(argv: string[]): { apply: boolean } {
  return { apply: argv.includes("--apply") };
}

async function searchViaNominatim(query: string): Promise<NominatimHit[]> {
  const url =
    "https://nominatim.openstreetmap.org/search" +
    `?format=jsonv2` +
    `&q=${encodeURIComponent(query)}` +
    `&addressdetails=1` +
    `&limit=6` +
    `&accept-language=de`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "camping-portal-curated-osm-assist/1.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim request failed for \"${query}\" with status ${response.status}`);
  }

  const payload = (await response.json().catch(() => [])) as unknown;
  return Array.isArray(payload) ? (payload as NominatimHit[]) : [];
}

function isHitSafe(target: PriorityTarget, hit: NominatimHit, currentLat: number, currentLng: number): boolean {
  const lat = Number(hit.lat);
  const lng = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;

  const label = normalize(String(hit.display_name ?? ""));
  if (!label) return false;

  for (const term of target.requiredNameTerms) {
    if (!label.includes(normalize(term))) return false;
  }

  for (const term of target.requiredDisplayTerms ?? []) {
    if (!label.includes(normalize(term))) return false;
  }

  for (const term of target.requiredAddressTerms ?? []) {
    if (!label.includes(normalize(term))) return false;
  }

  for (const term of target.forbiddenDisplayTerms ?? []) {
    if (label.includes(normalize(term))) return false;
  }

  if (REJECT_CLASS_TYPES.some((matcher) => matchesClassType(hit, matcher))) {
    return false;
  }

  if (target.strictClassTypes && !target.strictClassTypes.some((matcher) => matchesClassType(hit, matcher))) {
    return false;
  }

  const distance = distanceMeters(currentLat, currentLng, lat, lng);
  const maxDistance = target.maxDistanceMetersStrict ?? target.maxDistanceMeters;
  if (distance > maxDistance) return false;

  if (target.customGuardrail && !target.customGuardrail(hit)) return false;

  return true;
}

function scoreHit(target: PriorityTarget, hit: NominatimHit): number {
  let score = 0;
  const label = normalize(String(hit.display_name ?? ""));
  const hitName = normalize(String(hit.name ?? ""));
  const importance = Number(hit.importance ?? 0);

  if (target.preferredClassTypes?.some((matcher) => matchesClassType(hit, matcher))) {
    score += 15;
  }

  if (target.strictClassTypes?.some((matcher) => matchesClassType(hit, matcher))) {
    score += 25;
  }

  for (const term of target.requiredNameTerms) {
    const normalizedTerm = normalize(term);
    if (hitName.includes(normalizedTerm)) {
      score += 20;
    } else if (label.includes(normalizedTerm)) {
      score += 8;
    }
  }

  score += Math.round(Math.max(0, importance) * 10);
  return score;
}

function applyCoordinateUpdate(content: string, key: string, lat: number, lng: number): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(key: \"${escapedKey}\"[^\\n]*?lat:\\s*)(-?\\d+(?:\\.\\d+)?)(,\\s*lng:\\s*)(-?\\d+(?:\\.\\d+)?)`);
  if (!pattern.test(content)) {
    throw new Error(`Could not locate curated row for key=${key} in ${CURATED_FILE}`);
  }
  return content.replace(pattern, `$1${lat.toFixed(6)}$3${lng.toFixed(6)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const curated = getCuratedPresetCandidates("nievern-highlights");
  const byKey = new Map(curated.map((entry) => [entry.sourceId.split(":").at(-1) ?? "", entry]));

  const changes: Array<{ key: string; name: string; oldLat: number; oldLng: number; newLat: number; newLng: number; displayName: string }> = [];
  const skipped: Array<{ key: string; reason: string }> = [];

  for (const target of PRIORITY_TARGETS) {
    const current = byKey.get(target.key);
    if (!current) {
      skipped.push({ key: target.key, reason: "missing-curated-row" });
      continue;
    }

    try {
      const hits = await searchViaNominatim(target.query);
      const safeHit = hits
        .filter((hit) => isHitSafe(target, hit, current.lat, current.lng))
        .sort((a, b) => scoreHit(target, b) - scoreHit(target, a))[0];

      if (!safeHit || safeHit.lat == null || safeHit.lon == null) {
        skipped.push({ key: target.key, reason: "no-safe-osm-hit" });
        continue;
      }

      changes.push({
        key: target.key,
        name: target.name,
        oldLat: current.lat,
        oldLng: current.lng,
        newLat: Number(safeHit.lat),
        newLng: Number(safeHit.lon),
        displayName: String(safeHit.display_name ?? ""),
      });
    } catch (error: any) {
      skipped.push({ key: target.key, reason: `lookup-error:${String(error?.message ?? error)}` });
    }
  }

  if (args.apply && changes.length > 0) {
    let content = readFileSync(resolve(CURATED_FILE), "utf8");
    for (const row of changes) {
      content = applyCoordinateUpdate(content, row.key, row.newLat, row.newLng);
    }
    writeFileSync(resolve(CURATED_FILE), content, "utf8");
  }

  console.log(JSON.stringify({
    mode: args.apply ? "apply" : "verify",
    changed: changes,
    skipped,
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
