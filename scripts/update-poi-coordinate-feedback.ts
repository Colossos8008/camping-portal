import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Decision = "CONFIRMED" | "REJECTED";

type FeedbackItem = {
  placeKey?: string;
  placeName?: string;
  region?: string;
  targetPointType?: string;
  decision?: string;
  selectedSource?: string;
  selectedLat?: number;
  selectedLng?: number;
  reviewNote?: string;
  reviewedBy?: string;
  reviewedAt?: string;
};

type FeedbackFile = {
  version?: number;
  generatedAt?: string;
  notes?: string;
  items?: FeedbackItem[];
};

type GoldSetEntry = {
  placeKey?: string;
  placeName?: string;
  targetPointTypeExpected?: string;
};

type PriorityEntry = {
  placeKey?: string;
  placeName?: string;
  targetPointTypeExpected?: string;
  likelyBestSource?: string;
};

type TrainingRow = {
  placeKey?: string;
  placeName?: string;
  region?: string;
  targetPointTypeExpected?: string;
  candidateSource?: string;
  candidateLat?: number | null;
  candidateLng?: number | null;
};

type CliArgs = {
  key: string;
  decision: Decision;
  note: string | null;
  source: string | null;
  lat: number | null;
  lng: number | null;
  dryRun: boolean;
  reviewedBy: string;
};

const INPUTS = {
  feedback: "data/review/poi-coordinate-feedback-v1.json",
  goldSet: "data/review/koblenz-goldset-v1.json",
  priorities: "data/review/koblenz-goldset-review-priorities.json",
  training: "data/review/poi-coordinate-training-dataset.json",
};

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(resolve(path), "utf8")) as T;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseDecision(value: string | null): Decision {
  if (value === "CONFIRMED" || value === "REJECTED") return value;
  throw new Error("--decision must be CONFIRMED or REJECTED");
}

function parseArgs(argv: string[]): CliArgs {
  const pairs = new Map<string, string>();
  const flags = new Set<string>();

  for (const arg of argv) {
    if (!arg.startsWith("--")) continue;
    const eqIndex = arg.indexOf("=");
    if (eqIndex === -1) {
      flags.add(arg.slice(2));
      continue;
    }
    const key = arg.slice(2, eqIndex);
    const value = arg.slice(eqIndex + 1);
    pairs.set(key, value);
  }

  const key = String(pairs.get("key") ?? "").trim();
  if (!key) throw new Error("--key is required");

  const decision = parseDecision((pairs.get("decision") ?? "").trim() || null);
  const note = pairs.has("note") ? String(pairs.get("note") ?? "") : null;
  const source = pairs.has("source") ? String(pairs.get("source") ?? "").trim() || null : null;
  const reviewedByRaw = pairs.has("reviewed-by") ? String(pairs.get("reviewed-by") ?? "").trim() : "manual-cli";
  const reviewedBy = reviewedByRaw || "manual-cli";

  const hasLat = pairs.has("lat");
  const hasLng = pairs.has("lng");
  if (hasLat !== hasLng) throw new Error("--lat and --lng must be provided together");

  const lat = hasLat ? Number(pairs.get("lat")) : null;
  const lng = hasLng ? Number(pairs.get("lng")) : null;
  if (hasLat && (!isFiniteNumber(lat) || !isFiniteNumber(lng))) {
    throw new Error("--lat and --lng must be finite numbers");
  }

  return {
    key,
    decision,
    note,
    source,
    lat,
    lng,
    dryRun: flags.has("dry-run"),
    reviewedBy,
  };
}

function pickEnrichment(
  key: string,
  existing: FeedbackItem | undefined,
  goldByKey: Map<string, GoldSetEntry>,
  priorityByKey: Map<string, PriorityEntry>,
  trainingRowsByKey: Map<string, TrainingRow[]>,
): { placeName: string; region: string; targetPointType: string; selectedSource?: string; selectedLat?: number; selectedLng?: number } {
  const gold = goldByKey.get(key);
  const priority = priorityByKey.get(key);
  const trainingRows = trainingRowsByKey.get(key) ?? [];
  const withCoords = trainingRows.find((row) => isFiniteNumber(row.candidateLat) && isFiniteNumber(row.candidateLng));

  const placeName =
    String(existing?.placeName ?? "").trim() ||
    String(gold?.placeName ?? "").trim() ||
    String(priority?.placeName ?? "").trim() ||
    String(trainingRows[0]?.placeName ?? "").trim() ||
    key;

  const region =
    String(existing?.region ?? "").trim() ||
    String(trainingRows[0]?.region ?? "").trim() ||
    "unknown";

  const targetPointType =
    String(existing?.targetPointType ?? "").trim() ||
    String(gold?.targetPointTypeExpected ?? "").trim() ||
    String(priority?.targetPointTypeExpected ?? "").trim() ||
    String(trainingRows[0]?.targetPointTypeExpected ?? "").trim() ||
    "UNKNOWN";

  return {
    placeName,
    region,
    targetPointType,
    selectedSource: existing?.selectedSource ?? withCoords?.candidateSource,
    selectedLat: existing?.selectedLat ?? (isFiniteNumber(withCoords?.candidateLat) ? withCoords.candidateLat : undefined),
    selectedLng: existing?.selectedLng ?? (isFiniteNumber(withCoords?.candidateLng) ? withCoords.candidateLng : undefined),
  };
}

function main(): void {
  try {
    const args = parseArgs(process.argv.slice(2));
    const feedback = readJsonFile<FeedbackFile>(INPUTS.feedback);

    const gold = existsSync(resolve(INPUTS.goldSet)) ? readJsonFile<GoldSetEntry[]>(INPUTS.goldSet) : [];
    const priorities = existsSync(resolve(INPUTS.priorities))
      ? readJsonFile<{ results?: PriorityEntry[] }>(INPUTS.priorities).results ?? []
      : [];
    const trainingRows = existsSync(resolve(INPUTS.training))
      ? readJsonFile<{ rows?: TrainingRow[] }>(INPUTS.training).rows ?? []
      : [];

    const goldByKey = new Map(gold.map((entry) => [String(entry.placeKey ?? "").trim(), entry]));
    const priorityByKey = new Map(priorities.map((entry) => [String(entry.placeKey ?? "").trim(), entry]));

    const trainingRowsByKey = new Map<string, TrainingRow[]>();
    for (const row of trainingRows) {
      const rowKey = String(row.placeKey ?? "").trim();
      if (!rowKey) continue;
      const rows = trainingRowsByKey.get(rowKey) ?? [];
      rows.push(row);
      trainingRowsByKey.set(rowKey, rows);
    }

    const currentItems = Array.isArray(feedback.items) ? feedback.items : [];
    const uniqueByKey = new Map<string, FeedbackItem>();
    for (const item of currentItems) {
      const itemKey = String(item.placeKey ?? "").trim();
      if (!itemKey) continue;
      uniqueByKey.set(itemKey, item);
    }

    const existing = uniqueByKey.get(args.key);
    const action = existing ? "UPDATED" : "CREATED";

    const enrichment = pickEnrichment(args.key, existing, goldByKey, priorityByKey, trainingRowsByKey);

    const selectedSource = args.source ?? enrichment.selectedSource;
    const selectedLat = args.lat ?? enrichment.selectedLat;
    const selectedLng = args.lng ?? enrichment.selectedLng;

    const nextItem: FeedbackItem = {
      placeKey: args.key,
      placeName: enrichment.placeName,
      region: enrichment.region,
      targetPointType: enrichment.targetPointType,
      decision: args.decision,
      selectedSource,
      selectedLat,
      selectedLng,
      reviewNote: args.note ?? existing?.reviewNote ?? "",
      reviewedBy: args.reviewedBy,
      reviewedAt: new Date().toISOString().slice(0, 10),
    };

    uniqueByKey.set(args.key, nextItem);
    const nextItems = Array.from(uniqueByKey.values());

    const nextPayload: FeedbackFile = {
      ...feedback,
      generatedAt: new Date().toISOString(),
      items: nextItems,
    };

    const mode = args.dryRun ? "DRY_RUN" : "WRITE";
    console.log(`mode: ${mode}`);
    console.log(`action: ${action}`);
    console.log(`placeKey: ${args.key}`);
    console.log(`decision: ${args.decision}`);
    console.log(`selectedSource: ${selectedSource ?? "(none)"}`);

    if (args.dryRun) {
      console.log("file: skipped");
      console.log(JSON.stringify(nextItem, null, 2));
      return;
    }

    writeFileSync(resolve(INPUTS.feedback), `${JSON.stringify(nextPayload, null, 2)}\n`, "utf8");
    console.log(`file: written (${INPUTS.feedback})`);
    console.log("hint: Run npm run build:poi-coordinate-training-dataset");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`error: ${message}`);
    process.exitCode = 1;
  }
}

main();
