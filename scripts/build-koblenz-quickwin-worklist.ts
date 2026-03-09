import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type ConsensusQuality = "STRONG" | "MEDIUM" | "WEAK" | "NONE";
type SourceName = "google_places" | "osm_nominatim" | "osm_direct" | "wikidata" | "wikipedia";

type PriorityEntry = {
  placeKey?: string;
  placeName?: string;
  goldCoordinateStatus?: string;
  targetPointTypeExpected?: string;
  consensusQuality?: ConsensusQuality;
  recommendedActionClass?: string;
  likelyBestSource?: string;
};

type Candidate = {
  source?: string;
  lat?: number | null;
  lng?: number | null;
  label?: string;
  status?: string;
  confidenceHint?: string;
};

type ComparisonEntry = {
  placeKey?: string;
  placeName?: string;
  goldSetReview?: {
    coordinateStatus?: string;
    targetPointTypeExpected?: string;
  };
  candidates?: Record<string, Candidate | undefined>;
  consensus?: {
    consensusQuality?: string;
    bestClusterSources?: string[];
  };
};

type WorklistItem = {
  placeKey: string;
  placeName: string;
  goldCoordinateStatus: string;
  targetPointTypeExpected: string;
  consensusQuality: string;
  likelyBestSource: string;
  proposedSource: string;
  proposedLat: number;
  proposedLng: number;
  proposedLabel: string;
  fallbackSource: string | null;
  fallbackLat: number | null;
  fallbackLng: number | null;
  fallbackLabel: string | null;
  confidenceBucket: "HIGH" | "MEDIUM" | "LOW";
  quickWinReason: string;
  manualCheckHint: string;
};

type CliArgs = { key: string | null; limit: number | null; write: boolean };

const GOLD_FILE = "data/review/koblenz-goldset-v1.json";
const COMPARE_FILE = "data/review/koblenz-goldset-source-comparison.json";
const PRIORITIES_FILE = "data/review/koblenz-goldset-review-priorities.json";
const OUTPUT_FILE = "data/review/koblenz-goldset-quickwin-worklist.json";
const SOURCE_ORDER: SourceName[] = ["google_places", "osm_nominatim", "osm_direct", "wikidata", "wikipedia"];

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { key: null, limit: null, write: true };
  for (const arg of argv) {
    if (arg.startsWith("--key=")) out.key = arg.slice(6).trim() || null;
    else if (arg.startsWith("--limit=")) {
      const parsed = Number(arg.slice(8).trim());
      out.limit = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
    } else if (arg === "--write") out.write = true;
  }
  return out;
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function hasCoordinates(candidate: Candidate | undefined): candidate is Candidate & { lat: number; lng: number } {
  return Number.isFinite(candidate?.lat) && Number.isFinite(candidate?.lng);
}

function normalizeSourceName(input: string | undefined): SourceName | null {
  if (!input) return null;
  const source = input.trim() as SourceName;
  if (SOURCE_ORDER.includes(source)) return source;
  return null;
}

function isWikibaseIdentityOnly(candidate: Candidate): boolean {
  const hint = String(candidate.confidenceHint ?? "").toLowerCase();
  return hint.includes("identity");
}

function getUsableCandidates(comparison: ComparisonEntry | undefined): Array<Candidate & { source: SourceName; lat: number; lng: number }> {
  const values = Object.values(comparison?.candidates ?? {});
  const usable: Array<Candidate & { source: SourceName; lat: number; lng: number }> = [];
  for (const candidate of values) {
    const source = normalizeSourceName(candidate?.source);
    if (!source || !hasCoordinates(candidate)) continue;
    if ((source === "wikidata" || source === "wikipedia") && isWikibaseIdentityOnly(candidate)) continue;
    usable.push({ ...candidate, source, lat: Number(candidate.lat), lng: Number(candidate.lng) });
  }
  return usable;
}

function selectProposedSource(
  likelyBestSource: string,
  consensusBest: string[],
  usableBySource: Map<SourceName, Candidate & { source: SourceName; lat: number; lng: number }>
): SourceName | null {
  const likely = normalizeSourceName(likelyBestSource);
  if (likely && usableBySource.has(likely)) return likely;

  for (const sourceRaw of consensusBest) {
    const source = normalizeSourceName(sourceRaw);
    if (source && usableBySource.has(source)) return source;
  }

  for (const source of SOURCE_ORDER) {
    if (usableBySource.has(source)) return source;
  }

  return null;
}

function selectFallbackSource(
  proposed: SourceName,
  consensusBest: string[],
  usableBySource: Map<SourceName, Candidate & { source: SourceName; lat: number; lng: number }>
): SourceName | null {
  for (const sourceRaw of consensusBest) {
    const source = normalizeSourceName(sourceRaw);
    if (source && source !== proposed && usableBySource.has(source)) return source;
  }

  for (const source of SOURCE_ORDER) {
    if (source !== proposed && usableBySource.has(source)) return source;
  }

  return null;
}

function deriveConfidence(consensusQuality: string, hasFallback: boolean): "HIGH" | "MEDIUM" | "LOW" {
  if ((consensusQuality === "STRONG" || consensusQuality === "MEDIUM") && hasFallback) return "HIGH";
  if (consensusQuality === "MEDIUM" || consensusQuality === "WEAK" || (consensusQuality === "STRONG" && !hasFallback)) {
    return hasFallback ? "MEDIUM" : "LOW";
  }
  return hasFallback ? "MEDIUM" : "LOW";
}

function deriveManualCheckHint(placeName: string, targetPointTypeExpected: string): string {
  const text = `${placeName} ${targetPointTypeExpected}`.toLowerCase();
  if (text.includes("kirche") || text.includes("church")) return "compare map marker against church entrance";
  if (text.includes("museum")) return "confirm museum entrance instead of area center";
  if (text.includes("denkmal") || text.includes("monument")) return "verify monument point against satellite view";
  if (text.includes("platz") || text.includes("square")) return "verify square center versus street edge";
  if (targetPointTypeExpected === "EXACT_OBJECT") return "prefer named building over surrounding street point";
  return "verify point marker against the named POI entrance";
}

function deriveQuickWinReason(consensusQuality: string, targetPointTypeExpected: string, proposedSource: string, hasFallback: boolean): string {
  const targetText = targetPointTypeExpected === "EXACT_OBJECT" ? "point-like" : "location";
  const supportText = hasFallback ? "and supporting secondary source" : "as the only concrete source signal";
  if (consensusQuality === "STRONG") return `Strong consensus for a ${targetText} target with ${proposedSource} ${supportText}.`;
  if (consensusQuality === "MEDIUM") return `Medium consensus for a ${targetText} target with ${proposedSource} ${supportText}.`;
  return `${targetText[0].toUpperCase()}${targetText.slice(1)} target with plausible ${proposedSource} candidate ${supportText}.`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const priorities = readJsonFile<{ results?: PriorityEntry[] }>(PRIORITIES_FILE);
  const comparisons = readJsonFile<{ results?: ComparisonEntry[] }>(COMPARE_FILE);
  const goldSet = readJsonFile<Array<{ placeKey?: string; coordinateStatus?: string; targetPointTypeExpected?: string }>>(GOLD_FILE);

  const comparisonByKey = new Map((comparisons.results ?? []).map((entry) => [String(entry.placeKey ?? ""), entry]));
  const goldByKey = new Map(goldSet.map((entry) => [String(entry.placeKey ?? ""), entry]));

  const quickWins = (priorities.results ?? []).filter((entry) => entry.recommendedActionClass === "QUICK_WIN");
  const filteredQuickWins = quickWins.filter((entry) => (args.key ? entry.placeKey === args.key : true));

  const worklist: WorklistItem[] = [];
  const skipped: Array<{ placeKey: string; reason: string }> = [];

  for (const entry of filteredQuickWins) {
    const placeKey = String(entry.placeKey ?? "unknown");
    const comparison = comparisonByKey.get(placeKey);
    const usableCandidates = getUsableCandidates(comparison);
    const usableBySource = new Map(usableCandidates.map((candidate) => [candidate.source, candidate]));
    const consensusBest = comparison?.consensus?.bestClusterSources ?? [];

    const proposedSource = selectProposedSource(String(entry.likelyBestSource ?? ""), consensusBest, usableBySource);
    if (!proposedSource) {
      skipped.push({ placeKey, reason: "no concrete candidate source found from comparison data" });
      continue;
    }

    const proposed = usableBySource.get(proposedSource);
    if (!proposed) {
      skipped.push({ placeKey, reason: `proposed source ${proposedSource} has no coordinates` });
      continue;
    }

    const fallbackSource = selectFallbackSource(proposedSource, consensusBest, usableBySource);
    const fallback = fallbackSource ? usableBySource.get(fallbackSource) ?? null : null;

    const placeName = String(entry.placeName ?? comparison?.placeName ?? placeKey);
    const gold = goldByKey.get(placeKey);
    const targetPointTypeExpected = String(
      entry.targetPointTypeExpected ?? comparison?.goldSetReview?.targetPointTypeExpected ?? gold?.targetPointTypeExpected ?? "UNKNOWN"
    );
    const consensusQuality = String(entry.consensusQuality ?? comparison?.consensus?.consensusQuality ?? "NONE");
    const goldCoordinateStatus = String(entry.goldCoordinateStatus ?? comparison?.goldSetReview?.coordinateStatus ?? gold?.coordinateStatus ?? "UNKNOWN");

    worklist.push({
      placeKey,
      placeName,
      goldCoordinateStatus,
      targetPointTypeExpected,
      consensusQuality,
      likelyBestSource: String(entry.likelyBestSource ?? "unknown"),
      proposedSource,
      proposedLat: proposed.lat,
      proposedLng: proposed.lng,
      proposedLabel: String(proposed.label ?? placeName),
      fallbackSource,
      fallbackLat: fallback?.lat ?? null,
      fallbackLng: fallback?.lng ?? null,
      fallbackLabel: fallback ? String(fallback.label ?? placeName) : null,
      confidenceBucket: deriveConfidence(consensusQuality, Boolean(fallback)),
      quickWinReason: deriveQuickWinReason(consensusQuality, targetPointTypeExpected, proposedSource, Boolean(fallback)),
      manualCheckHint: deriveManualCheckHint(placeName, targetPointTypeExpected),
    });
  }

  const limitedWorklist = args.limit ? worklist.slice(0, args.limit) : worklist;

  const output = {
    generatedAt: new Date().toISOString(),
    inputs: {
      goldSet: GOLD_FILE,
      comparison: COMPARE_FILE,
      priorities: PRIORITIES_FILE,
    },
    summary: {
      totalQuickWinsInPriorities: filteredQuickWins.length,
      worklistCount: limitedWorklist.length,
      skippedCount: skipped.length,
    },
    worklist: limitedWorklist,
    skipped,
  };

  if (args.write) {
    writeFileSync(resolve(OUTPUT_FILE), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

  console.log(`total quick wins in priorities: ${filteredQuickWins.length}`);
  console.log(`worklist count: ${limitedWorklist.length}`);
  console.log(`skipped count: ${skipped.length}`);
  for (const item of limitedWorklist) {
    console.log(`${item.placeKey} | ${item.proposedSource} | ${item.fallbackSource ?? "none"} | ${item.confidenceBucket}`);
  }
}

main();
