import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Decision = "CONFIRMED" | "REJECTED";
type ConsensusQuality = "STRONG" | "MEDIUM" | "WEAK" | "NONE";

type GoldSetEntry = {
  placeKey?: string;
  placeName?: string;
  coordinateStatus?: string;
  targetPointTypeExpected?: string;
};

type PriorityEntry = {
  placeKey?: string;
  consensusQuality?: string;
  likelyBestSource?: string;
  likelyOutlierSources?: string[];
};

type Candidate = {
  source?: string;
  lat?: number | null;
  lng?: number | null;
  status?: string;
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
    outlierSources?: string[];
  };
  distances?: {
    candidateToCenterMeters?: Record<string, number | undefined>;
  };
};

type FeedbackItem = {
  placeKey?: string;
  placeName?: string;
  region?: string;
  targetPointType?: string;
  decision?: string;
  selectedSource?: string;
  selectedLat?: number;
  selectedLng?: number;
  reviewedAt?: string;
};

type ApprovedProposal = {
  placeKey?: string;
  placeName?: string;
  proposedSource?: string;
  proposedLat?: number;
  proposedLng?: number;
  deltaMeters?: number;
};

type CandidateRow = {
  placeKey: string;
  placeName: string;
  region: string;
  goldCoordinateStatus: string;
  targetPointTypeExpected: string;
  feedbackDecision: Decision | "NONE";
  feedbackSelectedSource: string | null;
  candidateSource: string;
  candidateLat: number | null;
  candidateLng: number | null;
  isSelectedCandidate: boolean;
  isRejectedCandidate: boolean;
  consensusQuality: ConsensusQuality;
  inBestCluster: boolean;
  isOutlier: boolean;
  distanceToCurrentMeters: number | null;
  distanceToSelectedMeters: number | null;
  usableSourceCount: number;
  targetPointTypeMatches: boolean;
  sourceFamily: string;
  hasExactObjectHint: boolean;
  notes: string[];
};

type CliArgs = {
  verifyFeedbackOnly: boolean;
  key: string | null;
  write: boolean;
};

const INPUTS = {
  goldSet: "data/review/koblenz-goldset-v1.json",
  comparison: "data/review/koblenz-goldset-source-comparison.json",
  priorities: "data/review/koblenz-goldset-review-priorities.json",
  feedback: "data/review/poi-coordinate-feedback-v1.json",
  approvedSnapshot: "data/review/koblenz-goldset-quickwin-patch-proposal-approved.json",
};

const OUTPUT_FILE = "data/review/poi-coordinate-training-dataset.json";

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { verifyFeedbackOnly: false, key: null, write: true };
  for (const arg of argv) {
    if (arg === "--verify-feedback-only") args.verifyFeedbackOnly = true;
    else if (arg.startsWith("--key=")) args.key = arg.slice(6).trim() || null;
    else if (arg === "--dry-run" || arg === "--write=false") args.write = false;
  }
  return args;
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function normalizeConsensus(raw: string | undefined): ConsensusQuality {
  if (raw === "STRONG" || raw === "MEDIUM" || raw === "WEAK" || raw === "NONE") return raw;
  return "NONE";
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function sourceFamily(source: string): string {
  if (source.startsWith("google")) return "google";
  if (source.startsWith("osm")) return "osm";
  if (source.startsWith("wiki")) return "wiki";
  if (source.startsWith("approved")) return "approved_snapshot";
  if (source.startsWith("feedback")) return "manual_feedback";
  return "other";
}

function getDistanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function validateFeedback(feedbackItems: FeedbackItem[], goldByKey: Map<string, GoldSetEntry>): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenKeys = new Set<string>();

  for (const item of feedbackItems) {
    const key = String(item.placeKey ?? "").trim();
    if (!key) {
      errors.push("Feedback item missing placeKey.");
      continue;
    }
    if (seenKeys.has(key)) warnings.push(`Duplicate feedback for placeKey=${key}; latest entry will win.`);
    seenKeys.add(key);

    if (item.decision !== "CONFIRMED" && item.decision !== "REJECTED") errors.push(`Invalid decision for ${key}: ${String(item.decision)}`);
    if (!item.selectedSource) errors.push(`Missing selectedSource for ${key}.`);
    if (!isFiniteNumber(item.selectedLat) || !isFiniteNumber(item.selectedLng)) {
      errors.push(`Missing/invalid selected coordinates for ${key}.`);
    }
    if (!goldByKey.has(key)) warnings.push(`Feedback key ${key} not found in gold set.`);
  }

  return { errors, warnings };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  const gold = readJsonFile<GoldSetEntry[]>(INPUTS.goldSet);
  const comparisonPayload = readJsonFile<{ results?: ComparisonEntry[] }>(INPUTS.comparison);
  const prioritiesPayload = readJsonFile<{ results?: PriorityEntry[] }>(INPUTS.priorities);
  const feedbackPayload = readJsonFile<{ items?: FeedbackItem[] }>(INPUTS.feedback);
  const approvedPayload = existsSync(resolve(INPUTS.approvedSnapshot))
    ? readJsonFile<{ proposals?: ApprovedProposal[] }>(INPUTS.approvedSnapshot)
    : { proposals: [] };

  const goldByKey = new Map(gold.map((entry) => [String(entry.placeKey ?? ""), entry]));
  const comparisonByKey = new Map((comparisonPayload.results ?? []).map((entry) => [String(entry.placeKey ?? ""), entry]));
  const prioritiesByKey = new Map((prioritiesPayload.results ?? []).map((entry) => [String(entry.placeKey ?? ""), entry]));
  const feedbackByKey = new Map((feedbackPayload.items ?? []).map((entry) => [String(entry.placeKey ?? ""), entry]));
  const approvedByKey = new Map((approvedPayload.proposals ?? []).map((entry) => [String(entry.placeKey ?? ""), entry]));

  const validation = validateFeedback(feedbackPayload.items ?? [], goldByKey);
  for (const warning of validation.warnings) console.log(`warning: ${warning}`);
  if (validation.errors.length > 0) {
    for (const error of validation.errors) console.error(`error: ${error}`);
    process.exitCode = 1;
    return;
  }

  if (args.verifyFeedbackOnly) {
    console.log(`feedback entries: ${(feedbackPayload.items ?? []).length}`);
    console.log("feedback verification passed");
    return;
  }

  const keys = args.key ? [args.key] : Array.from(new Set([...goldByKey.keys(), ...feedbackByKey.keys()]));
  const rows: CandidateRow[] = [];

  for (const key of keys) {
    const goldEntry = goldByKey.get(key);
    const comparison = comparisonByKey.get(key);
    const priority = prioritiesByKey.get(key);
    const feedback = feedbackByKey.get(key);
    const approved = approvedByKey.get(key);

    const placeName = String(feedback?.placeName ?? goldEntry?.placeName ?? comparison?.placeName ?? approved?.placeName ?? key);
    const targetPointTypeExpected = String(goldEntry?.targetPointTypeExpected ?? feedback?.targetPointType ?? comparison?.goldSetReview?.targetPointTypeExpected ?? "UNKNOWN");
    const consensusQuality = normalizeConsensus(comparison?.consensus?.consensusQuality ?? priority?.consensusQuality);

    const candidateMap = new Map<string, { source: string; lat: number | null; lng: number | null; note: string }>();
    for (const candidate of Object.values(comparison?.candidates ?? {})) {
      if (!candidate?.source) continue;
      candidateMap.set(candidate.source, {
        source: candidate.source,
        lat: isFiniteNumber(candidate.lat) ? candidate.lat : null,
        lng: isFiniteNumber(candidate.lng) ? candidate.lng : null,
        note: candidate.status ?? "unknown",
      });
    }

    if (feedback?.selectedSource && isFiniteNumber(feedback.selectedLat) && isFiniteNumber(feedback.selectedLng)) {
      candidateMap.set(feedback.selectedSource, {
        source: feedback.selectedSource,
        lat: feedback.selectedLat,
        lng: feedback.selectedLng,
        note: "from_feedback",
      });
    }

    if (approved?.proposedSource && isFiniteNumber(approved.proposedLat) && isFiniteNumber(approved.proposedLng)) {
      candidateMap.set(approved.proposedSource, {
        source: approved.proposedSource,
        lat: approved.proposedLat,
        lng: approved.proposedLng,
        note: "from_approved_snapshot",
      });
    }

    if (candidateMap.size === 0) {
      candidateMap.set("no_candidate_available", { source: "no_candidate_available", lat: null, lng: null, note: "no_compare_or_feedback" });
    }

    const usableSourceCount = Array.from(candidateMap.values()).filter((c) => isFiniteNumber(c.lat) && isFiniteNumber(c.lng)).length;
    const bestCluster = new Set(comparison?.consensus?.bestClusterSources ?? []);
    const outlier = new Set(comparison?.consensus?.outlierSources ?? priority?.likelyOutlierSources ?? []);
    const selectedSource = feedback?.selectedSource ?? null;
    const selectedLat = isFiniteNumber(feedback?.selectedLat) ? feedback!.selectedLat : null;
    const selectedLng = isFiniteNumber(feedback?.selectedLng) ? feedback!.selectedLng : null;

    for (const candidate of candidateMap.values()) {
      const selectedMatch = Boolean(selectedSource && selectedSource === candidate.source);
      const isRejectedCandidate = feedback?.decision === "REJECTED" ? selectedMatch : Boolean(feedback && !selectedMatch);
      const hasCoords = isFiniteNumber(candidate.lat) && isFiniteNumber(candidate.lng);

      let distanceToSelectedMeters: number | null = null;
      if (hasCoords && selectedLat !== null && selectedLng !== null) {
        distanceToSelectedMeters = getDistanceMeters(candidate.lat!, candidate.lng!, selectedLat, selectedLng);
      }

      const distanceToCurrentMetersRaw = comparison?.distances?.candidateToCenterMeters?.[candidate.source] ?? approved?.deltaMeters;
      rows.push({
        placeKey: key,
        placeName,
        region: String(feedback?.region ?? "koblenz"),
        goldCoordinateStatus: String(goldEntry?.coordinateStatus ?? comparison?.goldSetReview?.coordinateStatus ?? "UNKNOWN"),
        targetPointTypeExpected,
        feedbackDecision: feedback?.decision === "CONFIRMED" || feedback?.decision === "REJECTED" ? feedback.decision : "NONE",
        feedbackSelectedSource: selectedSource,
        candidateSource: candidate.source,
        candidateLat: candidate.lat,
        candidateLng: candidate.lng,
        isSelectedCandidate: selectedMatch,
        isRejectedCandidate,
        consensusQuality,
        inBestCluster: bestCluster.has(candidate.source),
        isOutlier: outlier.has(candidate.source),
        distanceToCurrentMeters: typeof distanceToCurrentMetersRaw === "number" ? Math.round(distanceToCurrentMetersRaw) : null,
        distanceToSelectedMeters,
        usableSourceCount,
        targetPointTypeMatches: targetPointTypeExpected === String(feedback?.targetPointType ?? targetPointTypeExpected),
        sourceFamily: sourceFamily(candidate.source),
        hasExactObjectHint: candidate.source.includes("exact_object"),
        notes: [candidate.note],
      });
    }
  }

  const summary = {
    places: new Set(rows.map((row) => row.placeKey)).size,
    candidateRows: rows.length,
    confirmedPlaces: new Set(rows.filter((row) => row.feedbackDecision === "CONFIRMED").map((row) => row.placeKey)).size,
    rejectedPlaces: new Set(rows.filter((row) => row.feedbackDecision === "REJECTED").map((row) => row.placeKey)).size,
  };

  const output = {
    generatedAt: new Date().toISOString(),
    inputs: {
      ...INPUTS,
      approvedSnapshotUsed: existsSync(resolve(INPUTS.approvedSnapshot)),
    },
    summary,
    rows,
  };

  if (args.write) writeFileSync(resolve(OUTPUT_FILE), `${JSON.stringify(output, null, 2)}\n`, "utf8");

  console.log(`places: ${summary.places}`);
  console.log(`candidateRows: ${summary.candidateRows}`);
  console.log(`confirmedPlaces: ${summary.confirmedPlaces}`);
  console.log(`rejectedPlaces: ${summary.rejectedPlaces}`);
  if (!comparisonPayload.results || comparisonPayload.results.length === 0) {
    console.log("note: comparison dataset missing/empty, fallback candidate logic used.");
  }
}

main();
