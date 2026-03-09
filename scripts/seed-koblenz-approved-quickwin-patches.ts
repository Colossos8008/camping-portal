import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type CliArgs = {
  dryRun: boolean;
  force: boolean;
};

type ApprovedProposal = {
  placeKey: string;
  placeName: string;
  currentLat: number;
  currentLng: number;
  proposedLat: number;
  proposedLng: number;
  deltaMeters: number;
  proposedSource: string;
  fallbackSource: string;
  confidenceBucket: "HIGH";
  proposalReason: string;
  manualCheckHint: string;
  patchText: string;
};

type ApprovedSnapshot = {
  approvedAt: string;
  approvedBy: string;
  note: string;
  sourceProposalFile: string;
  summary: {
    approvedCount: number;
  };
  proposals: ApprovedProposal[];
};

const TARGET_FILE = "data/review/koblenz-goldset-quickwin-patch-proposal-approved.json";

const FIXED_PROPOSALS: ApprovedProposal[] = [
  {
    placeKey: "ludwig-museum-koblenz",
    placeName: "Ludwig Museum Koblenz",
    currentLat: 50.3626,
    currentLng: 7.6059,
    proposedLat: 50.3627774,
    proposedLng: 7.605001699999999,
    deltaMeters: 67,
    proposedSource: "google_places",
    fallbackSource: "osm_nominatim",
    confidenceBucket: "HIGH",
    proposalReason:
      "Medium consensus for a location target with google_places and supporting secondary source.",
    manualCheckHint: "confirm museum entrance instead of area center",
    patchText:
      "Update ludwig-museum-koblenz from 50.3626, 7.6059 to 50.3627774, 7.605001699999999 using google_places; fallback osm_nominatim; delta ~67 m; confirm museum entrance instead of area center",
  },
  {
    placeKey: "basilika-st-kastor",
    placeName: "Basilika St. Kastor",
    currentLat: 50.36268,
    currentLng: 7.605,
    proposedLat: 50.362227399999995,
    proposedLng: 7.6044446,
    deltaMeters: 64,
    proposedSource: "google_places",
    fallbackSource: "osm_nominatim",
    confidenceBucket: "HIGH",
    proposalReason:
      "Medium consensus for a point-like target with google_places and supporting secondary source.",
    manualCheckHint: "prefer named building over surrounding street point",
    patchText:
      "Update basilika-st-kastor from 50.36268, 7.605 to 50.362227399999995, 7.6044446 using google_places; fallback osm_nominatim; delta ~64 m; prefer named building over surrounding street point",
  },
];

function parseArgs(argv: string[]): CliArgs {
  return {
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
  };
}

function buildSnapshot(): ApprovedSnapshot {
  return {
    approvedAt: new Date().toISOString(),
    approvedBy: "manual-review-seed",
    note: "Frozen approved quick-win snapshot for first two vetted Koblenz coordinate fixes.",
    sourceProposalFile: "manual-seed",
    summary: {
      approvedCount: FIXED_PROPOSALS.length,
    },
    proposals: FIXED_PROPOSALS,
  };
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const targetPath = resolve(TARGET_FILE);
  const fileExists = existsSync(targetPath);

  console.log(`mode: ${args.dryRun ? "DRY_RUN" : "WRITE"}`);
  console.log(`approved proposals: ${FIXED_PROPOSALS.length}`);
  console.log(`target file: ${TARGET_FILE}`);

  if (fileExists && !args.force) {
    console.error("overwrite prevented: target file already exists (use --force to overwrite)");
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    console.log("written: skipped (dry-run)");
    return;
  }

  const snapshot = buildSnapshot();
  writeFileSync(targetPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log("written: approved snapshot saved");
}

main();
