// scripts/import-kml-to-ina-template.ts
//
// Converts a Google My Maps KML-KMZ export into the Ina Import Template CSV format
// and generates a deterministic TS 2.1 AI scoring from placeName-layerName-description.
//
// Usage
// - npx tsx scripts/import-kml-to-ina-template.ts <input.kml|input.kmz> [output.csv]
//
// Example
// - npx tsx scripts/import-kml-to-ina-template.ts "data/import/Campingplaetze.kmz" "data/import/Ina_Import_from_MyMaps.csv"
//
// Dependencies
// - npm i -D @xmldom/xmldom
// - npm i -D adm-zip   (only for KMZ)

import fs from "node:fs";
import path from "node:path";

type Row = Record<string, string>;
type PlaceType = "CAMPINGPLATZ" | "STELLPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";
type TS21Value = "S" | "O" | "X";
type AiProfile = "DNA" | "EXPLORER" | "";

const TEMPLATE_HEADERS = [
  "placeName",
  "placeType",
  "googleMapsUrl",
  "canonicalMapsUrl",
  "googlePlaceId",
  "lat",
  "lng",
  "latE7",
  "lonE7",
  "plusCode",
  "discoverySource",
  "geoSource",
  "tagsCsv",
  "notes",
  "visited",
  "visitStartDate",
  "visitEndDate",
  "pricePerNightEur",
  "electricityAvailable",
  "dogAllowed",
  "winterOpen",
  "onlineBooking",
  "tsVersion",
  "ai_profile",
  "ai_profile_confidence_0_1",
  "ai_ts21_umgebung_0_5",
  "ai_ts21_platzstruktur_0_5",
  "ai_ts21_sanitaer_0_5",
  "ai_ts21_buchung_0_5",
  "ai_ts21_preis_leistung_0_5",
  "ai_ts21_nachklang_0_5",
  "ai_ts21_wintertauglichkeit_0_5",
  "ai_ts21_hilde_score_0_5",
  "ai_ts21_total_0_20",
  "ai_ts21_confidence_0_1",
  "ai_reason_short",
  "sanitary",
  "yearRound",
  "gastronomy",
] as const;

function usageAndExit(message?: string, code = 1): never {
  if (message) console.error(message);
  console.error(
    [
      "",
      "Usage",
      "- npx tsx scripts/import-kml-to-ina-template.ts <input.kml|input.kmz> [output.csv]",
      "",
      "Examples",
      "- npx tsx scripts/import-kml-to-ina-template.ts data/import/mymaps.kml data/import/Ina_Import_from_MyMaps.csv",
      '- npx tsx scripts/import-kml-to-ina-template.ts "data/import/Campingplaetze.kmz" "data/import/Ina_Import_from_MyMaps.csv"',
      "",
      "Optional env vars",
      "- DEFAULT_PLACE_TYPE=CAMPINGPLATZ|STELLPLATZ|SEHENSWUERDIGKEIT|HVO_TANKSTELLE",
      "- DISCOVERY_SOURCE=GOOGLE_MY_MAPS",
      "",
    ].join("\n")
  );
  process.exit(code);
}

function escapeCsv(value: string): string {
  const v = value ?? "";
  if (v.includes('"') || v.includes(",") || v.includes("\n") || v.includes("\r")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function toCsv(headers: readonly string[], rows: Row[]): string {
  const lines: string[] = [];
  lines.push(headers.map(escapeCsv).join(","));
  for (const r of rows) lines.push(headers.map((h) => escapeCsv(r[h] ?? "")).join(","));
  return lines.join("\n") + "\n";
}

function parseXmlLoose(xml: string): Document {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { DOMParser } = require("@xmldom/xmldom");
    return new DOMParser().parseFromString(xml, "text/xml");
  } catch (e: any) {
    throw new Error(
      [
        "Missing XML parser.",
        "- Install @xmldom/xmldom:",
        "  - npm i -D @xmldom/xmldom",
        "",
        `Details: ${String(e?.message ?? e ?? "")}`,
      ].join("\n")
    );
  }
}

function readTextFile(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

async function readKmzAsKmlText(filePath: string): Promise<string> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AdmZip = require("adm-zip");
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();

    const doc = entries.find((e: any) => String(e.entryName).toLowerCase().endsWith("doc.kml"));
    const kmlEntry = doc ?? entries.find((e: any) => String(e.entryName).toLowerCase().endsWith(".kml"));
    if (!kmlEntry) throw new Error("KMZ contains no .kml entry");

    const buf: Buffer = kmlEntry.getData();
    return buf.toString("utf8");
  } catch (e: any) {
    throw new Error(
      [
        "KMZ could not be read.",
        "- Install adm-zip:",
        "  - npm i -D adm-zip",
        "",
        `Details: ${String(e?.message ?? e ?? "")}`,
      ].join("\n")
    );
  }
}

function textContent(el: Element | null | undefined): string {
  if (!el) return "";
  return String((el as any).textContent ?? "").trim();
}

function firstChildByTag(el: Element, tagName: string): Element | null {
  const nodes = el.getElementsByTagName(tagName);
  if (!nodes || nodes.length === 0) return null;
  return nodes.item(0) as any;
}

function cleanDescription(desc: string): string {
  const s = String(desc ?? "");
  if (!s) return "";
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n\s+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function extractTagsFromText(s: string): string[] {
  const out = new Set<string>();

  const hashTags = s.match(/#[\p{L}\p{N}_-]+/gu) ?? [];
  for (const t of hashTags) out.add(t.replace(/^#/, "").trim());

  const m = s.match(/tags?\s*:\s*([^\n\r]+)/i);
  if (m && m[1]) {
    const parts = m[1]
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    for (const p of parts) out.add(p);
  }

  return Array.from(out);
}

function parseLonLatFromPlacemark(pm: Element): { lat: number; lng: number } | null {
  const point = firstChildByTag(pm, "Point");
  if (!point) return null;

  const coordsEl = firstChildByTag(point, "coordinates");
  const coordsRaw = textContent(coordsEl);
  if (!coordsRaw) return null;

  const first = coordsRaw.split(/\s+/).filter(Boolean)[0];
  if (!first) return null;

  const parts = first.split(",").map((x) => x.trim());
  if (parts.length < 2) return null;

  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return { lat, lng };
}

function collectPlacemarks(doc: Document): Element[] {
  return Array.from(doc.getElementsByTagName("Placemark") as any) as Element[];
}

function findParentLayerName(pm: Element): string | null {
  let cur: any = pm.parentNode;
  while (cur) {
    if (cur.nodeType === 1) {
      const el = cur as Element;
      const tag = String((el as any).tagName ?? "").toLowerCase();
      if (tag.endsWith("folder")) {
        const nameEl = firstChildByTag(el, "name");
        const name = textContent(nameEl);
        if (name) return name;
      }
    }
    cur = cur.parentNode;
  }
  return null;
}

function normalizePlaceTypeFromLayer(layerOrFolderName: string | null, fallback: PlaceType): PlaceType {
  const n = String(layerOrFolderName ?? "").toLowerCase();
  if (n.includes("hvo") || n.includes("tank")) return "HVO_TANKSTELLE";
  if (n.includes("stellplatz") || n.includes("wohnmobil") || n.includes("camping-car") || n.includes("camping car")) return "STELLPLATZ";
  if (n.includes("sehens") || n.includes("spot") || n.includes("poi")) return "SEHENSWUERDIGKEIT";
  if (n.includes("camping")) return "CAMPINGPLATZ";
  return fallback;
}

function buildGoogleMapsUrls(lat: number, lng: number): { googleMapsUrl: string; canonicalMapsUrl: string } {
  const q = `${lat.toFixed(7)},${lng.toFixed(7)}`;
  return {
    googleMapsUrl: `https://www.google.com/maps?q=${q}`,
    canonicalMapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`,
  };
}

function toE7(n: number): string {
  return String(Math.round(n * 1e7));
}

function createEmptyRow(): Row {
  const r: Row = {};
  for (const h of TEMPLATE_HEADERS) r[h] = "";
  return r;
}

function normText(s: string): string {
  return String(s ?? "")
    .replace(/\r/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function containsAny(haystack: string, needles: string[]) {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n));
}

function countSignals(haystack: string, groups: string[][]) {
  let c = 0;
  for (const g of groups) if (containsAny(haystack, g)) c += 1;
  return c;
}

function pickTsValue(score01: number): TS21Value {
  if (score01 >= 0.72) return "S";
  if (score01 >= 0.42) return "O";
  return "X";
}

function tsToPoints(v: TS21Value) {
  if (v === "S") return 2;
  if (v === "O") return 1;
  return 0;
}

function computeTs21Total20(values: Record<string, TS21Value>): number {
  // 8 Kategorien, max 16 Punkte, skaliert auf 20
  const keys = [
    "ai_ts21_umgebung_0_5",
    "ai_ts21_platzstruktur_0_5",
    "ai_ts21_sanitaer_0_5",
    "ai_ts21_buchung_0_5",
    "ai_ts21_preis_leistung_0_5",
    "ai_ts21_nachklang_0_5",
    "ai_ts21_wintertauglichkeit_0_5",
    "ai_ts21_hilde_score_0_5",
  ];
  let sum = 0;
  for (const k of keys) sum += tsToPoints(values[k] ?? "O");
  const scaled = Math.round((sum / 16) * 20);
  return clamp(scaled, 0, 20);
}

/**
 * Deterministic TS2.1 "AI" scoring.
 * Designed for My Maps imports where description is often empty.
 * Primary signal source is placeName, secondary is layerName, tertiary is description-notes-tags.
 */
function inferAi(placeName: string, notes: string, layerName: string | null, placeType: PlaceType) {
  const name = String(placeName ?? "").trim();
  const layer = String(layerName ?? "").trim();
  const text = `${name}\n${layer}\n${notes}`.toLowerCase();

  // Keyword groups
  const G_LUXURY = [
    ["5*", "5 star", "5-star", "5 etoile", "5 étoile", "5 etoiles", "5 étoiles", "resort", "village", "yelloh", "sandaya", "capfun", "club", "spa", "aqua", "aquapark", "glamping"],
    ["premium", "lux", "luxe", "pool", "piscine", "parc", "kids", "animation"],
  ];
  const G_MUNICIPAL = [["municipal", "communal", "gemeinde", "stads", "city camping"]];
  const G_AIRE = [["aire", "camping-car", "camping car", "camping-cars", "camping cars", "aire de camping", "aires"]];
  const G_COAST = [["plage", "beach", "strand", "mer", "océan", "ocean", "golfe", "anse", "bucht", "mouettes", "dunes", "îlot", "ilot", "port"]];
  const G_NATURE = [["foret", "forêt", "wald", "forest", "lac", "lake", "see", "riviere", "rivière", "fluss", "mont", "berge", "cliff", "cote", "côte"]];
  const G_DOG = [["dog", "dogs", "hund", "hunde", "pet", "pets", "animaux"]];
  const G_FOOD = [["restaurant", "bistro", "bar", "pizzeria", "cafe", "café", "snack"]];
  const G_BOOKING = [["booking", "reservation", "réservation", "reserv", "online", "app", "self check", "check in", "check-in"]];
  const G_WINTER = [["winter", "hiver", "year round", "all year", "ganzjähr", "ganzjahr", "wintercamp"]];

  const sigLuxury = countSignals(text, G_LUXURY) > 0;
  const sigMunicipal = countSignals(text, G_MUNICIPAL) > 0;
  const sigAire = countSignals(text, G_AIRE) > 0;
  const sigCoast = countSignals(text, G_COAST) > 0;
  const sigNature = countSignals(text, G_NATURE) > 0;
  const sigDog = countSignals(text, G_DOG) > 0;
  const sigFood = countSignals(text, G_FOOD) > 0;
  const sigBooking = countSignals(text, G_BOOKING) > 0;
  const sigWinter = countSignals(text, G_WINTER) > 0;

  // Profile
  let profile: AiProfile = "";
  let profileConfidence = 0.55;

  // Stellplatz / Aire eher Explorer, Resort eher DNA
  if (sigLuxury) {
    profile = "DNA";
    profileConfidence = 0.78;
  } else if (placeType === "STELLPLATZ" || sigAire) {
    profile = "EXPLORER";
    profileConfidence = 0.72;
  } else if (sigNature || sigCoast) {
    profile = "EXPLORER";
    profileConfidence = 0.68;
  } else if (sigMunicipal) {
    profile = "EXPLORER";
    profileConfidence = 0.64;
  }

  // Score bases 0..1
  // We intentionally create more spread from name-only signals.
  let sUmgebung = 0.56;
  let sPlatz = 0.56;
  let sSan = 0.56;
  let sBuch = 0.56;
  let sPreis = 0.56;
  let sNach = 0.56;
  let sWinter = 0.56;
  let sHilde = 0.56;

  // Umgebung
  if (sigCoast) sUmgebung += 0.25;
  if (sigNature) sUmgebung += 0.18;
  if (sigAire) sUmgebung -= 0.10;

  // Platzstruktur
  if (sigLuxury) sPlatz += 0.18;
  if (sigMunicipal) sPlatz -= 0.06;
  if (sigAire) sPlatz -= 0.10;

  // Sanitär
  if (sigLuxury) sSan += 0.22;
  if (sigMunicipal) sSan -= 0.04;
  if (sigAire) sSan -= 0.18;

  // Buchung
  if (sigBooking) sBuch += 0.22;
  if (sigLuxury) sBuch += 0.10;
  if (sigMunicipal) sBuch -= 0.06;
  if (sigAire) sBuch -= 0.18;

  // Preis Leistung
  if (sigLuxury) sPreis -= 0.06;
  if (sigMunicipal) sPreis += 0.12;
  if (sigAire) sPreis += 0.08;

  // Nachklang
  if (sigLuxury) sNach += 0.10;
  if (sigCoast) sNach += 0.10;
  if (sigNature) sNach += 0.08;
  if (sigAire) sNach -= 0.06;

  // Winter
  if (sigWinter) sWinter += 0.20;
  if (sigCoast) sWinter -= 0.04;

  // Hilde
  if (sigDog) sHilde += 0.22;
  if (sigAire) sHilde -= 0.04;

  // Clamp
  sUmgebung = clamp(sUmgebung, 0.08, 0.95);
  sPlatz = clamp(sPlatz, 0.08, 0.95);
  sSan = clamp(sSan, 0.08, 0.95);
  sBuch = clamp(sBuch, 0.08, 0.95);
  sPreis = clamp(sPreis, 0.08, 0.95);
  sNach = clamp(sNach, 0.08, 0.95);
  sWinter = clamp(sWinter, 0.08, 0.95);
  sHilde = clamp(sHilde, 0.08, 0.95);

  const ts21: Record<string, TS21Value> = {
    ai_ts21_umgebung_0_5: pickTsValue(sUmgebung),
    ai_ts21_platzstruktur_0_5: pickTsValue(sPlatz),
    ai_ts21_sanitaer_0_5: pickTsValue(sSan),
    ai_ts21_buchung_0_5: pickTsValue(sBuch),
    ai_ts21_preis_leistung_0_5: pickTsValue(sPreis),
    ai_ts21_nachklang_0_5: pickTsValue(sNach),
    ai_ts21_wintertauglichkeit_0_5: pickTsValue(sWinter),
    ai_ts21_hilde_score_0_5: pickTsValue(sHilde),
  };

  const total20 = computeTs21Total20(ts21);

  // Confidence from how many signals we have
  const signalCount =
    Number(sigLuxury) +
    Number(sigMunicipal) +
    Number(sigAire) +
    Number(sigCoast) +
    Number(sigNature) +
    Number(sigDog) +
    Number(sigFood) +
    Number(sigBooking) +
    Number(sigWinter);

  const tsConf = clamp(0.56 + signalCount * 0.04, 0.56, 0.92);
  if (profile) profileConfidence = clamp(profileConfidence + signalCount * 0.02, 0.55, 0.92);

  // Reason should differ and be short
  const reasons: string[] = [];
  if (profile === "DNA") reasons.push("Komfort Profil DNA");
  if (profile === "EXPLORER") reasons.push("Erlebnis Profil Explorer");

  if (sigLuxury) reasons.push("Resort Village Marken Hinweise");
  if (sigAire) reasons.push("Aire Stellplatz Hinweis");
  if (sigMunicipal) reasons.push("Municipal einfach strukturiert");
  if (sigCoast) reasons.push("Kuesten Lage Hinweise");
  if (sigNature) reasons.push("Natur Lage Hinweise");
  if (sigBooking) reasons.push("Buchung Hinweis");
  if (sigDog) reasons.push("Hund Hinweis");
  if (sigFood) reasons.push("Gastro Hinweis");
  if (sigWinter) reasons.push("Winter Hinweis");

  if (reasons.length === 0) {
    reasons.push("Name liefert wenig Signale");
  }

  const reasonShort = reasons.slice(0, 3).join(" - ");

  // Optional booleans from signals
  const dogAllowed = sigDog ? "true" : "";
  const onlineBooking = sigBooking || sigLuxury ? "true" : sigAire ? "false" : "";
  const sanitary = sigLuxury ? "true" : sigAire ? "false" : "";
  const gastronomy = sigFood || sigLuxury ? "true" : "";
  const yearRound = sigWinter ? "true" : "";

  // Keep this stable, but do not force if unknown
  return {
    profile,
    profileConfidence: profile ? profileConfidence.toFixed(2) : "",
    reasonShort,

    ts21,
    ts21Total20: String(total20),
    ts21Confidence01: tsConf.toFixed(2),

    dogAllowed,
    onlineBooking,
    sanitary,
    gastronomy,
    yearRound,
  };
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath) usageAndExit("Missing input file path.");

  const absInput = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(absInput)) usageAndExit(`Input file not found: ${absInput}`);

  const defaultType = (process.env.DEFAULT_PLACE_TYPE ?? "CAMPINGPLATZ").toUpperCase() as PlaceType;
  const DEFAULT_PLACE_TYPE: PlaceType =
    defaultType === "CAMPINGPLATZ" || defaultType === "STELLPLATZ" || defaultType === "SEHENSWUERDIGKEIT" || defaultType === "HVO_TANKSTELLE"
      ? defaultType
      : "CAMPINGPLATZ";

  const DISCOVERY_SOURCE = String(process.env.DISCOVERY_SOURCE ?? "GOOGLE_MY_MAPS").trim() || "GOOGLE_MY_MAPS";

  const ext = path.extname(absInput).toLowerCase();
  let kmlText = "";

  if (ext === ".kml") kmlText = fs.readFileSync(absInput, "utf8");
  else if (ext === ".kmz") kmlText = await readKmzAsKmlText(absInput);
  else usageAndExit("Input must be .kml or .kmz");

  const xmlDoc = parseXmlLoose(kmlText);
  const placemarks = collectPlacemarks(xmlDoc);

  const rows: Row[] = [];

  for (const pm of placemarks) {
    const name = textContent(firstChildByTag(pm, "name"));
    const descRaw = textContent(firstChildByTag(pm, "description"));
    const desc = cleanDescription(descRaw);

    const ll = parseLonLatFromPlacemark(pm);
    if (!ll) continue;

    const { lat, lng } = ll;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const layerName = findParentLayerName(pm);
    const placeType = normalizePlaceTypeFromLayer(layerName, DEFAULT_PLACE_TYPE);

    const urls = buildGoogleMapsUrls(lat, lng);

    const tags = extractTagsFromText(desc);
    const notes = normText(desc);

    const ai = inferAi(name || "", notes, layerName, placeType);

    const row = createEmptyRow();
    row.placeName = name || "(unnamed)";
    row.placeType = placeType;

    row.googleMapsUrl = urls.googleMapsUrl;
    row.canonicalMapsUrl = urls.canonicalMapsUrl;

    row.lat = String(Number(lat.toFixed(7)));
    row.lng = String(Number(lng.toFixed(7)));
    row.latE7 = toE7(lat);
    row.lonE7 = toE7(lng);

    row.discoverySource = layerName ? `${DISCOVERY_SOURCE}:${layerName}` : DISCOVERY_SOURCE;
    row.geoSource = ext === ".kmz" ? "KMZ" : "KML";

    row.tagsCsv = tags.join(",");
    row.notes = notes;

    row.tsVersion = "TS21";

    // AI profile and reason
    row.ai_profile = ai.profile;
    row.ai_profile_confidence_0_1 = ai.profileConfidence;
    row.ai_reason_short = ai.reasonShort;

    // AI TS21 legacy columns
    row.ai_ts21_umgebung_0_5 = ai.ts21.ai_ts21_umgebung_0_5;
    row.ai_ts21_platzstruktur_0_5 = ai.ts21.ai_ts21_platzstruktur_0_5;
    row.ai_ts21_sanitaer_0_5 = ai.ts21.ai_ts21_sanitaer_0_5;
    row.ai_ts21_buchung_0_5 = ai.ts21.ai_ts21_buchung_0_5;
    row.ai_ts21_preis_leistung_0_5 = ai.ts21.ai_ts21_preis_leistung_0_5;
    row.ai_ts21_nachklang_0_5 = ai.ts21.ai_ts21_nachklang_0_5;
    row.ai_ts21_wintertauglichkeit_0_5 = ai.ts21.ai_ts21_wintertauglichkeit_0_5;
    row.ai_ts21_hilde_score_0_5 = ai.ts21.ai_ts21_hilde_score_0_5;

    row.ai_ts21_total_0_20 = ai.ts21Total20;
    row.ai_ts21_confidence_0_1 = ai.ts21Confidence01;

    // optional booleans inferred
    if (ai.dogAllowed) row.dogAllowed = ai.dogAllowed;
    if (ai.onlineBooking) row.onlineBooking = ai.onlineBooking;
    if (ai.sanitary) row.sanitary = ai.sanitary;
    if (ai.gastronomy) row.gastronomy = ai.gastronomy;
    if (ai.yearRound) {
      row.yearRound = ai.yearRound;
      if (!row.winterOpen) row.winterOpen = ai.yearRound;
    }

    rows.push(row);
  }

  const csv = toCsv(TEMPLATE_HEADERS as unknown as string[], rows);

  if (outputPath) {
    const absOut = path.resolve(process.cwd(), outputPath);
    fs.mkdirSync(path.dirname(absOut), { recursive: true });
    fs.writeFileSync(absOut, csv, "utf8");
    console.log(`OK - wrote ${rows.length} rows - ${absOut}`);
  } else {
    process.stdout.write(csv);
  }
}

main().catch((e) => {
  console.error(String(e?.message ?? e ?? "Unknown error"));
  process.exit(1);
});