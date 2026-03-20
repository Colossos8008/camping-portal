import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

import { prisma } from "../src/lib/prisma.ts";
import { buildGooglePhotoMediaUrl } from "../src/lib/hero-image.ts";

type PlaceType = "CAMPINGPLATZ";
type TS21Value = "S" | "O" | "X";

type WorkbookRow = {
  __rowNumber: number;
  Name?: string;
  Region?: string;
  "Empfohlen durch"?: string;
  Cluster?: string;
  Status?: string;
  Typ?: string;
  "TS1 Sanitär"?: string;
  "TS2a Buchung"?: string;
  "TS2b Ankommen"?: string;
  "TS3 Öffnung/Winter"?: string;
  "TS4a Umgebung"?: string;
  "TS4b Stellplatz"?: string;
  "TS5 Hunde"?: string;
  "TS6 Ruhe"?: string;
  "TS7 Spontan"?: string;
  "TS-Ø"?: string;
  Fit?: string;
  Confidence?: string;
  "Google Maps"?: string;
  Website?: string;
  "Quelle(n)"?: string;
  Notizen?: string;
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
      : "C:/Users/niels/Documents/00_Privat/Niels/camping-portal/Import-Templates/campingplatzsammlung_ts20_mit_maps.xlsx",
    dryRun: process.argv.includes("--dry-run"),
    reportPath: reportArg ? reportArg.slice("--report=".length) : "data/import/camping-workbook-import-report.json",
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

function parseUrlList(raw: string | undefined): string[] {
  return String(raw ?? "")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => /^https?:\/\//i.test(item));
}

function canonicalizeHost(host: string): string {
  return host.replace(/^www\./i, "").trim().toLowerCase();
}

function getHostname(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return canonicalizeHost(new URL(raw).hostname);
  } catch {
    return null;
  }
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

function mapNumericScore(value: string | undefined): TS21Value {
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number)) return "O";
  if (number >= 4) return "S";
  if (number <= 1) return "X";
  return "O";
}

function mapAverageScore(value: string | undefined, fit: string | undefined): TS21Value {
  const number = Number(String(value ?? "").replace(",", "."));
  if (Number.isFinite(number)) {
    if (number >= 3.2) return "S";
    if (number <= 2.0) return "X";
  }

  const fitNorm = normalize(fit ?? "");
  if (fitNorm.includes("sehr passend")) return "S";
  if (fitNorm.includes("situations")) return "X";
  return "O";
}

function inferUserScores(row: WorkbookRow): Record<string, TS21Value> {
  return {
    "1a": mapNumericScore(row["TS5 Hunde"]),
    "1b": mapNumericScore(row["TS5 Hunde"]),
    "2a": mapNumericScore(row["TS2a Buchung"]),
    "2b": mapNumericScore(row["TS2b Ankommen"]),
    "3": mapNumericScore(row["TS1 Sanitär"]),
    "4a": mapNumericScore(row["TS4a Umgebung"]),
    "4b": mapNumericScore(row["TS4b Stellplatz"]),
    "5": mapNumericScore(row["TS6 Ruhe"]),
    "6": mapNumericScore(row["TS7 Spontan"]),
    "7": mapAverageScore(row["TS-Ø"], row.Fit),
  };
}

function containsAny(text: string, terms: string[]): boolean {
  const haystack = normalize(text);
  return terms.some((term) => haystack.includes(normalize(term)));
}

function inferAiScores(row: WorkbookRow): { profile: "DNA" | "EXPLORER"; scores: Record<string, TS21Value>; reason: string } {
  const text = [
    row.Name,
    row.Region,
    row.Cluster,
    row.Typ,
    row.Fit,
    row.Confidence,
    row.Notizen,
    row["Quelle(n)"],
  ]
    .filter(Boolean)
    .join("\n");

  const cluster = normalize(row.Cluster ?? "");
  const typeText = normalize(row.Typ ?? "");
  const notes = normalize(row.Notizen ?? "");
  const fit = normalize(row.Fit ?? "");

  const isExplorer = cluster.includes("explorer") || fit.includes("situations") || notes.includes("ausnahme");
  const profile: "DNA" | "EXPLORER" = isExplorer ? "EXPLORER" : "DNA";

  const water = containsAny(text, ["see", "ostsee", "bodensee", "strand", "küste", "meer", "beach", "lake"]);
  const mountain = containsAny(text, ["berg", "alpen", "zugspitz", "harz"]);
  const forest = containsAny(text, ["wald", "natur", "ruhig", "naturnah", "grün", "forest"]);
  const comfort = containsAny(text, ["komfort", "hochwertig", "boutique", "premium", "quality", "high-end"]);
  const eventy = containsAny(text, ["event", "lebhaft", "ferien", "highlight"]);
  const winter = containsAny(text, ["winter", "ganzjahr", "ganzjähr", "saison", "saisonbetrieb"]);
  const dogs = containsAny(text, ["hund", "dogs", "dog"]);
  const booking = containsAny(text, ["booking", "website", "buchung", "online"]);

  const scores: Record<string, TS21Value> = {
    "1a": dogs ? "S" : mapNumericScore(row["TS5 Hunde"]),
    "1b": forest || water ? "S" : mapNumericScore(row["TS5 Hunde"]),
    "2a": booking || comfort ? "S" : mapNumericScore(row["TS2a Buchung"]),
    "2b": comfort ? "S" : mapNumericScore(row["TS2b Ankommen"]),
    "3": comfort ? "S" : mapNumericScore(row["TS1 Sanitär"]),
    "4a": water || forest || mountain ? "S" : mapNumericScore(row["TS4a Umgebung"]),
    "4b": comfort ? "S" : mapNumericScore(row["TS4b Stellplatz"]),
    "5": eventy ? "X" : mapNumericScore(row["TS6 Ruhe"]),
    "6": forest || water ? "S" : mapNumericScore(row["TS7 Spontan"]),
    "7": profile === "DNA" && !eventy ? "S" : profile === "EXPLORER" ? "O" : mapAverageScore(row["TS-Ø"], row.Fit),
  };

  const reasons = dedupeStrings([
    profile === "DNA" ? "Cluster/Fit deutet auf DNA" : "Cluster/Fit deutet auf Explorer",
    water ? "Wasserlage erkannt" : undefined,
    forest ? "Natur-/Ruhe-Signale erkannt" : undefined,
    mountain ? "Bergkulisse erkannt" : undefined,
    comfort ? "Komfortsignale erkannt" : undefined,
    eventy ? "Event-/Highlight-Signale erkannt" : undefined,
  ]);

  return {
    profile,
    scores,
    reason: reasons.slice(0, 4).join(" | "),
  };
}

function inferHaltung(row: WorkbookRow, aiProfile: "DNA" | "EXPLORER") {
  const cluster = normalize(row.Cluster ?? "");
  const fit = normalize(row.Fit ?? "");
  if (cluster.includes("explorer")) {
    return { dna: false, explorer: true };
  }
  if (fit.includes("situations")) {
    return { dna: false, explorer: true };
  }
  if (cluster.includes("dna") || cluster.includes("highlight") || cluster.includes("weite") || cluster.includes("mini auszeit")) {
    return { dna: true, explorer: false };
  }
  return { dna: aiProfile === "DNA", explorer: aiProfile === "EXPLORER" };
}

function boolFromScore(value: string | undefined, threshold = 3): boolean | undefined {
  const number = Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(number)) return undefined;
  return number >= threshold;
}

function buildImportedNotes(row: WorkbookRow, sources: string[], googlePlace: GooglePlace | null): string {
  const parts = dedupeStrings([
    row.Notizen,
    `Region: ${row.Region ?? ""}`.trim(),
    `Empfohlen durch: ${row["Empfohlen durch"] ?? ""}`.trim(),
    `Cluster: ${row.Cluster ?? ""}`.trim(),
    `Fit/Confidence: ${dedupeStrings([row.Fit, row.Confidence]).join(" / ")}`.trim(),
    row.Typ ? `Beschreibung: ${row.Typ}` : undefined,
    sources.length ? `Quelle(n): ${sources.join(" | ")}` : undefined,
    googlePlace?.websiteUri ? `Google-Website: ${googlePlace.websiteUri}` : undefined,
  ]);

  return parts.join("\n");
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
        rank: index + 1,
      };
    })
    .sort((a, b) => b.score - a.score);

  return {
    chosen: scored[0] ?? null,
    candidates: scored.slice(0, 5),
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

function scoreGoogleMatch(row: WorkbookRow, place: GooglePlace, sourceDomains: string[]): number {
  const candidateName = String(place.displayName?.text ?? "");
  const candidateWebsite = String(place.websiteUri ?? "");
  const location = place.location;
  const region = String(row.Region ?? "");
  const normalizedName = normalize(row.Name ?? "");
  const normalizedCandidateName = normalize(candidateName);
  const nameScore = overlapScore(row.Name ?? "", candidateName);
  const regionScore = overlapScore(region, `${candidateName} ${candidateWebsite}`);
  const hostBonus = sourceDomains.some((domain) => domain && domain === getHostname(candidateWebsite)) ? 30 : 0;
  const photoBonus = Array.isArray(place.photos) && place.photos.length > 0 ? 12 : 0;
  const locationBonus =
    typeof location?.latitude === "number" && typeof location?.longitude === "number" ? 10 : -10;
  const campingBonus = normalize(candidateName).includes("camp") ? 8 : 0;
  const exactishNameBonus =
    normalizedName && normalizedCandidateName && (normalizedCandidateName.includes(normalizedName) || normalizedName.includes(normalizedCandidateName))
      ? 30
      : 0;

  return Math.round(nameScore * 55 + regionScore * 15 + hostBonus + photoBonus + locationBonus + campingBonus + exactishNameBonus);
}

async function findBestGooglePlace(row: WorkbookRow): Promise<{ best: GooglePlace | null; score: number }> {
  const queries = dedupeStrings([
    `${row.Name ?? ""}`,
    `${row.Name ?? ""} ${row.Region ?? ""} camping`,
    `${row.Name ?? ""} ${row.Region ?? ""}`,
    `${row.Name ?? ""} camping`,
  ]);

  const sourceDomains = parseUrlList(row["Quelle(n)"]).map((url) => getHostname(url)).filter(Boolean) as string[];
  let best: GooglePlace | null = null;
  let bestScore = -1;

  for (const query of queries) {
    const results = await fetchGooglePlaces(query);
    for (const place of results) {
      const score = scoreGoogleMatch(row, place, sourceDomains);
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
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath, "-Path", inputPath, "-SheetName", "Campingplätze"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    }
  );

  return JSON.parse(raw) as WorkbookRow[];
}

async function upsertPlace(row: WorkbookRow, dryRun: boolean): Promise<ImportReportItem> {
  const name = String(row.Name ?? "").trim();
  if (!name) {
    return { rowNumber: row.__rowNumber, name: "(leer)", action: "skipped", message: "Missing place name" };
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
  const sources = parseUrlList(row["Quelle(n)"]);
  const importedNotes = buildImportedNotes(row, sources, best);
  const hero = chooseHeroPhotos(best);
  const ts21Payload = {
    activeSource: "USER" as const,
    ai: ai.scores,
    user,
    dna: haltung.dna,
    explorer: haltung.explorer,
    dnaExplorerNote: dedupeStrings([
      `Cluster: ${row.Cluster ?? ""}`.trim(),
      `Fit: ${row.Fit ?? ""}`.trim(),
      `Confidence: ${row.Confidence ?? ""}`.trim(),
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

  const basePatch = {
    name,
    type: "CAMPINGPLATZ" as PlaceType,
    lat,
    lng,
    canonicalSource: "google_places",
    canonicalSourceId: best.id ?? null,
    coordinateSource: "google_places.searchText",
    coordinateConfidence: Math.min(1, Math.max(0.35, score / 100)),
    dogAllowed: boolFromScore(row["TS5 Hunde"], 3),
    sanitary: boolFromScore(row["TS1 Sanitär"], 2),
    yearRound: boolFromScore(row["TS3 Öffnung/Winter"], 3),
    onlineBooking: boolFromScore(row["TS2a Buchung"], 3),
    gastronomy: containsAny([row.Typ, row.Notizen, row["Quelle(n)"]].filter(Boolean).join("\n"), [
      "restaurant",
      "bistro",
      "bar",
      "cafe",
      "café",
      "pizzeria",
      "gastronomie",
    ]),
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
