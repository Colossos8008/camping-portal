import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type GoldCoordinateStatus = "GOOD" | "OKAY" | "BAD" | "UNKNOWN";
type ConsensusQuality = "STRONG" | "MEDIUM" | "WEAK" | "NONE";
type RecommendedActionClass =
  | "QUICK_WIN"
  | "NEEDS_RULE_FIX"
  | "NEEDS_MANUAL_REVIEW"
  | "BLOCKED_BY_SOURCE_QUALITY"
  | "ALREADY_GOOD";

type SourceName = "google_places" | "osm_nominatim" | "osm_direct" | "wikidata" | "wikipedia";
type LikelyBestSource = SourceName | "mixed" | "unknown";

type GoldEntry = {
  placeKey?: string;
  placeName?: string;
  coordinateStatus?: string;
  imageStatus?: string;
  targetPointTypeExpected?: string;
};

type Candidate = {
  source?: string;
  lat?: number | null;
  lng?: number | null;
  status?: string;
  note?: string;
};

type ComparisonEntry = {
  placeKey?: string;
  placeName?: string;
  goldSetReview?: {
    coordinateStatus?: string;
    imageStatus?: string;
    targetPointTypeExpected?: string;
  };
  candidates?: Record<string, Candidate | undefined>;
  consensus?: {
    consensusQuality?: string;
    bestClusterSources?: string[];
    outlierSources?: string[];
    tightClusterCount?: number;
    looseClusterCount?: number;
  };
};

type PriorityResult = {
  placeKey: string;
  placeName: string;
  goldCoordinateStatus: GoldCoordinateStatus;
  goldImageStatus: string;
  targetPointTypeExpected: string;
  consensusQuality: ConsensusQuality;
  recommendedActionClass: RecommendedActionClass;
  recommendedActionReason: string;
  likelyBestSource: LikelyBestSource;
  likelyOutlierSources: SourceName[];
  likelySourceRankingIssue: boolean;
  sourceAgreementSummary: string;
  nextStep: string;
};

type CliArgs = { key: string | null; actionClass: RecommendedActionClass | null; write: boolean };

const GOLD_FILE = "data/review/koblenz-goldset-v1.json";
const COMPARE_FILE = "data/review/koblenz-goldset-source-comparison.json";
const OUTPUT_FILE = "data/review/koblenz-goldset-review-priorities.json";

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { key: null, actionClass: null, write: true };
  for (const arg of argv) {
    if (arg.startsWith("--key=")) out.key = arg.slice(6).trim() || null;
    else if (arg.startsWith("--class=")) {
      const raw = arg.slice(8).trim() as RecommendedActionClass;
      out.actionClass = ["QUICK_WIN", "NEEDS_RULE_FIX", "NEEDS_MANUAL_REVIEW", "BLOCKED_BY_SOURCE_QUALITY", "ALREADY_GOOD"].includes(raw)
        ? raw
        : null;
    } else if (arg === "--write") out.write = true;
  }
  return out;
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function normalizeCoordinateStatus(raw: string | undefined): GoldCoordinateStatus {
  if (raw === "GOOD" || raw === "OKAY" || raw === "BAD") return raw;
  return "UNKNOWN";
}

function normalizeConsensusQuality(raw: string | undefined): ConsensusQuality {
  if (raw === "STRONG" || raw === "MEDIUM" || raw === "WEAK" || raw === "NONE") return raw;
  return "NONE";
}

function hasCoordinates(candidate: Candidate | undefined): boolean {
  return Number.isFinite(candidate?.lat) && Number.isFinite(candidate?.lng);
}

function getSourceCandidates(candidates: Record<string, Candidate | undefined> | undefined): Candidate[] {
  if (!candidates) return [];
  return Object.values(candidates).filter((v): v is Candidate => Boolean(v));
}

function deriveLikelyBestSource(consensus: ComparisonEntry["consensus"], usableSources: SourceName[]): LikelyBestSource {
  const best = (consensus?.bestClusterSources ?? []).filter(Boolean) as SourceName[];
  if (best.length > 1) return "mixed";
  if (best.length === 1) return best[0];
  if (usableSources.length === 1) return usableSources[0];
  return "unknown";
}

function deriveNextStep(
  actionClass: RecommendedActionClass,
  context: { likelyGoogleOutlier: boolean; complexTarget: boolean; consensusQuality: ConsensusQuality; weakSourceSignal: boolean }
): string {
  if (actionClass === "ALREADY_GOOD") return "accept_cluster_candidate";
  if (actionClass === "QUICK_WIN") return "accept_cluster_candidate";
  if (actionClass === "NEEDS_RULE_FIX") return context.likelyGoogleOutlier ? "inspect_google_semantics" : "improve_source_ranking";
  if (actionClass === "BLOCKED_BY_SOURCE_QUALITY") return "wait_for_better_sources";
  if (context.complexTarget) return "manual_anchor_definition";
  if (context.weakSourceSignal || context.consensusQuality === "WEAK") return "collect_additional_sources";
  return "add_target_point_rule";
}

function classify(entry: GoldEntry, comparison: ComparisonEntry | undefined): PriorityResult {
  const placeKey = String(entry.placeKey ?? comparison?.placeKey ?? "unknown");
  const placeName = String(entry.placeName ?? comparison?.placeName ?? placeKey);
  const goldCoordinateStatus = normalizeCoordinateStatus(entry.coordinateStatus ?? comparison?.goldSetReview?.coordinateStatus);
  const goldImageStatus = String(entry.imageStatus ?? comparison?.goldSetReview?.imageStatus ?? "UNKNOWN");
  const targetPointTypeExpected = String(entry.targetPointTypeExpected ?? comparison?.goldSetReview?.targetPointTypeExpected ?? "UNKNOWN");
  const consensusQuality = normalizeConsensusQuality(comparison?.consensus?.consensusQuality);

  const candidates = getSourceCandidates(comparison?.candidates);
  const usableSources = candidates
    .filter((c) => c.status === "ok" && hasCoordinates(c))
    .map((c) => c.source)
    .filter((s): s is SourceName => ["google_places", "osm_nominatim", "osm_direct", "wikidata", "wikipedia"].includes(String(s)));

  const outlierSources = (comparison?.consensus?.outlierSources ?? []).filter((s): s is SourceName =>
    ["google_places", "osm_nominatim", "osm_direct", "wikidata", "wikipedia"].includes(String(s))
  );
  const likelyGoogleOutlier = outlierSources.includes("google_places")
    || (usableSources.includes("google_places")
      && (comparison?.consensus?.bestClusterSources ?? []).length > 0
      && !(comparison?.consensus?.bestClusterSources ?? []).includes("google_places"));

  const likelyBestSource = deriveLikelyBestSource(comparison?.consensus, usableSources);
  const manualTarget = ["AREA_ANCHOR", "VISITOR_POINT"].includes(targetPointTypeExpected);
  const complexTarget = manualTarget || targetPointTypeExpected === "COMPLEX_SITE";
  const hasCluster = (comparison?.consensus?.tightClusterCount ?? 0) > 0 || (comparison?.consensus?.looseClusterCount ?? 0) > 0;
  const strongOrMediumConsensus = consensusQuality === "STRONG" || consensusQuality === "MEDIUM";
  const weakOrNoneConsensus = consensusQuality === "WEAK" || consensusQuality === "NONE";
  const weakSourceSignal = usableSources.length <= 1;
  const likelySourceRankingIssue = goldCoordinateStatus === "BAD"
    && (likelyGoogleOutlier || (hasCluster && strongOrMediumConsensus && outlierSources.length > 0 && usableSources.length >= 2));

  let recommendedActionClass: RecommendedActionClass;
  let recommendedActionReason: string;

  if (goldCoordinateStatus === "GOOD" || (goldCoordinateStatus === "OKAY" && consensusQuality !== "NONE")) {
    recommendedActionClass = "ALREADY_GOOD";
    recommendedActionReason = "Gold-Set coordinate status is already acceptable for this POI.";
  } else if (goldCoordinateStatus === "BAD" && likelySourceRankingIssue) {
    recommendedActionClass = "NEEDS_RULE_FIX";
    recommendedActionReason = "BAD despite cluster/outlier pattern: source ranking is likely selecting the wrong candidate.";
  } else if (goldCoordinateStatus === "BAD" && strongOrMediumConsensus && hasCluster && !complexTarget) {
    recommendedActionClass = "QUICK_WIN";
    recommendedActionReason = "BAD with solid cluster consensus and no complex target-point semantics; likely easy coordinate correction.";
  } else if (goldCoordinateStatus === "BAD" && strongOrMediumConsensus && hasCluster && targetPointTypeExpected === "COMPLEX_SITE" && outlierSources.length === 0) {
    recommendedActionClass = "QUICK_WIN";
    recommendedActionReason = "BAD complex site, but sources converge on one stable cluster; can be fixed with low manual effort.";
  } else if (goldCoordinateStatus === "BAD" && (manualTarget || (targetPointTypeExpected === "COMPLEX_SITE" && weakOrNoneConsensus))) {
    recommendedActionClass = "NEEDS_MANUAL_REVIEW";
    recommendedActionReason = "BAD with anchor/visitor/complex-site semantics that need manual target-point verification.";
  } else if (goldCoordinateStatus === "BAD" && weakOrNoneConsensus && weakSourceSignal) {
    recommendedActionClass = "BLOCKED_BY_SOURCE_QUALITY";
    recommendedActionReason = "BAD and source evidence is too weak (single/no usable coordinate source) for a safe automated decision.";
  } else {
    recommendedActionClass = "NEEDS_MANUAL_REVIEW";
    recommendedActionReason = "BAD with conflicting or semantically ambiguous source signals; requires curator decision.";
  }

  const sourceAgreementSummary = comparison
    ? `usable=${usableSources.length}, consensus=${consensusQuality}, bestCluster=${(comparison.consensus?.bestClusterSources ?? []).join("+") || "none"}, outliers=${outlierSources.join("+") || "none"}`
    : "No comparison entry found for this placeKey; classification based on gold-set only.";

  const nextStep = deriveNextStep(recommendedActionClass, { likelyGoogleOutlier, complexTarget, consensusQuality, weakSourceSignal });

  return {
    placeKey,
    placeName,
    goldCoordinateStatus,
    goldImageStatus,
    targetPointTypeExpected,
    consensusQuality,
    recommendedActionClass,
    recommendedActionReason,
    likelyBestSource,
    likelyOutlierSources: outlierSources,
    likelySourceRankingIssue,
    sourceAgreementSummary,
    nextStep,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const gold = readJsonFile<GoldEntry[]>(GOLD_FILE);
  const comparisonPayload = readJsonFile<{ results?: ComparisonEntry[] }>(COMPARE_FILE);
  const comparisonByKey = new Map((comparisonPayload.results ?? []).map((entry) => [String(entry.placeKey ?? ""), entry]));

  const results = gold.map((entry) => classify(entry, comparisonByKey.get(String(entry.placeKey ?? ""))));
  const filtered = results
    .filter((entry) => (args.key ? entry.placeKey === args.key : true))
    .filter((entry) => (args.actionClass ? entry.recommendedActionClass === args.actionClass : true));

  const badEntries = filtered.filter((x) => x.goldCoordinateStatus === "BAD");
  const summary = {
    total: filtered.length,
    alreadyGood: filtered.filter((x) => x.recommendedActionClass === "ALREADY_GOOD").length,
    quickWin: filtered.filter((x) => x.recommendedActionClass === "QUICK_WIN").length,
    needsRuleFix: filtered.filter((x) => x.recommendedActionClass === "NEEDS_RULE_FIX").length,
    needsManualReview: filtered.filter((x) => x.recommendedActionClass === "NEEDS_MANUAL_REVIEW").length,
    blockedBySourceQuality: filtered.filter((x) => x.recommendedActionClass === "BLOCKED_BY_SOURCE_QUALITY").length,
    badStrongOrMediumConsensus: badEntries.filter((x) => x.consensusQuality === "STRONG" || x.consensusQuality === "MEDIUM").length,
    badWeakOrNoneConsensus: badEntries.filter((x) => x.consensusQuality === "WEAK" || x.consensusQuality === "NONE").length,
    badComplexTargetTypes: badEntries.filter((x) => ["AREA_ANCHOR", "VISITOR_POINT", "COMPLEX_SITE"].includes(x.targetPointTypeExpected)).length,
    badLikelySourceRankingIssues: badEntries.filter((x) => x.likelySourceRankingIssue).length,
  };

  const output = {
    generatedAt: new Date().toISOString(),
    inputs: {
      goldSet: GOLD_FILE,
      comparison: COMPARE_FILE,
    },
    summary,
    results: filtered,
  };

  if (args.write) {
    writeFileSync(resolve(OUTPUT_FILE), `${JSON.stringify(output, null, 2)}\n`, "utf8");
  }

  console.log(`total: ${summary.total}`);
  console.log(`count ALREADY_GOOD: ${summary.alreadyGood}`);
  console.log(`count QUICK_WIN: ${summary.quickWin}`);
  console.log(`count NEEDS_RULE_FIX: ${summary.needsRuleFix}`);
  console.log(`count NEEDS_MANUAL_REVIEW: ${summary.needsManualReview}`);
  console.log(`count BLOCKED_BY_SOURCE_QUALITY: ${summary.blockedBySourceQuality}`);
  console.log(`count BAD with STRONG/MEDIUM: ${summary.badStrongOrMediumConsensus}`);
  console.log(`count BAD with WEAK/NONE: ${summary.badWeakOrNoneConsensus}`);
  console.log(`count BAD complex target types: ${summary.badComplexTargetTypes}`);
  console.log(`count BAD likely source-ranking issues: ${summary.badLikelySourceRankingIssues}`);

  const listByClass = (klass: RecommendedActionClass) => filtered.filter((x) => x.recommendedActionClass === klass).map((x) => x.placeKey);
  console.log(`QUICK_WIN keys: ${listByClass("QUICK_WIN").join(", ") || "-"}`);
  console.log(`NEEDS_RULE_FIX keys: ${listByClass("NEEDS_RULE_FIX").join(", ") || "-"}`);
  console.log(`NEEDS_MANUAL_REVIEW keys: ${listByClass("NEEDS_MANUAL_REVIEW").join(", ") || "-"}`);
  console.log(`BLOCKED_BY_SOURCE_QUALITY keys: ${listByClass("BLOCKED_BY_SOURCE_QUALITY").join(", ") || "-"}`);

  const missingComparison = gold.filter((entry) => !comparisonByKey.has(String(entry.placeKey ?? ""))).length;
  if (missingComparison > 0) {
    console.log(`note: comparison entries missing for ${missingComparison} gold-set POIs; parser fell back to robust defaults.`);
  }
}

main();
