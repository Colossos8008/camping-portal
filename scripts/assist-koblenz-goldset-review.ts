import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCuratedPresetCandidates } from "../src/lib/curated-sightseeing-presets.ts";

type NominatimHit = { display_name?: string; lat?: string; lon?: string; class?: string; type?: string; category?: string; addresstype?: string; importance?: number };
type GoldTarget = { key: string; name: string; query: string; mode: "EXACT" | "AREA_ANCHOR" | "COMPLEX_SITE" | "VIEWPOINT"; sourceNote: string; anchorNote?: string };
type CliArgs = { key: string | null; pick?: number; apply: boolean; limit: number };

const CURATED_FILE = "src/lib/curated-sightseeing-presets.ts";
const REVIEWED = "REVIEWED";

const KOBLENZ_GOLD_SET: GoldTarget[] = [
  { key: "deutsches-eck", name: "Deutsches Eck", query: "Deutsches Eck Koblenz", mode: "VIEWPOINT", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "festung-ehrenbreitstein", name: "Festung Ehrenbreitstein", query: "Festung Ehrenbreitstein Koblenz", mode: "COMPLEX_SITE", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "altstadt-koblenz", name: "Altstadt Koblenz", query: "Jesuitenplatz Koblenz", mode: "AREA_ANCHOR", sourceNote: "Altstadt anchor via Jesuitenplatz", anchorNote: "Altstadt ist eine Fläche; als stabiler und sichtbarer Anker wird das Platzzentrum Jesuitenplatz genutzt." },
  { key: "kurfuerstliches-schloss-koblenz", name: "Kurfürstliches Schloss Koblenz", query: "Kurfürstliches Schloss Koblenz", mode: "COMPLEX_SITE", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "schloss-stolzenfels", name: "Schloss Stolzenfels", query: "Schloss Stolzenfels Koblenz", mode: "COMPLEX_SITE", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "marksburg", name: "Marksburg", query: "Marksburg Braubach", mode: "COMPLEX_SITE", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "burg-lahneck", name: "Burg Lahneck", query: "Burg Lahneck Lahnstein", mode: "COMPLEX_SITE", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "liebfrauenkirche-koblenz", name: "Liebfrauenkirche Koblenz", query: "Liebfrauenkirche Koblenz", mode: "EXACT", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "florinskirche-koblenz", name: "Florinskirche Koblenz", query: "Florinskirche Koblenz", mode: "EXACT", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "jesuitenplatz", name: "Jesuitenplatz", query: "Jesuitenplatz Koblenz", mode: "AREA_ANCHOR", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "historiensaeule-koblenz", name: "Historiensäule Koblenz", query: "Historiensäule Koblenz", mode: "EXACT", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "schloss-sayn", name: "Schloss Sayn", query: "Schloss Sayn Bendorf", mode: "COMPLEX_SITE", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "garten-der-schmetterlinge-sayn", name: "Garten der Schmetterlinge Schloss Sayn", query: "Garten der Schmetterlinge Sayn", mode: "EXACT", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "kurhaus-bad-ems", name: "Kurhaus Bad Ems", query: "Kurhaus Bad Ems", mode: "EXACT", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "geysir-andernach", name: "Geysir Andernach", query: "Geysir Andernach", mode: "VIEWPOINT", sourceNote: "OSM/Nominatim Gold-Set review" },
  { key: "burg-eltz", name: "Burg Eltz", query: "Burg Eltz Wierschem", mode: "COMPLEX_SITE", sourceNote: "OSM/Nominatim Gold-Set review" },
];

const OFFLINE: Record<string, NominatimHit[]> = {
  "deutsches-eck": [
    { display_name: "Deutsches Eck, Koblenz", lat: "50.367088", lon: "7.606152", class: "tourism", type: "attraction", importance: 0.92 },
    { display_name: "Kaiser-Wilhelm-Denkmal, Koblenz", lat: "50.366993", lon: "7.606258", class: "historic", type: "monument", importance: 0.74 },
  ],
  "festung-ehrenbreitstein": [
    { display_name: "Festung Ehrenbreitstein, Koblenz", lat: "50.365253", lon: "7.613802", class: "historic", type: "fort", importance: 0.89 },
    { display_name: "Festung Ehrenbreitstein Bergstation, Koblenz", lat: "50.364728", lon: "7.614606", class: "tourism", type: "attraction", importance: 0.62 },
  ],
  "altstadt-koblenz": [
    { display_name: "Jesuitenplatz, Koblenz", lat: "50.358938", lon: "7.595986", class: "highway", type: "pedestrian", importance: 0.68 },
    { display_name: "Münzplatz, Koblenz", lat: "50.360087", lon: "7.596131", class: "highway", type: "pedestrian", importance: 0.66 },
  ],
  "kurfuerstliches-schloss-koblenz": [
    { display_name: "Kurfürstliches Schloss, Koblenz", lat: "50.350853", lon: "7.603035", class: "historic", type: "castle", importance: 0.8 },
    { display_name: "Schlossgarten am Kurfürstlichen Schloss, Koblenz", lat: "50.351255", lon: "7.602265", class: "leisure", type: "park", importance: 0.52 },
  ],
  "schloss-stolzenfels": [
    { display_name: "Schloss Stolzenfels, Koblenz", lat: "50.303626", lon: "7.571243", class: "historic", type: "castle", importance: 0.78 },
    { display_name: "Schlosspark Stolzenfels, Koblenz", lat: "50.303931", lon: "7.570744", class: "leisure", type: "park", importance: 0.49 },
  ],
  "marksburg": [
    { display_name: "Marksburg, Braubach", lat: "50.274444", lon: "7.641706", class: "historic", type: "castle", importance: 0.85 },
    { display_name: "Braubach Altstadt", lat: "50.275419", lon: "7.642591", class: "place", type: "suburb", importance: 0.44 },
  ],
  "burg-lahneck": [
    { display_name: "Burg Lahneck, Lahnstein", lat: "50.311813", lon: "7.618236", class: "historic", type: "castle", importance: 0.71 },
    { display_name: "Lahneck Aussichtspunkt", lat: "50.311393", lon: "7.617597", class: "tourism", type: "viewpoint", importance: 0.47 },
  ],
  "liebfrauenkirche-koblenz": [
    { display_name: "Liebfrauenkirche, Koblenz", lat: "50.359206", lon: "7.595373", class: "amenity", type: "place_of_worship", importance: 0.72 },
    { display_name: "Florinsmarkt, Koblenz", lat: "50.360559", lon: "7.596277", class: "highway", type: "pedestrian", importance: 0.54 },
  ],
  "florinskirche-koblenz": [
    { display_name: "Florinskirche, Koblenz", lat: "50.360640", lon: "7.596327", class: "amenity", type: "place_of_worship", importance: 0.69 },
    { display_name: "Florinsmarkt, Koblenz", lat: "50.360559", lon: "7.596277", class: "highway", type: "pedestrian", importance: 0.54 },
  ],
  "jesuitenplatz": [
    { display_name: "Jesuitenplatz, Koblenz", lat: "50.358938", lon: "7.595986", class: "highway", type: "pedestrian", importance: 0.68 },
    { display_name: "Rathaus Koblenz", lat: "50.358791", lon: "7.596126", class: "amenity", type: "townhall", importance: 0.52 },
  ],
  "historiensaeule-koblenz": [
    { display_name: "Historiensäule, Koblenz", lat: "50.358550", lon: "7.596370", class: "tourism", type: "artwork", importance: 0.62 },
    { display_name: "Görresplatz, Koblenz", lat: "50.358632", lon: "7.596324", class: "highway", type: "pedestrian", importance: 0.58 },
  ],
  "schloss-sayn": [
    { display_name: "Schloss Sayn, Bendorf", lat: "50.437316", lon: "7.576603", class: "historic", type: "castle", importance: 0.74 },
    { display_name: "Schlosspark Sayn, Bendorf", lat: "50.437050", lon: "7.576850", class: "leisure", type: "park", importance: 0.51 },
  ],
  "garten-der-schmetterlinge-sayn": [
    { display_name: "Garten der Schmetterlinge Schloss Sayn", lat: "50.436574", lon: "7.577309", class: "tourism", type: "attraction", importance: 0.69 },
    { display_name: "Schlosspark Sayn", lat: "50.437050", lon: "7.576850", class: "leisure", type: "park", importance: 0.51 },
  ],
  "kurhaus-bad-ems": [
    { display_name: "Kurhaus Bad Ems", lat: "50.335515", lon: "7.713234", class: "building", type: "hotel", importance: 0.67 },
    { display_name: "Kurpark Bad Ems", lat: "50.334700", lon: "7.715800", class: "leisure", type: "park", importance: 0.56 },
  ],
  "geysir-andernach": [
    { display_name: "Geysir-Erlebniszentrum Andernach", lat: "50.434896", lon: "7.404471", class: "tourism", type: "attraction", importance: 0.75 },
    { display_name: "Namedyer Werth (Geysir-Areal)", lat: "50.446860", lon: "7.452450", class: "natural", type: "islet", importance: 0.52 },
  ],
  "burg-eltz": [
    { display_name: "Burg Eltz, Wierschem", lat: "50.205422", lon: "7.336593", class: "historic", type: "castle", importance: 0.9 },
    { display_name: "Besucherparkplatz Burg Eltz", lat: "50.207398", lon: "7.340882", class: "amenity", type: "parking", importance: 0.55 },
  ],
};

function parseArgs(argv: string[]): CliArgs {
  const key = String(argv.find((a) => a.startsWith("--key=")) ?? "").replace("--key=", "").trim() || null;
  const pickRaw = String(argv.find((a) => a.startsWith("--pick=")) ?? "").replace("--pick=", "").trim();
  const limitRaw = String(argv.find((a) => a.startsWith("--limit=")) ?? "").replace("--limit=", "").trim();
  const pick = pickRaw ? Number(pickRaw) : undefined;
  const limit = limitRaw ? Number(limitRaw) : 7;
  if (pickRaw && (!Number.isInteger(pick) || Number(pick) < 1)) throw new Error("--pick must be positive integer.");
  if (!Number.isInteger(limit) || limit < 2 || limit > 15) throw new Error("--limit must be 2..15.");
  return { key, pick, apply: argv.includes("--apply"), limit };
}

const toRad = (v: number) => (v * Math.PI) / 180;
const distanceMeters = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const R = 6_371_000;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

function normalize(s: string): string { return s.normalize("NFKD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim(); }
function nameSimilarity(a: string, b: string): number {
  const A = new Set(normalize(a).split(" ").filter((x) => x.length >= 3));
  const B = new Set(normalize(b).split(" ").filter((x) => x.length >= 3));
  if (!A.size || !B.size) return 0;
  let overlap = 0; for (const t of A) if (B.has(t)) overlap += 1;
  return overlap / new Set([...A, ...B]).size;
}

async function searchOnline(query: string, limit: number): Promise<NominatimHit[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&addressdetails=1&limit=${limit}&accept-language=de`;
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "camping-portal-koblenz-goldset-review/1.0" } });
  if (!res.ok) throw new Error(`status ${res.status}`);
  const payload = (await res.json().catch(() => [])) as unknown;
  return Array.isArray(payload) ? (payload as NominatimHit[]) : [];
}

const toConfidence = (score: number) => (score >= 0.9 ? 0.98 : score >= 0.8 ? 0.94 : score >= 0.7 ? 0.88 : 0.8);
function updateOrInsertField(row: string, field: string, value: string): string {
  const p = new RegExp(`\\b${field}:\\s*[^,}]+`);
  return p.test(row) ? row.replace(p, `${field}: ${value}`) : row.replace(/\s*},\s*$/, `, ${field}: ${value} },`);
}

function applyRowUpdate(content: string, input: { key: string; lat: number; lng: number; coordinateMode: GoldTarget["mode"]; coordinateSource: string; coordinateConfidence: number; reviewState: string; sourceNotes: string; anchorNote?: string; }) {
  const key = input.key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rowPattern = new RegExp(`^\\s*\\{\\s*key:\\s*"${key}"[^\\n]*$`, "m");
  const match = content.match(rowPattern)?.[0];
  if (!match) throw new Error(`Cannot locate curated row: ${input.key}`);
  let row = match;
  row = updateOrInsertField(row, "lat", input.lat.toFixed(6));
  row = updateOrInsertField(row, "lng", input.lng.toFixed(6));
  row = updateOrInsertField(row, "coordinateMode", JSON.stringify(input.coordinateMode));
  row = updateOrInsertField(row, "coordinateSource", JSON.stringify(input.coordinateSource));
  row = updateOrInsertField(row, "coordinateConfidence", input.coordinateConfidence.toFixed(2));
  row = updateOrInsertField(row, "reviewState", JSON.stringify(input.reviewState));
  row = updateOrInsertField(row, "sourceNotes", JSON.stringify(input.sourceNotes));
  if (input.anchorNote) row = updateOrInsertField(row, "anchorNote", JSON.stringify(input.anchorNote));
  return content.replace(rowPattern, row);
}

async function reviewTarget(target: GoldTarget, curatedPoint: { lat: number; lng: number }, limit: number) {
  let hits: NominatimHit[] = [];
  let source = "online-nominatim";
  try { hits = await searchOnline(target.query, limit); } catch { hits = OFFLINE[target.key] ?? []; source = "offline-fallback"; }
  if (!hits.length) { hits = OFFLINE[target.key] ?? []; source = "offline-fallback"; }

  const candidates = hits.map((hit, idx) => {
    const lat = Number(hit.lat), lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    const similarity = nameSimilarity(target.name, String(hit.display_name ?? ""));
    const importance = Number(hit.importance ?? 0);
    const dist = Math.round(distanceMeters(curatedPoint.lat, curatedPoint.lng, lat, lng));
    const distScore = Math.max(0, 1 - Math.min(dist, 5000) / 5000);
    const score = Number((similarity * 0.55 + importance * 0.25 + distScore * 0.2).toFixed(3));
    return { pick: idx + 1, lat, lng, display_name: String(hit.display_name ?? ""), class: String(hit.class ?? hit.category ?? ""), type: String(hit.type ?? hit.addresstype ?? ""), importance, distance_to_current_m: dist, score, source_notes: `${source}; nameSim=${similarity.toFixed(2)}; dist=${dist}m` };
  }).filter((x): x is NonNullable<typeof x> => Boolean(x)).sort((a, b) => b.score - a.score || a.distance_to_current_m - b.distance_to_current_m);

  return { target, curatedPoint, candidates };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const curated = getCuratedPresetCandidates("nievern-highlights");
  const byKey = new Map(curated.map((e) => [e.sourceId.split(":").at(-1) ?? "", e]));
  const targets = args.key ? KOBLENZ_GOLD_SET.filter((t) => t.key === args.key) : KOBLENZ_GOLD_SET;
  if (!targets.length) throw new Error(`Unknown key=${args.key}`);

  const reviews = [] as Array<Awaited<ReturnType<typeof reviewTarget>>>;
  for (const t of targets) {
    const row = byKey.get(t.key); if (!row) throw new Error(`Missing curated key=${t.key}`);
    reviews.push(await reviewTarget(t, { lat: row.lat, lng: row.lng }, args.limit));
  }

  if (args.apply) {
    if (!args.key || args.pick == null) throw new Error("--apply requires --key and --pick");
    const review = reviews[0];
    const chosen = review.candidates.find((c) => c.pick === args.pick);
    if (!chosen) throw new Error(`Pick ${args.pick} invalid for ${args.key}`);
    let content = readFileSync(resolve(CURATED_FILE), "utf8");
    const confidence = toConfidence(chosen.score);
    content = applyRowUpdate(content, {
      key: review.target.key, lat: chosen.lat, lng: chosen.lng, coordinateMode: review.target.mode,
      coordinateSource: "nominatim-osm", coordinateConfidence: confidence, reviewState: REVIEWED,
      sourceNotes: `${review.target.sourceNote}; ${chosen.source_notes}`, anchorNote: review.target.anchorNote,
    });
    writeFileSync(resolve(CURATED_FILE), content, "utf8");
    console.log(JSON.stringify({ mode: "applied", key: review.target.key, picked: chosen, governance: { coordinateSource: "nominatim-osm", coordinateConfidence: confidence, coordinateMode: review.target.mode, reviewState: REVIEWED, anchorNote: review.target.anchorNote ?? null } }, null, 2));
    return;
  }

  console.log(JSON.stringify({ mode: "inspect", set: "koblenz-gold-set", reviews: reviews.map((r) => ({ key: r.target.key, name: r.target.name, query: r.target.query, coordinateMode: r.target.mode, curated_point: r.curatedPoint, anchor_note: r.target.anchorNote ?? null, candidates: r.candidates })) }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
