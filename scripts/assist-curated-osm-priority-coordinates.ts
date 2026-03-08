import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCuratedPresetCandidates } from "../src/lib/curated-sightseeing-presets.ts";

type PriorityTarget = {
  key: string;
  name: string;
  query: string;
  requiredNameTerms: string[];
  requiredDisplayTerms?: string[];
  maxDistanceMeters: number;
};

type NominatimHit = {
  place_id?: number;
  display_name?: string;
  lat?: string;
  lon?: string;
};

const CURATED_FILE = "src/lib/curated-sightseeing-presets.ts";

const PRIORITY_TARGETS: PriorityTarget[] = [
  { key: "deutsches-eck", name: "Deutsches Eck", query: "Deutsches Eck, Koblenz", requiredNameTerms: ["deutsches", "eck"], requiredDisplayTerms: ["koblenz"], maxDistanceMeters: 2_500 },
  { key: "altstadt-koblenz", name: "Altstadt Koblenz", query: "Altstadt Koblenz", requiredNameTerms: ["altstadt"], requiredDisplayTerms: ["koblenz"], maxDistanceMeters: 3_000 },
  { key: "kurfuerstliches-schloss-koblenz", name: "Kurfürstliches Schloss Koblenz", query: "Kurfürstliches Schloss Koblenz", requiredNameTerms: ["schloss"], requiredDisplayTerms: ["koblenz"], maxDistanceMeters: 2_500 },
  { key: "marksburg", name: "Marksburg", query: "Marksburg Braubach", requiredNameTerms: ["marksburg"], requiredDisplayTerms: ["braubach"], maxDistanceMeters: 2_500 },
  { key: "burg-lahneck", name: "Burg Lahneck", query: "Burg Lahneck Lahnstein", requiredNameTerms: ["burg", "lahneck"], requiredDisplayTerms: ["lahnstein"], maxDistanceMeters: 2_500 },
  { key: "geysir-andernach", name: "Geysir Andernach", query: "Geysir Andernach", requiredNameTerms: ["geysir"], requiredDisplayTerms: ["andernach"], maxDistanceMeters: 5_000 },
  { key: "liebfrauenkirche-koblenz", name: "Liebfrauenkirche Koblenz", query: "Liebfrauenkirche Koblenz", requiredNameTerms: ["liebfrauenkirche"], requiredDisplayTerms: ["koblenz"], maxDistanceMeters: 2_500 },
  { key: "jesuitenplatz", name: "Jesuitenplatz", query: "Jesuitenplatz Koblenz", requiredNameTerms: ["jesuitenplatz"], requiredDisplayTerms: ["koblenz"], maxDistanceMeters: 2_500 },
  { key: "kurhaus-bad-ems", name: "Kurhaus Bad Ems", query: "Kurhaus Bad Ems", requiredNameTerms: ["kurhaus"], requiredDisplayTerms: ["bad ems"], maxDistanceMeters: 2_500 },
];

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

  const distance = distanceMeters(currentLat, currentLng, lat, lng);
  if (distance > target.maxDistanceMeters) return false;

  return true;
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
      const safeHit = hits.find((hit) => isHitSafe(target, hit, current.lat, current.lng));

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
