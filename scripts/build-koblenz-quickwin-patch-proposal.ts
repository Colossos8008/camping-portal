import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type WorklistEntry = {
  placeKey?: string;
  placeName?: string;
  proposedLat?: number;
  proposedLng?: number;
  proposedSource?: string;
  fallbackSource?: string | null;
  confidenceBucket?: string;
  quickWinReason?: string;
  manualCheckHint?: string;
};

type WorklistFile = {
  worklist?: WorklistEntry[];
};

type CliArgs = { key: string | null; limit: number | null; write: boolean };

type CuratedCoords = {
  placeName: string;
  currentLat: number;
  currentLng: number;
};

type Proposal = {
  placeKey: string;
  placeName: string;
  currentLat: number;
  currentLng: number;
  proposedLat: number;
  proposedLng: number;
  deltaMeters: number;
  proposedSource: string;
  fallbackSource: string | null;
  confidenceBucket: string;
  proposalReason: string;
  manualCheckHint: string | null;
  patchText: string;
};

const WORKLIST_FILE = "data/review/koblenz-goldset-quickwin-worklist.json";
const CURATED_FILE = "src/lib/curated-sightseeing-presets";
const OUTPUT_FILE = "data/review/koblenz-goldset-quickwin-patch-proposal.json";

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { key: null, limit: null, write: true };
  for (const arg of argv) {
    if (arg.startsWith("--key=")) out.key = arg.slice(6).trim() || null;
    else if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice(8).trim());
      out.limit = Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
    } else if (arg === "--write") {
      out.write = true;
    }
  }
  return out;
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function parseCuratedCoordinates(filePath: string): Map<string, CuratedCoords> {
  const content = readFileSync(resolve(filePath), "utf8");
  const rows = new Map<string, CuratedCoords>();
  const rowPattern = /\{\s*key:\s*"([^"]+)"[\s\S]*?name:\s*"([^"]+)"[\s\S]*?lat:\s*(-?\d+(?:\.\d+)?)\s*,\s*lng:\s*(-?\d+(?:\.\d+)?)/g;

  for (const match of content.matchAll(rowPattern)) {
    const placeKey = match[1];
    const placeName = match[2];
    const lat = Number(match[3]);
    const lng = Number(match[4]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    rows.set(placeKey, { placeName, currentLat: lat, currentLng: lng });
  }

  return rows;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (value: number) => (value * Math.PI) / 180;
  const earthRadiusMeters = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusMeters * c);
}

function fallbackReason(entry: WorklistEntry): string {
  const quality = String(entry.confidenceBucket ?? "MEDIUM").toUpperCase();
  if (quality === "HIGH") return "Point-like target with strong enough evidence for curated coordinate correction.";
  if (quality === "LOW") return "Candidate is usable as a practical quick win, but needs explicit manual validation.";
  return "Quick win with medium consensus and near-identical Google/OSM candidates.";
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const worklistFile = readJsonFile<WorklistFile>(WORKLIST_FILE);
  const curatedByKey = parseCuratedCoordinates(CURATED_FILE);

  const selected = (worklistFile.worklist ?? []).filter((entry) => {
    if (!entry.placeKey) return false;
    return args.key ? entry.placeKey === args.key : true;
  });
  const limited = args.limit ? selected.slice(0, args.limit) : selected;

  const proposals: Proposal[] = [];
  const missing: Array<{ placeKey: string; reason: string }> = [];

  for (const entry of limited) {
    const placeKey = String(entry.placeKey ?? "");
    const proposedLat = Number(entry.proposedLat);
    const proposedLng = Number(entry.proposedLng);
    if (!placeKey || !Number.isFinite(proposedLat) || !Number.isFinite(proposedLng)) {
      continue;
    }

    const curated = curatedByKey.get(placeKey);
    if (!curated) {
      missing.push({ placeKey, reason: "placeKey not found in curated-sightseeing-presets" });
      continue;
    }

    const deltaMeters = haversineMeters(curated.currentLat, curated.currentLng, proposedLat, proposedLng);
    const proposedSource = String(entry.proposedSource ?? "unknown");
    const fallbackSource = entry.fallbackSource ?? null;
    const confidenceBucket = String(entry.confidenceBucket ?? "MEDIUM");
    const proposalReason = String(entry.quickWinReason ?? "").trim() || fallbackReason(entry);
    const manualCheckHint = entry.manualCheckHint ? String(entry.manualCheckHint) : null;

    const patchText = `Update ${placeKey} from ${curated.currentLat}, ${curated.currentLng} to ${proposedLat}, ${proposedLng} using ${proposedSource}; fallback ${fallbackSource ?? "none"}; delta ~${deltaMeters} m; ${manualCheckHint ?? "manual verification recommended."}`;

    proposals.push({
      placeKey,
      placeName: String(entry.placeName ?? curated.placeName),
      currentLat: curated.currentLat,
      currentLng: curated.currentLng,
      proposedLat,
      proposedLng,
      deltaMeters,
      proposedSource,
      fallbackSource,
      confidenceBucket,
      proposalReason,
      manualCheckHint,
      patchText,
    });
  }

  const output = {
    generatedAt: new Date().toISOString(),
    inputs: {
      worklist: WORKLIST_FILE,
      curatedPresetFile: CURATED_FILE,
    },
    summary: {
      totalQuickWins: limited.length,
      resolvedAgainstCurated: proposals.length,
      missingInCurated: missing.length,
    },
    proposals,
    missing,
  };

  if (args.write) {
    writeFileSync(resolve(OUTPUT_FILE), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

  console.log(`total quick wins: ${limited.length}`);
  console.log(`resolved against curated: ${proposals.length}`);
  console.log(`missing in curated: ${missing.length}`);
  for (const proposal of proposals) {
    console.log(`${proposal.placeKey} | ${proposal.deltaMeters} | ${proposal.proposedSource} | ${proposal.confidenceBucket}`);
  }
}

main();
