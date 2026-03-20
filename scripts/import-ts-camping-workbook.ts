import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { prisma } from "../src/lib/prisma.ts";
import { discoverHeroCandidates } from "../src/lib/hero-candidates.ts";
import { buildGooglePhotoMediaUrl } from "../src/lib/hero-image.ts";

type PlaceType = "CAMPINGPLATZ" | "STELLPLATZ";
type TS21Value = "S" | "O" | "X";

type WorkbookRow = {
  __rowNumber: number;
  Name?: string;
  "Ort/Region"?: string;
  Typ?: string;
  "Entfernung ab Nievern (km, ca.)"?: string;
  "Sanitär"?: string;
  "Winter-Score (0-2)"?: string;
  "Hunde-Score (0-2)"?: string;
  Mindestaufenthalt?: string;
  "Ruhe/Natur (0-5)"?: string;
  "Törtchen-Faktor (0-5)"?: string;
  "Spontan (0-2)"?: string;
  "TS-Status"?: string;
  "Liste/Status"?: string;
  "Prüf-Sicherheit"?: string;
  Notizen?: string;
  "Google Maps"?: string;
};

type GooglePhoto = {
  name: string;
  widthPx?: number;
  heightPx?: number;
};

type GooglePlace = {
  id?: string;
  displayName?: { text?: string };
  location?: { latitude?: number; longitude?: number };
  websiteUri?: string;
  googleMapsUri?: string;
  photos?: GooglePhoto[];
};

type ImportReportItem = {
  rowNumber: number;
  name: string;
  action: "created" | "updated" | "skipped" | "error";
  matchScore?: number;
  matchedPlaceId?: string;
  matchedPlaceName?: string;
  lat?: number;
  lng?: number;
  heroChosen?: string | null;
  message?: string;
};

type Args = {
  input: string;
  dryRun: boolean;
  reportPath: string;
};

const GOOGLE_FIELD_MASK =
  "places.id,places.displayName,places.location,places.websiteUri,places.googleMapsUri,places.photos";
const GOOGLE_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const NAME_ALIASES: Record<string, string[]> = {
  "camping golden mile": ["Campingplatz Goldene Meile"],
  "campingplatz weingarten": ["Camping-Waldfrieden"],
};

function parseArgs(): Args {
  const inputArg = process.argv.slice(2).find((arg) => arg.startsWith("--input="));
  const reportArg = process.argv.slice(2).find((arg) => arg.startsWith("--report="));

  return {
    input: inputArg
      ? inputArg.slice("--input=".length)
      : "C:/Users/niels/Documents/00_Privat/Niels/camping-portal/Import-Templates/campingplaetze_ts_mit_maps.xlsx",
    dryRun: process.argv.includes("--dry-run"),
    reportPath: reportArg ? reportArg.slice("--report=".length) : "data/import/ts-camping-workbook-import-report.json",
  };
}

function normalize(text: string): string {
  return String(text ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(text: string): string[] {
  return normalize(text)
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length >= 2);
}

function overlapScore(a: string, b: string): number {
  const aa = new Set(tokenize(a));
  const bb = new Set(tokenize(b));
  if (!aa.size || !bb.size) return 0;

  let overlap = 0;
  for (const token of aa) {
    if (bb.has(token)) overlap += 1;
  }

  return overlap / Math.max(aa.size, bb.size);
}

function dedupeStrings(values: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (!text) continue;
    const key = normalize(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
  }
  return out;
}

function parseScore(value: string | undefined): number | null {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function mapBinaryText(value: string | undefined): TS21Value {
  const text = normalize(value ?? "");
  if (!text) return "O";
  if (text === "ja") return "S";
  if (text === "nein") return "X";
  return "O";
}

function map02Score(value: string | undefined): TS21Value {
  const number = parseScore(value);
  if (number == null) return "O";
  if (number >= 2) return "S";
  if (number <= 0) return "X";
  return "O";
}

function map05Score(value: string | undefined): TS21Value {
  const number = parseScore(value);
  if (number == null) return "O";
  if (number >= 4) return "S";
  if (number <= 1) return "X";
  return "O";
}

function inferOverallScore(row: WorkbookRow): TS21Value {
  const status = normalize(row["TS-Status"] ?? "");
  if (status.includes("passt gut") || status.includes("passt saisonal")) return "S";
  if (status.includes("raus")) return "X";
  if (status.includes("mit abstrichen") || status.includes("bedingt")) return "O";

  const signals = [
    mapBinaryText(row["Sanitär"]),
    map02Score(row["Winter-Score (0-2)"]),
    map02Score(row["Hunde-Score (0-2)"]),
    map05Score(row["Ruhe/Natur (0-5)"]),
    map05Score(row["Törtchen-Faktor (0-5)"]),
    map02Score(row["Spontan (0-2)"]),
  ];
  const score = signals.reduce((sum, value) => sum + (value === "S" ? 1 : value === "X" ? -1 : 0), 0);
  if (score >= 3) return "S";
  if (score <= -2) return "X";
  return "O";
}

function containsAny(text: string, terms: string[]): boolean {
  const haystack = normalize(text);
  return terms.some((term) => haystack.includes(normalize(term)));
}

function inferPlaceType(row: WorkbookRow): PlaceType | null {
  const type = normalize(row.Typ ?? "");
  if (type === "campingplatz") return "CAMPINGPLATZ";
  if (type === "wohnmobilstellplatz" || type === "stellplatz") return "STELLPLATZ";
  return null;
}

function inferUserScores(row: WorkbookRow): Record<string, TS21Value> {
  const minimumStay = normalize(row.Mindestaufenthalt ?? "");
  const spontaneous = map02Score(row["Spontan (0-2)"]);
  const stayPenalty = minimumStay.includes("2 nacht") || minimumStay.includes("3 nacht") ? "X" : spontaneous;

  return {
    "1a": map02Score(row["Hunde-Score (0-2)"]),
    "1b": map05Score(row["Ruhe/Natur (0-5)"]),
    "2a": stayPenalty,
    "2b": spontaneous,
    "3": mapBinaryText(row["Sanitär"]),
    "4a": map05Score(row["Ruhe/Natur (0-5)"]),
    "4b": map05Score(row["Törtchen-Faktor (0-5)"]),
    "5": map02Score(row["Winter-Score (0-2)"]),
    "6": spontaneous,
    "7": inferOverallScore(row),
  };
}

function inferProfile(row: WorkbookRow): "DNA" | "EXPLORER" {
  const text = [row.Name, row["Ort/Region"], row["TS-Status"], row["Liste/Status"], row.Notizen].filter(Boolean).join("\n");
  const premium = containsAny(text, ["wellness", "knaus", "rheinpark", "premium", "komfort", "resort"]);
  const lively = containsAny(text, ["lebhaft", "ferien", "wochenenden", "pragmatisch"]);

  if (premium || lively) return "EXPLORER";
  return "DNA";
}

function inferAiScores(row: WorkbookRow): { profile: "DNA" | "EXPLORER"; scores: Record<string, TS21Value>; reason: string } {
  const profile = inferProfile(row);
  const text = [row.Name, row["Ort/Region"], row["TS-Status"], row["Liste/Status"], row.Notizen].filter(Boolean).join("\n");
  const water = containsAny(text, ["see", "mosel", "rhein", "insel", "fluss", "ufer"]);
  const forest = containsAny(text, ["wald", "natur", "ruhig", "eichen", "biggesee", "rursee"]);
  const mountain = containsAny(text, ["berg", "hunsruck", "hunsrück", "donnersberg", "eifel"]);
  const winter = containsAny(text, ["winter", "frost", "ganzjahr", "saisonal"]);
  const lively = containsAny(text, ["lebhaft", "ferien", "wochenenden"]);

  const scores: Record<string, TS21Value> = {
    "1a": map02Score(row["Hunde-Score (0-2)"]),
    "1b": forest || water ? "S" : map05Score(row["Ruhe/Natur (0-5)"]),
    "2a": normalize(row.Mindestaufenthalt ?? "").includes("2 nacht") ? "X" : map02Score(row["Spontan (0-2)"]),
    "2b": map02Score(row["Spontan (0-2)"]),
    "3": mapBinaryText(row["Sanitär"]),
    "4a": water || forest || mountain ? "S" : map05Score(row["Ruhe/Natur (0-5)"]),
    "4b": profile === "EXPLORER" ? map05Score(row["Törtchen-Faktor (0-5)"]) : map05Score(row["Törtchen-Faktor (0-5)"]),
    "5": winter ? "S" : map02Score(row["Winter-Score (0-2)"]),
    "6": water || forest ? "S" : map02Score(row["Spontan (0-2)"]),
    "7": profile === "DNA" && !lively ? "S" : inferOverallScore(row),
  };

  const reason = dedupeStrings([
    profile === "DNA" ? "Liste wirkt DNA-nah" : "Liste wirkt Explorer-nah",
    water ? "Wasserlage erkannt" : undefined,
    forest ? "Natur-/Wald-Signale erkannt" : undefined,
    mountain ? "Mittelgebirgs-/Berglage erkannt" : undefined,
    winter ? "Wintertauglichkeits-Signale erkannt" : undefined,
    lively ? "Lebhaftere Platzsignale erkannt" : undefined,
  ]).join(" | ");

  return { profile, scores, reason };
}

function inferHaltung(row: WorkbookRow, aiProfile: "DNA" | "EXPLORER") {
  const status = normalize(row["TS-Status"] ?? "");
  const listStatus = normalize(row["Liste/Status"] ?? "");
  if (status.includes("raus") || listStatus.includes("pragmatisch")) {
    return { dna: false, explorer: true };
  }
  if (status.includes("passt gut") || listStatus.includes("winterliste") || listStatus.includes("saisonliste")) {
    return { dna: true, explorer: false };
  }
  return { dna: aiProfile === "DNA", explorer: aiProfile === "EXPLORER" };
}

function boolFromTsValue(value: TS21Value): boolean | undefined {
  if (value === "S") return true;
  if (value === "X") return false;
  return undefined;
}

function buildImportedNotes(row: WorkbookRow, googlePlace: GooglePlace | null): string {
  return dedupeStrings([
    row.Notizen,
    row["Ort/Region"] ? `Ort/Region: ${row["Ort/Region"]}` : undefined,
    row.Typ ? `Typ: ${row.Typ}` : undefined,
    row["Entfernung ab Nievern (km, ca.)"] ? `Entfernung ab Nievern: ${row["Entfernung ab Nievern (km, ca.)"]} km` : undefined,
    row["TS-Status"] ? `TS-Status: ${row["TS-Status"]}` : undefined,
    row["Liste/Status"] ? `Liste/Status: ${row["Liste/Status"]}` : undefined,
    row["Prüf-Sicherheit"] ? `Prüf-Sicherheit: ${row["Prüf-Sicherheit"]}` : undefined,
    row["Sanitär"] ? `Sanitär: ${row["Sanitär"]}` : undefined,
    row["Winter-Score (0-2)"] ? `Winter-Score: ${row["Winter-Score (0-2)"]}/2` : undefined,
    row["Hunde-Score (0-2)"] ? `Hunde-Score: ${row["Hunde-Score (0-2)"]}/2` : undefined,
    row["Ruhe/Natur (0-5)"] ? `Ruhe/Natur: ${row["Ruhe/Natur (0-5)"]}/5` : undefined,
    row["Törtchen-Faktor (0-5)"] ? `Törtchen-Faktor: ${row["Törtchen-Faktor (0-5)"]}/5` : undefined,
    row["Spontan (0-2)"] ? `Spontan: ${row["Spontan (0-2)"]}/2` : undefined,
    row.Mindestaufenthalt ? `Mindestaufenthalt: ${row.Mindestaufenthalt}` : undefined,
    googlePlace?.websiteUri ? `Google-Website: ${googlePlace.websiteUri}` : undefined,
  ]).join("\n");
}

function getAliasQueries(row: WorkbookRow): string[] {
  const aliases = NAME_ALIASES[normalize(row.Name ?? "")] ?? [];
  return aliases.flatMap((alias) =>
    dedupeStrings([
      `${alias} ${row["Ort/Region"] ?? ""} camping`,
      `${alias} ${row["Ort/Region"] ?? ""}`,
      alias,
    ])
  );
}

function isLikelyStellplatzName(name: string): boolean {
  const normalized = normalize(name);
  return normalized.includes("stellplatz") || normalized.includes("wohnmobil");
}

function chooseHeroPhotos(googlePlace: GooglePlace | null) {
  const photos = Array.isArray(googlePlace?.photos) ? googlePlace.photos : [];

  const scored = photos
    .map((photo, index) => {
      const width = Number(photo.widthPx ?? 0);
      const height = Number(photo.heightPx ?? 0);
      const landscapeBonus = width > 0 && height > 0 ? (width / Math.max(height, 1) >= 1.15 ? 12 : 2) : 0;
      const sizeBonus = width >= 1200 ? 10 : width >= 800 ? 6 : width > 0 ? 2 : 0;
      return {
        source: "google" as const,
        url: buildGooglePhotoMediaUrl(photo.name, 1600),
        thumbUrl: buildGooglePhotoMediaUrl(photo.name, 480),
        width: photo.widthPx,
        height: photo.heightPx,
        score: 40 + sizeBonus + landscapeBonus - index * 4,
        reason: `Google Places Foto ${index + 1}${width && height ? ` (${width}x${height})` : ""}`,
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    chosen: scored[0] ?? null,
    candidates: scored.slice(0, 5),
  };
}

async function chooseHeroWithFallback(place: { id: number; name: string; type: PlaceType; lat: number; lng: number }) {
  const key = String(process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  const candidates = await discoverHeroCandidates(
    {
      id: place.id,
      name: place.name,
      type: place.type,
      lat: place.lat,
      lng: place.lng,
      heroImageUrl: null,
    },
    {
      googleKey: key,
      limit: 5,
      explorationLevel: 3,
      reloadRound: 1,
    }
  );

  return {
    chosen: candidates[0] ?? null,
    candidates,
  };
}

async function fetchGooglePlaces(query: string): Promise<GooglePlace[]> {
  const key = String(process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  if (!key) {
    throw new Error("Missing GOOGLE_PLACES_API_KEY or GOOGLE_MAPS_API_KEY.");
  }

  const response = await fetch(GOOGLE_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": key,
      "X-Goog-FieldMask": GOOGLE_FIELD_MASK,
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: "de",
      maxResultCount: 8,
    }),
  });

  if (!response.ok) {
    throw new Error(`Google Places search failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as { places?: GooglePlace[] };
  return Array.isArray(data.places) ? data.places : [];
}

function scoreGoogleMatch(row: WorkbookRow, place: GooglePlace): number {
  const candidateName = String(place.displayName?.text ?? "");
  const candidateWebsite = String(place.websiteUri ?? "");
  const location = place.location;
  const region = String(row["Ort/Region"] ?? "");
  const normalizedName = normalize(row.Name ?? "");
  const normalizedCandidateName = normalize(candidateName);
  const nameScore = overlapScore(row.Name ?? "", candidateName);
  const regionScore = overlapScore(region, `${candidateName} ${candidateWebsite}`);
  const photoBonus = Array.isArray(place.photos) && place.photos.length > 0 ? 12 : 0;
  const locationBonus = typeof location?.latitude === "number" && typeof location?.longitude === "number" ? 10 : -10;
  const campingBonus = normalize(candidateName).includes("camp") ? 8 : 0;
  const stellplatzBonus =
    inferPlaceType(row) === "STELLPLATZ" && (isLikelyStellplatzName(candidateName) || isLikelyStellplatzName(candidateWebsite)) ? 16 : 0;
  const aliasBonus = (NAME_ALIASES[normalize(row.Name ?? "")] ?? []).some((alias) =>
    normalize(candidateName).includes(normalize(alias))
  )
    ? 40
    : 0;
  const exactishNameBonus =
    normalizedName && normalizedCandidateName && (normalizedCandidateName.includes(normalizedName) || normalizedName.includes(normalizedCandidateName))
      ? 30
      : 0;

  return Math.round(nameScore * 58 + regionScore * 18 + photoBonus + locationBonus + campingBonus + stellplatzBonus + aliasBonus + exactishNameBonus);
}

async function findBestGooglePlace(row: WorkbookRow): Promise<{ best: GooglePlace | null; score: number }> {
  const queries = dedupeStrings([
    `${row.Name ?? ""} ${row["Ort/Region"] ?? ""} camping`,
    `${row.Name ?? ""} ${row["Ort/Region"] ?? ""}`,
    `${row.Name ?? ""} camping`,
    `${row.Name ?? ""}`,
    ...getAliasQueries(row),
  ]);

  let best: GooglePlace | null = null;
  let bestScore = -1;

  for (const query of queries) {
    const results = await fetchGooglePlaces(query);
    for (const place of results) {
      const score = scoreGoogleMatch(row, place);
      if (score > bestScore) {
        best = place;
        bestScore = score;
      }
    }
  }

  return { best, score: bestScore };
}

function readWorkbookRows(inputPath: string): WorkbookRow[] {
  const scriptPath = path.resolve(process.cwd(), "scripts/read-camping-workbook.ps1");
  const raw = execFileSync(
    "powershell",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Path", inputPath, "-SheetName", "Plaetze", "-HeaderRow", "4"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  return JSON.parse(raw) as WorkbookRow[];
}

function shouldSkipRow(row: WorkbookRow): string | null {
  const name = String(row.Name ?? "").trim();
  const listStatus = normalize(row["Liste/Status"] ?? "");
  if (!name) return "Missing place name";
  if (!inferPlaceType(row)) return `Unsupported type: ${row.Typ ?? "(leer)"}`;
  if (listStatus.includes("nicht existent") || listStatus.includes("deadlink") || listStatus.includes("eingestellt")) {
    return `Inactive place: ${row["Liste/Status"]}`;
  }
  return null;
}

async function upsertPlace(row: WorkbookRow, dryRun: boolean): Promise<ImportReportItem> {
  const skipReason = shouldSkipRow(row);
  const name = String(row.Name ?? "").trim() || "(leer)";
  if (skipReason) {
    return { rowNumber: row.__rowNumber, name, action: "skipped", message: skipReason };
  }

  const placeType = inferPlaceType(row);
  if (!placeType) {
    return { rowNumber: row.__rowNumber, name, action: "skipped", message: `Unsupported type: ${row.Typ ?? "(leer)"}` };
  }

  const { best, score } = await findBestGooglePlace(row);
  if (!best || score < 35) {
    return {
      rowNumber: row.__rowNumber,
      name,
      action: "error",
      matchScore: score,
      message: "No reliable Google Places match found",
    };
  }

  const lat = best.location?.latitude;
  const lng = best.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return {
      rowNumber: row.__rowNumber,
      name,
      action: "error",
      matchScore: score,
      matchedPlaceId: best.id,
      matchedPlaceName: best.displayName?.text,
      message: "Matched Google Places result has no coordinates",
    };
  }

  const ai = inferAiScores(row);
  const user = inferUserScores(row);
  const haltung = inferHaltung(row, ai.profile);
  const importedNotes = buildImportedNotes(row, best);
  let hero = chooseHeroPhotos(best);
  if (!hero.chosen) {
    hero = await chooseHeroWithFallback({
      id: row.__rowNumber,
      name,
      type: placeType,
      lat,
      lng,
    });
  }

  const ts21Payload = {
    activeSource: "USER" as const,
    ai: ai.scores,
    user,
    dna: haltung.dna,
    explorer: haltung.explorer,
    dnaExplorerNote: dedupeStrings([
      row["TS-Status"] ? `TS-Status: ${row["TS-Status"]}` : undefined,
      row["Liste/Status"] ? `Liste/Status: ${row["Liste/Status"]}` : undefined,
      row["Prüf-Sicherheit"] ? `Prüf-Sicherheit: ${row["Prüf-Sicherheit"]}` : undefined,
      ai.reason,
    ]).join("\n"),
    note: importedNotes,
  };

  const heroCandidateCreates = hero.candidates.map((candidate, index) => ({
    source: candidate.source,
    url: candidate.url,
    thumbUrl: candidate.thumbUrl,
    width: candidate.width,
    height: candidate.height,
    score: candidate.score,
    reason: `${candidate.reason}; Workbook row ${row.__rowNumber}; Google Place ${best.displayName?.text ?? name}; match ${score}`,
    rank: index + 1,
  }));

  const basePatch = {
    name,
    type: placeType,
    lat,
    lng,
    canonicalSource: "google_places",
    canonicalSourceId: best.id ?? null,
    coordinateSource: "google_places.searchText",
    coordinateConfidence: Math.min(1, Math.max(0.35, score / 100)),
    dogAllowed: boolFromTsValue(user["1a"]),
    sanitary: boolFromTsValue(user["3"]),
    yearRound: boolFromTsValue(user["5"]),
    onlineBooking: undefined,
    gastronomy: containsAny([row.Name, row.Notizen].filter(Boolean).join("\n"), ["restaurant", "bistro", "wellness", "rheinpark"]),
    heroImageUrl: hero.chosen?.url ?? null,
    heroScore: hero.chosen?.score ?? null,
    heroReason: hero.chosen
      ? `Workbook import: ${hero.chosen.reason}; matched Google Place '${best.displayName?.text ?? name}' with score ${score}.`
      : `Workbook import matched Google Place '${best.displayName?.text ?? name}' with score ${score}, but no photo was selected.`,
  };

  const createPatch = {
    ...basePatch,
    ratingDetail: {
      create: {
        note: importedNotes,
      },
    },
    ts21: {
      create: ts21Payload,
    },
    ...(heroCandidateCreates.length
      ? {
          heroCandidates: {
            create: heroCandidateCreates,
          },
        }
      : {}),
  };

  const updatePatch = {
    ...basePatch,
    ratingDetail: {
      upsert: {
        create: {
          note: importedNotes,
        },
        update: {
          note: importedNotes,
        },
      },
    },
    ts21: {
      upsert: {
        create: ts21Payload,
        update: ts21Payload,
      },
    },
    ...(heroCandidateCreates.length
      ? {
          heroCandidates: {
            deleteMany: {},
            create: heroCandidateCreates,
          },
        }
      : {}),
  };

  const existing =
    (best.id
      ? await prisma.place.findFirst({
          where: {
            OR: [{ canonicalSource: "google_places", canonicalSourceId: best.id }, { type: placeType, name }],
          },
          select: { id: true, name: true },
        })
      : await prisma.place.findFirst({
          where: { type: placeType, name },
          select: { id: true, name: true },
        })) ?? null;

  if (!dryRun) {
    if (existing) {
      await prisma.place.update({
        where: { id: existing.id },
        data: updatePatch,
      });
    } else {
      await prisma.place.create({
        data: createPatch,
      });
    }
  }

  return {
    rowNumber: row.__rowNumber,
    name,
    action: existing ? "updated" : "created",
    matchScore: score,
    matchedPlaceId: best.id,
    matchedPlaceName: best.displayName?.text,
    lat,
    lng,
    heroChosen: hero.chosen?.url ?? null,
    message: dryRun ? "Dry run only" : undefined,
  };
}

async function main() {
  const args = parseArgs();
  const rows = readWorkbookRows(path.resolve(args.input));
  const report: ImportReportItem[] = [];

  for (const row of rows) {
    try {
      const item = await upsertPlace(row, args.dryRun);
      report.push(item);
      console.log(`${item.action.toUpperCase()} row=${item.rowNumber} name=${item.name} score=${item.matchScore ?? "-"} ${item.message ?? ""}`.trim());
    } catch (error: any) {
      const item: ImportReportItem = {
        rowNumber: row.__rowNumber,
        name: String(row.Name ?? "").trim() || "(leer)",
        action: "error",
        message: String(error?.message ?? error ?? "Unknown error"),
      };
      report.push(item);
      console.error(`ERROR row=${item.rowNumber} name=${item.name} ${item.message}`);
    }
  }

  const summary = {
    total: report.length,
    created: report.filter((item) => item.action === "created").length,
    updated: report.filter((item) => item.action === "updated").length,
    skipped: report.filter((item) => item.action === "skipped").length,
    errors: report.filter((item) => item.action === "error").length,
    dryRun: args.dryRun,
  };

  const fullReport = { summary, report };
  const reportPath = path.resolve(process.cwd(), args.reportPath);
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(fullReport, null, 2), "utf8");

  console.log(JSON.stringify(summary, null, 2));
  console.log(`Report written to ${reportPath}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
