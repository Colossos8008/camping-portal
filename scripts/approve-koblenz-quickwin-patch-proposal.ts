import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type CliArgs = {
  force: boolean;
};

type Proposal = {
  placeKey?: string;
  currentLat?: number;
  currentLng?: number;
  proposedLat?: number;
  proposedLng?: number;
  deltaMeters?: number;
};

type ProposalFile = {
  proposals?: Proposal[];
};

type ApprovedSnapshot = {
  approvedAt: string;
  approvedBy: string;
  note: string;
  sourceProposalFile: string;
  summary: {
    approvedCount: number;
  };
  proposals: Proposal[];
};

const SOURCE_FILE = "data/review/koblenz-goldset-quickwin-patch-proposal.json";
const TARGET_FILE = "data/review/koblenz-goldset-quickwin-patch-proposal-approved.json";

function parseArgs(argv: string[]): CliArgs {
  return { force: argv.includes("--force") };
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(resolve(filePath), "utf8")) as T;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const proposalFile = readJsonFile<ProposalFile>(SOURCE_FILE);
  const proposals = proposalFile.proposals ?? [];

  console.log(`source proposals count: ${proposals.length}`);
  console.log(`approved count: ${proposals.length}`);
  console.log(`target file: ${TARGET_FILE}`);

  if (proposals.length === 0) {
    console.error("overwrite prevented: no proposals available in source proposal file");
    process.exitCode = 1;
    return;
  }

  if (existsSync(resolve(TARGET_FILE)) && !args.force) {
    console.error("overwrite prevented: target file already exists (use --force to overwrite)");
    process.exitCode = 1;
    return;
  }

  const snapshot: ApprovedSnapshot = {
    approvedAt: new Date().toISOString(),
    approvedBy: "manual-review",
    note: "Frozen approved quick-win snapshot",
    sourceProposalFile: SOURCE_FILE,
    summary: {
      approvedCount: proposals.length,
    },
    proposals,
  };

  writeFileSync(resolve(TARGET_FILE), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  console.log("written: approved snapshot saved");
}

main();
