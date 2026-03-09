import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type CliArgs = {
  apply: boolean;
  key: string | null;
  limit: number | null;
  approved: boolean;
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

type ApprovedProposalFile = {
  proposals?: Proposal[];
};

type CuratedRow = {
  key: string;
  lat: number;
  lng: number;
  latRaw: string;
  lngRaw: string;
  latStart: number;
  latEnd: number;
  lngStart: number;
  lngEnd: number;
};

type Status = "WOULD_APPLY" | "CONFLICT" | "SKIPPED";

type Outcome = {
  key: string;
  oldLat: string;
  oldLng: string;
  newLat: string;
  newLng: string;
  deltaMeters: number;
  status: Status;
  reason?: string;
};

const PROPOSAL_FILE = "data/review/koblenz-goldset-quickwin-patch-proposal.json";
const APPROVED_PROPOSAL_FILE = "data/review/koblenz-goldset-quickwin-patch-proposal-approved.json";
const CURATED_FILE = "src/lib/curated-sightseeing-presets.ts";

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { apply: false, key: null, limit: null, approved: false };
  for (const arg of argv) {
    if (arg === "--apply") {
      args.apply = true;
      continue;
    }
    if (arg.startsWith("--key=")) {
      args.key = arg.slice("--key=".length).trim() || null;
      continue;
    }
    if (arg.startsWith("--limit=")) {
      const value = Number(arg.slice("--limit=".length));
      args.limit = Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
      continue;
    }
    if (arg === "--approved") {
      args.approved = true;
    }
  }
  return args;
}

function readJsonFile<T>(filePath: string): T {
  return JSON.parse(readFileSync(resolve(filePath), "utf8")) as T;
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

function parseCuratedRows(content: string): Map<string, CuratedRow> {
  const rows = new Map<string, CuratedRow>();
  const objectPattern = /\{[^{}]*\}/g;

  for (const match of content.matchAll(objectPattern)) {
    const rowText = match[0];
    const rowStart = match.index ?? 0;

    const keyMatch = /key:\s*"([^"]+)"/.exec(rowText);
    if (!keyMatch) continue;

    const latMatch = /lat:\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(rowText);
    const lngMatch = /lng:\s*(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/i.exec(rowText);
    if (!latMatch || !lngMatch) continue;

    const latRaw = latMatch[1];
    const lngRaw = lngMatch[1];
    const latPrefixLen = latMatch[0].length - latRaw.length;
    const lngPrefixLen = lngMatch[0].length - lngRaw.length;

    const latStart = rowStart + (latMatch.index ?? 0) + latPrefixLen;
    const lngStart = rowStart + (lngMatch.index ?? 0) + lngPrefixLen;

    rows.set(keyMatch[1], {
      key: keyMatch[1],
      lat: Number(latRaw),
      lng: Number(lngRaw),
      latRaw,
      lngRaw,
      latStart,
      latEnd: latStart + latRaw.length,
      lngStart,
      lngEnd: lngStart + lngRaw.length,
    });
  }

  return rows;
}

function formatCoord(value: number | undefined): string {
  return Number.isFinite(value) ? String(value) : "n/a";
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const sourceFile = args.approved ? APPROVED_PROPOSAL_FILE : PROPOSAL_FILE;
  const proposalFile = args.approved
    ? readJsonFile<ApprovedProposalFile>(sourceFile)
    : readJsonFile<ProposalFile>(sourceFile);
  const proposalsAll = proposalFile.proposals ?? [];

  const byKey = proposalsAll.filter((proposal) => {
    const key = String(proposal.placeKey ?? "");
    if (!key) return false;
    return args.key ? key === args.key : true;
  });
  const considered = args.limit ? byKey.slice(0, args.limit) : byKey;

  const curatedContent = readFileSync(resolve(CURATED_FILE), "utf8");
  const curatedRows = parseCuratedRows(curatedContent);

  const outcomes: Outcome[] = [];
  const replacements: Array<{ start: number; end: number; value: string }> = [];
  const seenKeys = new Set<string>();

  for (const proposal of considered) {
    const key = String(proposal.placeKey ?? "");
    const proposedLat = proposal.proposedLat;
    const proposedLng = proposal.proposedLng;

    if (!key) continue;

    if (seenKeys.has(key)) {
      outcomes.push({
        key,
        oldLat: "n/a",
        oldLng: "n/a",
        newLat: formatCoord(proposedLat),
        newLng: formatCoord(proposedLng),
        deltaMeters: Number.isFinite(proposal.deltaMeters) ? Math.round(Number(proposal.deltaMeters)) : 0,
        status: "SKIPPED",
        reason: "duplicate placeKey in proposal list",
      });
      continue;
    }
    seenKeys.add(key);

    const row = curatedRows.get(key);
    if (!row) {
      outcomes.push({
        key,
        oldLat: "n/a",
        oldLng: "n/a",
        newLat: formatCoord(proposedLat),
        newLng: formatCoord(proposedLng),
        deltaMeters: 0,
        status: "CONFLICT",
        reason: "placeKey not found in curated file",
      });
      continue;
    }

    if (!Number.isFinite(proposedLat) || !Number.isFinite(proposedLng)) {
      outcomes.push({
        key,
        oldLat: row.latRaw,
        oldLng: row.lngRaw,
        newLat: formatCoord(proposedLat),
        newLng: formatCoord(proposedLng),
        deltaMeters: 0,
        status: "CONFLICT",
        reason: "proposedLat/proposedLng missing",
      });
      continue;
    }

    if (row.lat !== proposal.currentLat || row.lng !== proposal.currentLng) {
      outcomes.push({
        key,
        oldLat: row.latRaw,
        oldLng: row.lngRaw,
        newLat: String(proposedLat),
        newLng: String(proposedLng),
        deltaMeters: Number.isFinite(proposal.deltaMeters)
          ? Math.round(Number(proposal.deltaMeters))
          : haversineMeters(row.lat, row.lng, proposedLat, proposedLng),
        status: "CONFLICT",
        reason: `currentLat/currentLng mismatch (proposal ${formatCoord(proposal.currentLat)},${formatCoord(proposal.currentLng)})`,
      });
      continue;
    }

    const deltaMeters = Number.isFinite(proposal.deltaMeters)
      ? Math.round(Number(proposal.deltaMeters))
      : haversineMeters(row.lat, row.lng, proposedLat, proposedLng);

    if (row.lat === proposedLat && row.lng === proposedLng) {
      outcomes.push({
        key,
        oldLat: row.latRaw,
        oldLng: row.lngRaw,
        newLat: String(proposedLat),
        newLng: String(proposedLng),
        deltaMeters,
        status: "SKIPPED",
        reason: "already at proposed coordinates",
      });
      continue;
    }

    outcomes.push({
      key,
      oldLat: row.latRaw,
      oldLng: row.lngRaw,
      newLat: String(proposedLat),
      newLng: String(proposedLng),
      deltaMeters,
      status: "WOULD_APPLY",
    });

    replacements.push({ start: row.latStart, end: row.latEnd, value: String(proposedLat) });
    replacements.push({ start: row.lngStart, end: row.lngEnd, value: String(proposedLng) });
  }

  const applicable = outcomes.filter((entry) => entry.status === "WOULD_APPLY").length;
  const conflicts = outcomes.filter((entry) => entry.status === "CONFLICT").length;
  const skipped = outcomes.filter((entry) => entry.status === "SKIPPED").length;

  console.log(`mode: ${args.apply ? "APPLY" : "DRY_RUN"}`);
  console.log(`source mode: ${args.approved ? "APPROVED" : "PROPOSAL"}`);
  console.log(`source file: ${sourceFile}`);
  console.log(`total proposals considered: ${considered.length}`);
  console.log(`applicable: ${applicable}`);
  console.log(`conflicts: ${conflicts}`);
  console.log(`skipped: ${skipped}`);

  for (const entry of outcomes) {
    const details = `${entry.key} | ${entry.oldLat},${entry.oldLng} -> ${entry.newLat},${entry.newLng} | ${entry.deltaMeters} | ${entry.status}`;
    console.log(entry.reason ? `${details} (${entry.reason})` : details);
  }

  if (args.apply && replacements.length > 0) {
    let nextContent = curatedContent;
    for (const change of replacements.sort((a, b) => b.start - a.start)) {
      nextContent = `${nextContent.slice(0, change.start)}${change.value}${nextContent.slice(change.end)}`;
    }
    writeFileSync(resolve(CURATED_FILE), nextContent, "utf8");
  }

  if (args.apply) {
    console.log(`updated count: ${applicable}`);
    console.log(`conflict count: ${conflicts}`);
    console.log(`skipped count: ${skipped}`);
  }
}

main();
