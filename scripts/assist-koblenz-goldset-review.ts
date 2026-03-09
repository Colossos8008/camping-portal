import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCuratedPresetCandidates } from "../src/lib/curated-sightseeing-presets.ts";

type CoordinateMode = "EXACT" | "AREA_ANCHOR" | "COMPLEX_SITE" | "VIEWPOINT" | "ENTRANCE_POINT";
type ReviewState = "AUTO_ACCEPT" | "MANUAL_REVIEW";

type GoldTarget = {
  key: string;
  name: string;
  wikidataId?: string;
  wikidataLabelHint?: string;
  googleQuery: string;
  mode: CoordinateMode;
  anchorNote?: string;
};

type Coordinates = { lat: number; lng: number };
type SourceCandidate = Coordinates & { label: string; sourceId: string };
type CliArgs = { key: string | null; apply: boolean; online: boolean; limit: number };

type NominatimHit = { display_name?: string; lat?: string; lon?: string; osm_id?: string | number; osm_type?: string; importance?: number };
type WikidataHit = { id: string; label: string; description?: string };
type GooglePlaceHit = { id: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number } };

const CURATED_FILE = "src/lib/curated-sightseeing-presets.ts";
const PRESET = "nievern-highlights";
const MAX_DISTANCE_FOR_AUTO_ACCEPT_M = 250;

const GOLD_SET: GoldTarget[] = [
  { key: "deutsches-eck", name: "Deutsches Eck", wikidataId: "Q698646", googleQuery: "Deutsches Eck Koblenz", mode: "VIEWPOINT" },
  { key: "festung-ehrenbreitstein", name: "Festung Ehrenbreitstein", wikidataId: "Q1438023", googleQuery: "Festung Ehrenbreitstein Koblenz", mode: "COMPLEX_SITE" },
  { key: "altstadt-koblenz", name: "Altstadt Koblenz", wikidataId: "Q1045186", wikidataLabelHint: "Altstadt", googleQuery: "Jesuitenplatz Koblenz", mode: "AREA_ANCHOR", anchorNote: "Altstadt ist eine Fläche; als stabiler Ankerpunkt wird Jesuitenplatz genutzt (kein Fake-Exaktpunkt)." },
  { key: "kurfuerstliches-schloss-koblenz", name: "Kurfürstliches Schloss Koblenz", wikidataId: "Q2309636", googleQuery: "Kurfürstliches Schloss Koblenz", mode: "COMPLEX_SITE" },
  { key: "schloss-stolzenfels", name: "Schloss Stolzenfels", wikidataId: "Q694322", googleQuery: "Schloss Stolzenfels Koblenz", mode: "COMPLEX_SITE" },
  { key: "marksburg", name: "Marksburg", wikidataId: "Q689959", googleQuery: "Marksburg Braubach", mode: "COMPLEX_SITE" },
  { key: "burg-lahneck", name: "Burg Lahneck", wikidataId: "Q1011657", googleQuery: "Burg Lahneck Lahnstein", mode: "COMPLEX_SITE" },
  { key: "liebfrauenkirche-koblenz", name: "Liebfrauenkirche Koblenz", wikidataId: "Q1821008", googleQuery: "Liebfrauenkirche Koblenz", mode: "EXACT" },
  { key: "florinskirche-koblenz", name: "Florinskirche Koblenz", wikidataId: "Q1428776", googleQuery: "Florinskirche Koblenz", mode: "EXACT" },
  { key: "jesuitenplatz", name: "Jesuitenplatz", wikidataId: "Q61788631", googleQuery: "Jesuitenplatz Koblenz", mode: "AREA_ANCHOR" },
  { key: "historiensaeule-koblenz", name: "Historiensäule Koblenz", wikidataId: "Q1585197", googleQuery: "Historiensäule Koblenz", mode: "EXACT" },
  { key: "schloss-sayn", name: "Schloss Sayn", wikidataId: "Q2246760", googleQuery: "Schloss Sayn Bendorf", mode: "COMPLEX_SITE" },
  { key: "garten-der-schmetterlinge-sayn", name: "Garten der Schmetterlinge Schloss Sayn", wikidataId: "Q55257790", googleQuery: "Garten der Schmetterlinge Sayn", mode: "EXACT" },
  { key: "kurhaus-bad-ems", name: "Kurhaus Bad Ems", wikidataId: "Q19865440", googleQuery: "Kurhaus Bad Ems", mode: "EXACT" },
  { key: "geysir-andernach", name: "Geysir Andernach", wikidataId: "Q699893", googleQuery: "Geysir Andernach Besucherzentrum", mode: "VIEWPOINT", anchorNote: "Besuchspunkt (Visitor-/Boots-Start) statt Objektpunkt in der Naturschutzfläche." },
  { key: "burg-eltz", name: "Burg Eltz", wikidataId: "Q668160", googleQuery: "Burg Eltz", mode: "COMPLEX_SITE" },
];

const OSM_OFFLINE: Record<string, SourceCandidate> = {
  "deutsches-eck": { lat: 50.367088, lng: 7.606152, label: "Deutsches Eck, Koblenz", sourceId: "osm:node/29160745" },
  "festung-ehrenbreitstein": { lat: 50.365253, lng: 7.613802, label: "Festung Ehrenbreitstein", sourceId: "osm:way/41737967" },
  "altstadt-koblenz": { lat: 50.358938, lng: 7.595986, label: "Jesuitenplatz", sourceId: "osm:way/34401166" },
  "kurfuerstliches-schloss-koblenz": { lat: 50.350853, lng: 7.603035, label: "Kurfürstliches Schloss", sourceId: "osm:way/38920860" },
  "schloss-stolzenfels": { lat: 50.303626, lng: 7.571243, label: "Schloss Stolzenfels", sourceId: "osm:way/100863980" },
  "marksburg": { lat: 50.274444, lng: 7.641706, label: "Marksburg", sourceId: "osm:way/131570312" },
  "burg-lahneck": { lat: 50.311813, lng: 7.618236, label: "Burg Lahneck", sourceId: "osm:way/136573940" },
  "liebfrauenkirche-koblenz": { lat: 50.359206, lng: 7.595373, label: "Liebfrauenkirche", sourceId: "osm:way/153896915" },
  "florinskirche-koblenz": { lat: 50.359454, lng: 7.596059, label: "Florinskirche", sourceId: "osm:way/106344917" },
  "jesuitenplatz": { lat: 50.358938, lng: 7.595986, label: "Jesuitenplatz", sourceId: "osm:way/34401166" },
  "historiensaeule-koblenz": { lat: 50.359694, lng: 7.595828, label: "Historiensäule", sourceId: "osm:node/3787909778" },
  "schloss-sayn": { lat: 50.437428, lng: 7.576671, label: "Schloss Sayn", sourceId: "osm:way/65464883" },
  "garten-der-schmetterlinge-sayn": { lat: 50.436574, lng: 7.577309, label: "Garten der Schmetterlinge", sourceId: "osm:way/48838749" },
  "kurhaus-bad-ems": { lat: 50.335515, lng: 7.713234, label: "Kurhaus Bad Ems", sourceId: "osm:way/36908904" },
  "geysir-andernach": { lat: 50.434896, lng: 7.404471, label: "Geysir Andernach", sourceId: "osm:node/2604143031" },
  "burg-eltz": { lat: 50.205422, lng: 7.336593, label: "Burg Eltz", sourceId: "osm:way/27019170" },
};

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { key: null, apply: false, online: false, limit: 5 };
  for (const arg of argv) {
    if (arg.startsWith("--key=")) out.key = arg.slice(6).trim() || null;
    else if (arg === "--apply") out.apply = true;
    else if (arg === "--online") out.online = true;
    else if (arg.startsWith("--limit=")) out.limit = Math.max(1, Number(arg.slice(8)) || 5);
  }
  return out;
}

function distanceMeters(a: Coordinates, b: Coordinates): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const p = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(p), Math.sqrt(1 - p));
}

async function searchNominatim(query: string, limit: number): Promise<SourceCandidate[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=de&q=${encodeURIComponent(query)}&limit=${limit}`;
  const res = await fetch(url, { headers: { "user-agent": "camping-portal-koblenz-goldset/1.0", accept: "application/json" } });
  if (!res.ok) throw new Error(`nominatim status=${res.status}`);
  const payload = (await res.json().catch(() => [])) as NominatimHit[];
  return payload.map((hit) => ({
    lat: Number(hit.lat),
    lng: Number(hit.lon),
    label: String(hit.display_name ?? "nominatim"),
    sourceId: `osm:${String(hit.osm_type ?? "unknown")}/${String(hit.osm_id ?? "unknown")}`,
  })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng));
}

async function searchWikidata(target: GoldTarget): Promise<WikidataHit[]> {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=de&type=item&limit=5&search=${encodeURIComponent(target.name)}`;
  const res = await fetch(url, { headers: { "user-agent": "camping-portal-koblenz-goldset/1.0", accept: "application/json" } });
  if (!res.ok) throw new Error(`wikidata status=${res.status}`);
  const payload = await res.json() as { search?: Array<{ id?: string; label?: string; description?: string }> };
  return (payload.search ?? []).map((x) => ({ id: String(x.id ?? ""), label: String(x.label ?? ""), description: x.description })).filter((x) => /^Q\d+$/.test(x.id));
}

async function searchGoogle(query: string): Promise<SourceCandidate[]> {
  const apiKey = String(process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  if (!apiKey) return [];
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
      "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.location",
    },
    body: JSON.stringify({ textQuery: query, languageCode: "de", regionCode: "DE", maxResultCount: 5 }),
  });
  if (!res.ok) throw new Error(`google status=${res.status}`);
  const payload = await res.json() as { places?: GooglePlaceHit[] };
  return (payload.places ?? []).map((hit) => ({
    lat: Number(hit.location?.latitude),
    lng: Number(hit.location?.longitude),
    label: `${String(hit.displayName?.text ?? "Google Place")} (${String(hit.formattedAddress ?? "")})`.trim(),
    sourceId: `google_places:${String(hit.id ?? "")}`,
  })).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lng) && x.sourceId !== "google_places:");
}

function updateOrInsertField(row: string, field: string, value: string): string {
  const p = new RegExp(`\\b${field}:\\s*[^,}]+`);
  return p.test(row) ? row.replace(p, `${field}: ${value}`) : row.replace(/\s*},\s*$/, `, ${field}: ${value} },`);
}

function applyRowUpdate(content: string, key: string, updates: Record<string, string>): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rowPattern = new RegExp(`^\\s*\\{\\s*key:\\s*"${escaped}"[^\\n]*$`, "m");
  const match = content.match(rowPattern)?.[0];
  if (!match) throw new Error(`Cannot locate curated row: ${key}`);
  let row = match;
  for (const [field, value] of Object.entries(updates)) row = updateOrInsertField(row, field, value);
  return content.replace(rowPattern, row);
}

async function resolveTarget(target: GoldTarget, current: Coordinates, online: boolean, limit: number) {
  let wikidata: WikidataHit[] = [];
  let google: SourceCandidate[] = [];
  let osm: SourceCandidate[] = [];
  const warnings: string[] = [];

  if (online) {
    try { wikidata = await searchWikidata(target); } catch (e) { warnings.push(`wikidata-unavailable:${String(e)}`); }
    try { google = await searchGoogle(target.googleQuery); } catch (e) { warnings.push(`google-unavailable:${String(e)}`); }
    try { osm = await searchNominatim(target.googleQuery, limit); } catch (e) { warnings.push(`osm-unavailable:${String(e)}`); }
  }

  if (!osm.length && OSM_OFFLINE[target.key]) osm = [OSM_OFFLINE[target.key]];
  const wikidataId = target.wikidataId ?? wikidata[0]?.id;
  const googleBest = google[0] ?? null;
  const osmBest = osm[0] ?? null;

  const finalPoint = googleBest ?? osmBest;
  const conflictDistance = googleBest && osmBest ? distanceMeters(googleBest, osmBest) : 0;
  const confidence = finalPoint ? (googleBest && osmBest && conflictDistance <= MAX_DISTANCE_FOR_AUTO_ACCEPT_M ? 0.95 : googleBest ? 0.82 : 0.7) : 0.35;
  const reviewState: ReviewState = finalPoint && wikidataId && googleBest && osmBest && conflictDistance <= MAX_DISTANCE_FOR_AUTO_ACCEPT_M ? "AUTO_ACCEPT" : "MANUAL_REVIEW";
  const coordinateSource = googleBest ? "google_places" : osmBest ? "nominatim-osm" : "unknown";
  const canonicalSource = wikidataId ? "wikidata" : googleBest ? "google_places" : "nominatim-osm";
  const canonicalSourceId = wikidataId ?? googleBest?.sourceId ?? osmBest?.sourceId ?? null;

  const reasonParts = [
    `wikidata=${wikidataId ?? "missing"}`,
    `google=${googleBest ? googleBest.sourceId : "missing"}`,
    `osm=${osmBest ? osmBest.sourceId : "missing"}`,
    googleBest && osmBest ? `google_osm_distance_m=${Math.round(conflictDistance)}` : null,
    warnings.length ? `warnings=${warnings.join(";")}` : null,
    target.anchorNote ? `anchor=${target.anchorNote}` : null,
  ].filter(Boolean);

  return {
    key: target.key,
    name: target.name,
    wikidata: { selectedId: wikidataId ?? null, candidates: wikidata.slice(0, 3) },
    googleCandidate: googleBest,
    osmCountercheck: osmBest,
    finalPoint,
    governance: {
      wikidataId: wikidataId ?? null,
      canonicalSource,
      canonicalSourceId,
      coordinateSource,
      coordinateConfidence: confidence,
      coordinateMode: target.mode,
      poiReviewState: reviewState,
      poiReviewReason: reasonParts.join(" | "),
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const curated = getCuratedPresetCandidates(PRESET);
  const byKey = new Map(curated.map((e) => [e.sourceId.split(":").at(-1) ?? "", e]));
  const targets = args.key ? GOLD_SET.filter((t) => t.key === args.key) : GOLD_SET;
  if (!targets.length) throw new Error(`Unknown key=${args.key}`);

  const resolved = [];
  for (const target of targets) {
    const row = byKey.get(target.key);
    if (!row) throw new Error(`Missing curated key=${target.key}`);
    resolved.push(await resolveTarget(target, { lat: row.lat, lng: row.lng }, args.online, args.limit));
  }

  if (args.apply) {
    let content = readFileSync(resolve(CURATED_FILE), "utf8");
    for (const item of resolved) {
      if (!item.finalPoint) continue;
      content = applyRowUpdate(content, item.key, {
        lat: item.finalPoint.lat.toFixed(6),
        lng: item.finalPoint.lng.toFixed(6),
        wikidataId: JSON.stringify(item.governance.wikidataId),
        canonicalSource: JSON.stringify(item.governance.canonicalSource),
        canonicalSourceId: JSON.stringify(item.governance.canonicalSourceId),
        coordinateSource: JSON.stringify(item.governance.coordinateSource),
        coordinateConfidence: item.governance.coordinateConfidence.toFixed(2),
        coordinateMode: JSON.stringify(item.governance.coordinateMode),
        reviewState: JSON.stringify(item.governance.poiReviewState),
        sourceNotes: JSON.stringify(item.governance.poiReviewReason)
      });
    }
    writeFileSync(resolve(CURATED_FILE), content, "utf8");
  }

  console.log(JSON.stringify({ set: "koblenz-gold-set", online: args.online, apply: args.apply, resolved }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
