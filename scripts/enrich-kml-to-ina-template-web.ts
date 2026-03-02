// scripts/enrich-kml-to-ina-template-web.ts
//
// KML-KMZ -> Ina Import CSV with TS2.1 AI scoring based on web hints.
// - Uses DuckDuckGo HTML search (no API key) to gather snippets and top links
// - Fetches a few top pages and extracts meta description + headings
// - Applies deterministic scoring rules on extracted evidence
// - Caches per place to avoid re-fetching
// - Rate-limits all network calls
//
// Usage
// - npx tsx scripts/enrich-kml-to-ina-template-web.ts <input.kml|input.kmz> <output.csv>
//
// Recommended first run
// - npx tsx scripts/enrich-kml-to-ina-template-web.ts "data/import/Campingplaetze.kmz" "data/import/Ina_Import_from_MyMaps_WEB.csv"
//
// Offline run (cache only)
// - npx tsx scripts/enrich-kml-to-ina-template-web.ts "data/import/Campingplaetze.kmz" "data/import/Ina_Import_from_MyMaps_WEB.csv" --offline
//
// Options
// - --offline               use cache only, no web requests
// - --maxPlaces=50          limit number of placemarks
// - --maxSearchResults=5    per place
// - --maxFetchPages=2       per place
// - --delayMs=1200          delay between requests
// - --cacheDir=data/import/_webcache
//
// Dependencies
// - npm i -D @xmldom/xmldom
// - npm i -D adm-zip        (only for KMZ)
//
// Notes
// - This script does not touch your Next app or DB.
// - Web scraping can fail depending on network and rate limits. Cache helps a lot.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

type PlaceType = "CAMPINGPLATZ" | "STELLPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";
type TS21Value = "S" | "O" | "X";
type AiProfile = "DNA" | "EXPLORER" | "";

type Row = Record<string, string>;

type WebEvidence = {
  query: string;
  searchedAtIso: string;
  ddgResults: Array<{ title: string; url: string; snippet: string }>;
  fetchedPages: Array<{ url: string; status: number; title: string; metaDescription: string; h1: string; h2: string[] }>;
  combinedText: string; // normalized concatenation used for scoring
  errors: string[];
};

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

function argFlag(name: string): boolean {
  return process.argv.slice(2).some((a) => a === name);
}

function argValue(name: string, fallback: string): string {
  const pfx = `${name}=`;
  const hit = process.argv.slice(2).find((a) => a.startsWith(pfx));
  return hit ? hit.slice(pfx.length) : fallback;
}

function usageAndExit(message?: string, code = 1): never {
  if (message) console.error(message);
  console.error(
    [
      "",
      "Usage",
      "- npx tsx scripts/enrich-kml-to-ina-template-web.ts <input.kml|input.kmz> <output.csv> [--offline] [--maxPlaces=N] [--delayMs=MS]",
      "",
      "Examples",
      '- npx tsx scripts/enrich-kml-to-ina-template-web.ts "data/import/Campingplaetze.kmz" "data/import/Ina_Import_from_MyMaps_WEB.csv"',
      '- npx tsx scripts/enrich-kml-to-ina-template-web.ts "data/import/Campingplaetze.kmz" "data/import/Ina_Import_from_MyMaps_WEB.csv" --offline',
      "",
      "Options",
      "- --offline               use cache only",
      "- --maxPlaces=50          limit placemarks",
      "- --maxSearchResults=5    DuckDuckGo results per place",
      "- --maxFetchPages=2       pages fetched per place",
      "- --delayMs=1200          delay between requests",
      "- --cacheDir=data/import/_webcache",
      "",
      "Dependencies",
      "- npm i -D @xmldom/xmldom",
      "- npm i -D adm-zip        (only for KMZ)",
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

function normalizePlaceTypeFromLayer(layerOrFolderName: string | null, fallback: PlaceType, placeName: string, notes: string): PlaceType {
  const n = `${String(layerOrFolderName ?? "")} ${placeName} ${notes}`.toLowerCase();

  // rule from you - Aire -> STELLPLATZ
  if (n.includes("aire") || n.includes("camping-car") || n.includes("camping car") || n.includes("camping-cars")) return "STELLPLATZ";

  if (n.includes("hvo") || n.includes("tank")) return "HVO_TANKSTELLE";
  if (n.includes("stellplatz") || n.includes("wohnmobil")) return "STELLPLATZ";
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

function sha1(s: string): string {
  return crypto.createHash("sha1").update(s).digest("hex");
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBetween(html: string, re: RegExp, maxLen = 400): string {
  const m = html.match(re);
  if (!m) return "";
  const s = stripHtmlToText(m[1] ?? "");
  return s.length > maxLen ? s.slice(0, maxLen).trim() : s;
}

function extractMetaDescription(html: string): string {
  const m =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i) ??
    html.match(/<meta[^>]+content=["']([\s\S]*?)["'][^>]+name=["']description["'][^>]*>/i);
  if (!m) return "";
  return stripHtmlToText(m[1] ?? "").slice(0, 500).trim();
}

function extractTitle(html: string): string {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtmlToText(m?.[1] ?? "").slice(0, 180).trim();
}

function extractFirstH1(html: string): string {
  return extractBetween(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i, 200);
}

function extractH2(html: string, max = 5): string[] {
  const out: string[] = [];
  const re = /<h2[^>]*>([\s\S]*?)<\/h2>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < max) {
    const t = stripHtmlToText(m[1] ?? "").slice(0, 200).trim();
    if (t) out.push(t);
  }
  return out;
}

async function httpGetText(url: string, delayMs: number): Promise<{ status: number; text: string }> {
  await sleep(delayMs);
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "accept-language": "de-DE,de;q=0.9,en;q=0.8,fr;q=0.7",
    },
  });

  const text = await res.text().catch(() => "");
  return { status: res.status, text };
}

async function ddgSearch(query: string, maxResults: number, delayMs: number): Promise<Array<{ title: string; url: string; snippet: string }>> {
  const url = `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const { status, text } = await httpGetText(url, delayMs);
  if (status >= 400) return [];

  const html = text;

  // Very simple parser for DDG HTML results
  // Matches: <a rel="nofollow" class="result__a" href="...">Title</a> ... <a class="result__snippet">Snippet</a>
  const results: Array<{ title: string; url: string; snippet: string }> = [];
  const reBlock = /<div class="result__body">([\s\S]*?)<\/div>\s*<\/div>/gi;

  let m: RegExpExecArray | null;
  while ((m = reBlock.exec(html)) && results.length < maxResults) {
    const block = m[1] ?? "";

    const urlM = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"/i);
    const titleM = block.match(/<a[^>]+class="result__a"[^>]*>([\s\S]*?)<\/a>/i);
    const snipM = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i);

    const u = urlM ? String(urlM[1]) : "";
    const t = titleM ? stripHtmlToText(titleM[1]) : "";
    const s = snipM ? stripHtmlToText(snipM[1]) : "";

    if (u && t) results.push({ title: t.slice(0, 180), url: u, snippet: s.slice(0, 280) });
  }

  return results;
}

function containsAny(haystack: string, needles: string[]) {
  const h = haystack.toLowerCase();
  return needles.some((n) => h.includes(n));
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
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

function scoreFromEvidence(placeType: PlaceType, placeName: string, evidenceText: string) {
  const t = `${placeName}\n${evidenceText}`.toLowerCase();

  // Signals from web hints
  const sigLuxury = containsAny(t, [
    "5 star",
    "5-star",
    "5 étoiles",
    "5 etoiles",
    "yelloh",
    "sandaya",
    "capfun",
    "resort",
    "village",
    "spa",
    "wellness",
    "aqua",
    "aquapark",
    "water park",
    "lagoon",
    "piscine",
    "pool",
    "glamping",
    "premium",
  ]);

  const sigMunicipal = containsAny(t, ["municipal", "communal", "stads", "gemeinde", "city owned", "municipalité"]);
  const sigAire = placeType === "STELLPLATZ" || containsAny(t, ["aire", "camping-car", "camping car", "camperplaats", "motorhome stopover"]);
  const sigCoast = containsAny(t, ["plage", "beach", "strand", "mer", "océan", "ocean", "golfe", "anse", "dunes", "baie", "port"]);
  const sigNature = containsAny(t, ["forêt", "foret", "wald", "forest", "lac", "lake", "rivi", "river", "mont", "cliff", "nature", "quiet"]);
  const sigBooking = containsAny(t, ["online booking", "book online", "reservation", "réservation", "reservations", "acsi", "pitchup", "booking"]);
  const sigDogYes = containsAny(t, ["dog friendly", "dogs allowed", "chiens acceptés", "hunde erlaubt", "pets allowed"]);
  const sigDogNo = containsAny(t, ["no dogs", "dogs not allowed", "chiens interdits", "hunde verboten"]);
  const sigWinterYes = containsAny(t, ["open all year", "year round", "ganzjährig", "ouvert toute l'année", "winter camping"]);
  const sigWinterNo = containsAny(t, ["seasonal", "closed in winter", "fermé en hiver", "saison", "winter closed"]);

  // Profile decision
  let profile: AiProfile = "";
  let pConf = 0.58;

  if (sigLuxury) {
    profile = "EXPLORER";
    pConf += 0.18;
  } else if (sigAire) {
    profile = "DNA";
    pConf += 0.12;
  } else if (sigNature || sigCoast) {
    profile = "DNA";
    pConf += 0.10;
  } else if (sigMunicipal) {
    profile = "DNA";
    pConf += 0.08;
  }

  // category scores 0..1
  let sUmgebung = 0.56;
  let sPlatz = 0.56;
  let sSan = 0.56;
  let sBuch = 0.56;
  let sPreis = 0.56;
  let sNach = 0.56;
  let sWinter = 0.56;
  let sHilde = 0.56;

  if (sigCoast) sUmgebung += 0.22;
  if (sigNature) sUmgebung += 0.16;
  if (sigAire) sUmgebung -= 0.06;

  if (sigLuxury) sPlatz += 0.16;
  if (sigMunicipal) sPlatz -= 0.06;
  if (sigAire) sPlatz -= 0.12;

  if (sigLuxury) sSan += 0.20;
  if (sigMunicipal) sSan -= 0.06;
  if (sigAire) sSan -= 0.22;

  if (sigBooking) sBuch += 0.22;
  if (sigLuxury) sBuch += 0.08;
  if (sigMunicipal) sBuch -= 0.06;
  if (sigAire) sBuch -= 0.18;

  if (sigLuxury) sPreis -= 0.06;
  if (sigMunicipal) sPreis += 0.10;
  if (sigAire) sPreis += 0.06;

  if (sigLuxury) sNach += 0.10;
  if (sigCoast) sNach += 0.10;
  if (sigNature) sNach += 0.08;
  if (sigAire) sNach -= 0.06;

  if (sigWinterYes) sWinter += 0.20;
  if (sigWinterNo) sWinter -= 0.20;

  if (sigDogYes) sHilde += 0.22;
  if (sigDogNo) sHilde -= 0.35;

  // clamp all
  const clampAll = (x: number) => clamp(x, 0.08, 0.95);
  sUmgebung = clampAll(sUmgebung);
  sPlatz = clampAll(sPlatz);
  sSan = clampAll(sSan);
  sBuch = clampAll(sBuch);
  sPreis = clampAll(sPreis);
  sNach = clampAll(sNach);
  sWinter = clampAll(sWinter);
  sHilde = clampAll(sHilde);

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

  // confidence based on evidence richness
  const signalCount =
    Number(sigLuxury) +
    Number(sigMunicipal) +
    Number(sigAire) +
    Number(sigCoast) +
    Number(sigNature) +
    Number(sigBooking) +
    Number(sigDogYes || sigDogNo) +
    Number(sigWinterYes || sigWinterNo);

  const tsConf = clamp(0.56 + signalCount * 0.05, 0.56, 0.94);
  if (profile) pConf = clamp(pConf + signalCount * 0.02, 0.55, 0.94);

  const reasons: string[] = [];
  if (profile === "DNA") reasons.push("DNA passend");
  if (profile === "EXPLORER") reasons.push("Explorer passend");
  if (sigLuxury) reasons.push("Resort Infrastruktur");
  if (sigAire) reasons.push("Aire Stellplatz");
  if (sigMunicipal) reasons.push("Municipal eher simpel");
  if (sigCoast) reasons.push("Kuestenlage");
  if (sigNature) reasons.push("Naturnahe Hinweise");
  if (sigBooking) reasons.push("Buchung Hinweise");
  if (sigDogYes) reasons.push("Hund erlaubt");
  if (sigDogNo) reasons.push("Hund unklar oder nein");
  if (sigWinterYes) reasons.push("Ganzjaehrig");
  if (sigWinterNo) reasons.push("Saisonal");

  const reasonShort = (reasons.length ? reasons : ["Wenig belastbare Hinweise"]).slice(0, 3).join(" - ");

  const dogAllowed = sigDogNo ? "false" : sigDogYes ? "true" : "";
  const yearRound = sigWinterNo ? "false" : sigWinterYes ? "true" : "";
  const onlineBooking = sigBooking ? "true" : sigAire ? "false" : "";
  const sanitary = sigLuxury ? "true" : sigAire ? "false" : "";
  const gastronomy = containsAny(t, ["restaurant", "bar", "bistro", "snack", "pizzeria"]) ? "true" : "";

  return {
    profile,
    profileConfidence: profile ? pConf.toFixed(2) : "",
    reasonShort,
    ts21,
    ts21Total20: String(total20),
    ts21Confidence01: tsConf.toFixed(2),
    dogAllowed,
    yearRound,
    onlineBooking,
    sanitary,
    gastronomy,
  };
}

async function getEvidenceForPlace(args: {
  placeName: string;
  lat: number;
  lng: number;
  placeType: PlaceType;
  delayMs: number;
  maxSearchResults: number;
  maxFetchPages: number;
  cacheDir: string;
  offline: boolean;
}): Promise<WebEvidence> {
  const { placeName, lat, lng, placeType, delayMs, maxSearchResults, maxFetchPages, cacheDir, offline } = args;

  fs.mkdirSync(cacheDir, { recursive: true });

  const cacheKey = sha1(`${placeName}__${placeType}__${lat.toFixed(6)}__${lng.toFixed(6)}`);
  const cacheFile = path.join(cacheDir, `${cacheKey}.json`);

  if (fs.existsSync(cacheFile)) {
    try {
      const raw = fs.readFileSync(cacheFile, "utf8");
      return JSON.parse(raw) as WebEvidence;
    } catch {
      // ignore and regenerate
    }
  }

  const evidence: WebEvidence = {
    query: "",
    searchedAtIso: new Date().toISOString(),
    ddgResults: [],
    fetchedPages: [],
    combinedText: "",
    errors: [],
  };

  // Query includes coordinates to reduce ambiguity
  const q = `${placeName} camping ${lat.toFixed(5)},${lng.toFixed(5)}`;
  evidence.query = q;

  if (offline) {
    evidence.errors.push("offline mode - no web requests and no cache hit");
    evidence.combinedText = `${placeName}`.toLowerCase();
    return evidence;
  }

  try {
    evidence.ddgResults = await ddgSearch(q, maxSearchResults, delayMs);
  } catch (e: any) {
    evidence.errors.push(`ddg search failed: ${String(e?.message ?? e ?? "")}`);
  }

  const urls = evidence.ddgResults
    .map((r) => r.url)
    .filter(Boolean)
    // avoid obvious junk
    .filter((u) => !u.includes("duckduckgo.com"))
    .slice(0, maxFetchPages);

  for (const u of urls) {
    try {
      const { status, text } = await httpGetText(u, delayMs);
      const title = extractTitle(text);
      const metaDescription = extractMetaDescription(text);
      const h1 = extractFirstH1(text);
      const h2 = extractH2(text, 5);

      evidence.fetchedPages.push({
        url: u,
        status,
        title,
        metaDescription,
        h1,
        h2,
      });
    } catch (e: any) {
      evidence.errors.push(`fetch failed: ${u} - ${String(e?.message ?? e ?? "")}`);
    }
  }

  // Build combined text for scoring
  const parts: string[] = [];
  for (const r of evidence.ddgResults) {
    parts.push(r.title, r.snippet, r.url);
  }
  for (const p of evidence.fetchedPages) {
    parts.push(p.title, p.metaDescription, p.h1, ...p.h2, p.url);
  }

  evidence.combinedText = normText(parts.join("\n")).toLowerCase();

  // persist cache
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(evidence, null, 2), "utf8");
  } catch {
    // ignore
  }

  return evidence;
}

async function main() {
  const inputPath = process.argv[2];
  const outputPath = process.argv[3];

  if (!inputPath || !outputPath) usageAndExit("Missing input or output path.");

  const offline = argFlag("--offline");
  const maxPlaces = Number(argValue("--maxPlaces", "9999"));
  const maxSearchResults = Number(argValue("--maxSearchResults", "5"));
  const maxFetchPages = Number(argValue("--maxFetchPages", "2"));
  const delayMs = Number(argValue("--delayMs", "1200"));
  const cacheDir = String(argValue("--cacheDir", "data/import/_webcache"));

  if (!Number.isFinite(maxPlaces) || maxPlaces <= 0) usageAndExit("Invalid --maxPlaces");
  if (!Number.isFinite(maxSearchResults) || maxSearchResults <= 0) usageAndExit("Invalid --maxSearchResults");
  if (!Number.isFinite(maxFetchPages) || maxFetchPages < 0) usageAndExit("Invalid --maxFetchPages");
  if (!Number.isFinite(delayMs) || delayMs < 0) usageAndExit("Invalid --delayMs");

  const absInput = path.resolve(process.cwd(), inputPath);
  if (!fs.existsSync(absInput)) usageAndExit(`Input file not found: ${absInput}`);

  const ext = path.extname(absInput).toLowerCase();
  let kmlText = "";

  if (ext === ".kml") kmlText = fs.readFileSync(absInput, "utf8");
  else if (ext === ".kmz") kmlText = await readKmzAsKmlText(absInput);
  else usageAndExit("Input must be .kml or .kmz");

  const xmlDoc = parseXmlLoose(kmlText);
  const placemarks = collectPlacemarks(xmlDoc).slice(0, maxPlaces);

  const DEFAULT_PLACE_TYPE: PlaceType = "CAMPINGPLATZ";
  const DISCOVERY_SOURCE = "GOOGLE_MY_MAPS_WEB";

  const rows: Row[] = [];

  for (let i = 0; i < placemarks.length; i++) {
    const pm = placemarks[i];

    const name = textContent(firstChildByTag(pm, "name"));
    const descRaw = textContent(firstChildByTag(pm, "description"));
    const desc = cleanDescription(descRaw);

    const ll = parseLonLatFromPlacemark(pm);
    if (!ll) continue;

    const { lat, lng } = ll;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const layerName = findParentLayerName(pm);
    const notes = normText(desc);

    const placeType = normalizePlaceTypeFromLayer(layerName, DEFAULT_PLACE_TYPE, name || "", notes || "");
    const urls = buildGoogleMapsUrls(lat, lng);

    // Web evidence
    const evidence = await getEvidenceForPlace({
      placeName: name || "",
      lat,
      lng,
      placeType,
      delayMs,
      maxSearchResults,
      maxFetchPages,
      cacheDir: path.resolve(process.cwd(), cacheDir),
      offline,
    });

    // Score from evidence
    const scored = scoreFromEvidence(placeType, name || "", evidence.combinedText);

    const row: Row = {};
    for (const h of TEMPLATE_HEADERS) row[h] = "";

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

    row.notes = notes;
    row.tsVersion = "TS21";

    // AI profile and reason
    row.ai_profile = scored.profile;
    row.ai_profile_confidence_0_1 = scored.profileConfidence;
    row.ai_reason_short = scored.reasonShort;

    // AI TS21 columns
    row.ai_ts21_umgebung_0_5 = scored.ts21.ai_ts21_umgebung_0_5;
    row.ai_ts21_platzstruktur_0_5 = scored.ts21.ai_ts21_platzstruktur_0_5;
    row.ai_ts21_sanitaer_0_5 = scored.ts21.ai_ts21_sanitaer_0_5;
    row.ai_ts21_buchung_0_5 = scored.ts21.ai_ts21_buchung_0_5;
    row.ai_ts21_preis_leistung_0_5 = scored.ts21.ai_ts21_preis_leistung_0_5;
    row.ai_ts21_nachklang_0_5 = scored.ts21.ai_ts21_nachklang_0_5;
    row.ai_ts21_wintertauglichkeit_0_5 = scored.ts21.ai_ts21_wintertauglichkeit_0_5;
    row.ai_ts21_hilde_score_0_5 = scored.ts21.ai_ts21_hilde_score_0_5;

    row.ai_ts21_total_0_20 = scored.ts21Total20;
    row.ai_ts21_confidence_0_1 = scored.ts21Confidence01;

    // Optional booleans
    if (scored.dogAllowed) row.dogAllowed = scored.dogAllowed;
    if (scored.onlineBooking) row.onlineBooking = scored.onlineBooking;
    if (scored.sanitary) row.sanitary = scored.sanitary;
    if (scored.gastronomy) row.gastronomy = scored.gastronomy;
    if (scored.yearRound) {
      row.yearRound = scored.yearRound;
      row.winterOpen = scored.yearRound;
    }

    rows.push(row);

    const info = [
      `#${i + 1}/${placemarks.length}`,
      `${row.placeType}`,
      `${row.placeName}`,
      `profile=${row.ai_profile || "-"}`,
      `total=${row.ai_ts21_total_0_20}/20`,
      `conf=${row.ai_ts21_confidence_0_1}`,
      `query=${evidence.query}`,
      evidence.errors.length ? `errors=${evidence.errors.length}` : "",
    ]
      .filter(Boolean)
      .join(" | ");

    console.log(info);
  }

  const csv = toCsv(TEMPLATE_HEADERS as unknown as string[], rows);

  const absOut = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, csv, "utf8");

  console.log(`OK - wrote ${rows.length} rows - ${absOut}`);
  console.log(`Cache dir - ${path.resolve(process.cwd(), cacheDir)}`);
}

main().catch((e) => {
  console.error(String(e?.message ?? e ?? "Unknown error"));
  process.exit(1);
});