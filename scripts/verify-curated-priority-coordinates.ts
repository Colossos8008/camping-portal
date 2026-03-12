import { getCuratedPresetCandidates } from "../src/lib/curated-sightseeing-presets";

const PRIORITY_KEYS = [
  "deutsches-eck",
  "festung-ehrenbreitstein",
  "altstadt-koblenz",
  "kurfuerstliches-schloss-koblenz",
  "schloss-stolzenfels",
  "marksburg",
  "abtei-maria-laach",
  "burg-lahneck",
  "schloss-sayn",
  "burg-eltz",
  "geysir-andernach",
  "liebfrauenkirche-koblenz",
  "florinskirche-koblenz",
  "jesuitenplatz",
  "historiensaeule-koblenz",
  "garten-der-schmetterlinge-sayn",
  "kurhaus-bad-ems",
] as const;

const keySet = new Set(PRIORITY_KEYS);

function extractKey(sourceId: string): string {
  const parts = sourceId.split(":");
  return parts[parts.length - 1] ?? sourceId;
}

function main() {
  const candidates = getCuratedPresetCandidates("nievern-highlights");
  const filtered = candidates.filter((row) => keySet.has(extractKey(row.sourceId) as (typeof PRIORITY_KEYS)[number]));

  console.log("key\tname\tlat\tlng");
  for (const row of filtered.sort((a, b) => a.name.localeCompare(b.name, "de"))) {
    console.log(`${extractKey(row.sourceId)}\t${row.name}\t${row.lat}\t${row.lng}`);
  }

  const missing = PRIORITY_KEYS.filter((key) => !filtered.some((row) => extractKey(row.sourceId) === key));
  if (missing.length > 0) {
    console.error(`missing keys: ${missing.join(", ")}`);
    process.exitCode = 1;
  }
}

main();
