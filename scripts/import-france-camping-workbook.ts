import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { prisma } from "../src/lib/prisma.ts";
import { discoverHeroCandidates } from "../src/lib/hero-candidates.ts";
import { buildGooglePhotoMediaUrl } from "../src/lib/hero-image.ts";

type PlaceType = "CAMPINGPLATZ";
type TS21Value = "S" | "O" | "X";

type WorkbookRow = {
  __rowNumber: number;
  Nr?: string;
  Name?: string;
  Ort?: string;
  "Département / Region"?: string;
  Cluster?: string;
  Lage?: string;
  Saison?: string;
  "Sanitär - Text"?: string;
  "Sanitär - Score"?: string;
  "Hilde-Faktor - Text"?: string;
  "Hilde-Faktor - Score"?: string;
  "Preis-Leistung"?: string;
  "PL - Score"?: string;
  "DNA-Kategorie"?: string;
  "DNA - Score"?: string;
  Status?: string;
  Quelle?: string;
  Kurzfazit?: string;
  "Gesamt-Score"?: string;
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

function parseArgs(): Args {
  const inputArg = process.argv.slice(2).find((arg) => arg.startsWith("--input="));
  const reportArg = process.argv.slice(2).find((arg) => arg.startsWith("--report="));

  return {
    input: inputArg
      ? inputArg.slice("--input=".length)
      : "C:/Users/niels/Documents/00_Privat/Niels/camping-portal/Import-Templates/frankreich-camping-sammlung.xlsx",
    dryRun: process.argv.includes("--dry-run"),
    reportPath: reportArg ? reportArg.slice("--report=".length) : "data/import/france-camping-workbook-import-report.json",
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

function mapScore(value: string | undefined, thresholds = { s: 4, x: 2 }): TS21Value {
  const number = parseScore(value);
  if (number == null) return "O";
  if (number >= thresholds.s) return "S";
  if (number <= thresholds.x) return "X";
  return "O";
}

function containsAny(text: string, terms: string[]): boolean {
  const haystack = normalize(text);
  return terms.some((term) => haystack.includes(normalize(term)));
}

function inferProfile(row: WorkbookRow): "DNA" | "EXPLORER" {
  const category = normalize(row["DNA-Kategorie"] ?? "");
  const cluster = normalize(row.Cluster ?? "");
  const summary = normalize(row.Kurzfazit ?? "");

  if (
    category.includes("bewusste ausnahmen") ||
    summary.includes("club") ||
    summary.includes("premium urlaub") ||
    cluster.includes("ferien")
  ) {
    return "EXPLORER";
  }

  return "DNA";
}

function inferUserScores(row: WorkbookRow): Record<string, TS21Value> {
  const sanitary = mapScore(row["Sanitär - Score"], { s: 4, x: 2 });
  const hilde = mapScore(row["Hilde-Faktor - Score"], { s: 4, x: 2 });
  const value = mapScore(row["PL - Score"], { s: 4, x: 2.5 });
  const dna = mapScore(row["DNA - Score"], { s: 4, x: 2 });
  const total = mapScore(row["Gesamt-Score"], { s: 4.2, x: 3 });

  return {
    "1a": hilde,
    "1b": hilde,
    "2a": value,
    "2b": hilde,
    "3": sanitary,
    "4a": dna,
    "4b": value,
    "5": hilde,
    "6": value,
    "7": total,
  };
}

function inferAiScores(row: WorkbookRow): { profile: "DNA" | "EXPLORER"; scores: Record<string, TS21Value>; reason: string } {
  const profile = inferProfile(row);
  const text = [row.Name, row.Ort, row["Département / Region"], row.Cluster, row.Lage, row.Kurzfazit, row["DNA-Kategorie"]]
    .filter(Boolean)
    .join("\n");
  const water = containsAny(text, ["meer", "strand", "see", "lac", "fluss", "kanal", "bucht", "atlantik", "mittelmeer"]);
  const mountain = containsAny(text, ["berge", "verdon", "alpes", "mont", "panorama", "winter"]);
  const forest = containsAny(text, ["wald", "grun", "grün", "natur", "ruhig", "weite"]);
  const premium = containsAny(text, ["premium", "modern", "hochwertig"]);
  const lively = containsAny(text, ["belebt", "club", "ferienbetrieb", "gut frequentiert", "mehr leben"]);

  const scores: Record<string, TS21Value> = {
    "1a": forest || water ? "S" : "O",
    "1b": forest || mountain ? "S" : "O",
    "2a": premium ? "S" : mapScore(row["PL - Score"], { s: 4, x: 2.5 }),
    "2b": premium ? "S" : mapScore(row["Hilde-Faktor - Score"], { s: 4, x: 2 }),
    "3": mapScore(row["Sanitär - Score"], { s: 4, x: 2 }),
    "4a": water || mountain || forest ? "S" : mapScore(row["DNA - Score"], { s: 4, x: 2 }),
    "4b": premium ? "S" : mapScore(row["PL - Score"], { s: 4, x: 2.5 }),
    "5": lively ? "X" : mapScore(row["Hilde-Faktor - Score"], { s: 4, x: 2 }),
    "6": water || forest ? "S" : "O",
    "7": profile === "DNA" ? "S" : lively ? "X" : "O",
  };

  const reason = dedupeStrings([
    profile === "DNA" ? "DNA-Kategorie deutet auf DNA" : "DNA-Kategorie deutet auf Explorer",
    water ? "Wasserlage erkannt" : undefined,
    mountain ? "Berg-/Panoramalage erkannt" : undefined,
    forest ? "Natur-/Ruhe-Signale erkannt" : undefined,
    premium ? "Komfort-/Premium-Signale erkannt" : undefined,
    lively ? "Lebhaftere Platzsignale erkannt" : undefined,
  ])
    .slice(0, 4)
    .join(" | ");

  return { profile, scores, reason };
}

function inferHaltung(row: WorkbookRow, aiProfile: "DNA" | "EXPLORER") {
  const category = normalize(row["DNA-Kategorie"] ?? "");
  if (category.includes("bewusste ausnahmen")) {
    return { dna: false, explorer: true };
  }
  if (category.includes("kern")) {
    return { dna: true, explorer: false };
  }
  return { dna: aiProfile === "DNA", explorer: aiProfile === "EXPLORER" };
}

function buildImportedNotes(row: WorkbookRow, googlePlace: GooglePlace | null): string {
  return dedupeStrings([
    row.Kurzfazit,
    row.Ort ? `Ort: ${row.Ort}` : undefined,
    row["Département / Region"] ? `Region: ${row["Département / Region"]}` : undefined,
    row.Cluster ? `Cluster: ${row.Cluster}` : undefined,
    row.Lage ? `Lage: ${row.Lage}` : undefined,
    row.Saison ? `Saison: ${row.Saison}` : undefined,
    row["Sanitär - Text"] ? `Sanitär: ${row["Sanitär - Text"]}` : undefined,
    row["Hilde-Faktor - Text"] ? `Hilde-Faktor: ${row["Hilde-Faktor - Text"]}` : undefined,
    row["Preis-Leistung"] ? `Preis-Leistung: ${row["Preis-Leistung"]}` : undefined,
    row["DNA-Kategorie"] ? `DNA-Kategorie: ${row["DNA-Kategorie"]}` : undefined,
    row.Status ? `Status: ${row.Status}` : undefined,
    row.Quelle ? `Quelle: ${row.Quelle}` : undefined,
    googlePlace?.websiteUri ? `Google-Website: ${googlePlace.websiteUri}` : undefined,
  ]).join("\n");
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

async function chooseHeroWithFallback(place: {
  id: number;
  name: string;
  type: PlaceType;
  lat: number;
  lng: number;
}) {
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
      languageCode: "fr",
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
  const locationText = [row.Ort, row["Département / Region"], row.Lage].filter(Boolean).join(" ");
  const nameScore = overlapScore(row.Name ?? "", candidateName);
  const locationScore = overlapScore(locationText, `${candidateName} ${candidateWebsite}`);
  const photoBonus = Array.isArray(place.photos) && place.photos.length > 0 ? 12 : 0;
  const locationBonus =
    typeof place.location?.latitude === "number" && typeof place.location?.longitude === "number" ? 10 : -10;
  const campingBonus = normalize(candidateName).includes("camp") ? 12 : 0;
  const exactishNameBonus = normalize(candidateName).includes(normalize(row.Name ?? "")) ? 25 : 0;

  return Math.round(nameScore * 60 + locationScore * 20 + photoBonus + locationBonus + campingBonus + exactishNameBonus);
}

async function findBestGooglePlace(row: WorkbookRow): Promise<{ best: GooglePlace | null; score: number }> {
  const queries = dedupeStrings([
    `${row.Name ?? ""} ${row.Ort ?? ""}`,
    `${row.Name ?? ""} ${row["Département / Region"] ?? ""}`,
    `${row.Name ?? ""} camping ${row.Ort ?? ""}`,
    `${row.Name ?? ""} france camping`,
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
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Path", inputPath, "-SheetName", "Frankreich-Sammlung"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  return JSON.parse(raw) as WorkbookRow[];
}

function shouldSkipRow(row: WorkbookRow): string | null {
  if (!String(row.Name ?? "").trim()) return "Missing place name";
  if (!/^\d+$/.test(String(row.Nr ?? "").trim())) return "Non-data row";
  return null;
}

async function upsertPlace(row: WorkbookRow, dryRun: boolean): Promise<ImportReportItem> {
  const skipReason = shouldSkipRow(row);
  const name = String(row.Name ?? "").trim() || "(leer)";
  if (skipReason) {
    return { rowNumber: row.__rowNumber, name, action: "skipped", message: skipReason };
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
      type: "CAMPINGPLATZ",
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
      row["DNA-Kategorie"] ? `DNA-Kategorie: ${row["DNA-Kategorie"]}` : undefined,
      row.Cluster ? `Cluster: ${row.Cluster}` : undefined,
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
    reason: `${candidate.reason}; Google Place ${best.displayName?.text ?? name}; match ${score}`,
    rank: index + 1,
  }));

  const textBlob = [row.Lage, row.Kurzfazit, row.Cluster].filter(Boolean).join("\n");
  const basePatch = {
    name,
    type: "CAMPINGPLATZ" as PlaceType,
    lat,
    lng,
    canonicalSource: "google_places",
    canonicalSourceId: best.id ?? null,
    coordinateSource: "google_places.searchText",
    coordinateConfidence: Math.min(1, Math.max(0.35, score / 100)),
    sanitary: parseScore(row["Sanitär - Score"]) != null ? parseScore(row["Sanitär - Score"])! >= 3 : undefined,
    yearRound: containsAny(String(row.Saison ?? ""), ["winter", "janvier", "feb", "marz", "märz", "decembre", "décembre"]),
    onlineBooking: undefined,
    gastronomy: containsAny(textBlob, ["restaurant", "bistro", "bar", "cafe", "café"]),
    dogAllowed: undefined,
    heroImageUrl: hero.chosen?.url ?? null,
    heroScore: hero.chosen?.score ?? null,
    heroReason: hero.chosen
      ? `France workbook import: ${hero.chosen.reason}; matched Google Place '${best.displayName?.text ?? name}' with score ${score}.`
      : `France workbook import matched Google Place '${best.displayName?.text ?? name}' with score ${score}, but no photo was selected.`,
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
            OR: [{ canonicalSource: "google_places", canonicalSourceId: best.id }, { type: "CAMPINGPLATZ", name }],
          },
          select: { id: true, name: true },
        })
      : await prisma.place.findFirst({
          where: { type: "CAMPINGPLATZ", name },
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
