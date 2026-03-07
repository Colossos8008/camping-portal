import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  areLikelySamePlace,
  buildOverpassQuery,
  normalizeCandidate,
  parseOverpassElements,
  REGION_CONFIGS,
  type TargetRegion,
} from "../src/lib/sightseeing-seed-import.ts";

const OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const REQUEST_TIMEOUT_MS = 45_000;

type CliOptions = {
  region: TargetRegion | "all";
  limit: number | null;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
};

type ExistingPlace = {
  id: number;
  name: string;
  type: "SEHENSWUERDIGKEIT";
  lat: number;
  lng: number;
};

type RegionSummary = {
  region: string;
  fetched: number;
  normalized: number;
  afterDedupe: number;
  processed: number;
  created: number;
  skippedDuplicate: number;
  skippedError: number;
};

function parseCliArgs(argv: string[]): CliOptions {
  const args = new Set(argv);

  const readValue = (prefix: string): string | null => {
    const hit = argv.find((x) => x.startsWith(`${prefix}=`));
    if (!hit) return null;
    return hit.slice(prefix.length + 1).trim() || null;
  };

  const regionRaw = (readValue("--region") ?? "all").toLowerCase();
  if (!["all", "normandie", "bretagne"].includes(regionRaw)) {
    throw new Error("Invalid --region value. Allowed: all | normandie | bretagne");
  }

  const limitRaw = readValue("--limit");
  const limit = limitRaw ? Number(limitRaw) : null;
  if (limitRaw && (!Number.isFinite(limit) || Number(limit) <= 0)) {
    throw new Error("Invalid --limit value. Must be a positive number.");
  }

  return {
    region: regionRaw as CliOptions["region"],
    limit: limit ? Math.floor(limit) : null,
    dryRun: args.has("--dry-run"),
    force: args.has("--force"),
    verbose: args.has("--verbose"),
  };
}

async function fetchOverpass(region: TargetRegion): Promise<unknown> {
  const query = buildOverpassQuery(REGION_CONFIGS[region]);
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(OVERPASS_URL, {
      method: "POST",
      body: query,
      signal: abortController.signal,
      headers: {
        "content-type": "text/plain;charset=UTF-8",
      },
    });

    if (!response.ok) {
      const payload = await response.text().catch(() => "");
      throw new Error(`Overpass request failed (${response.status}): ${payload.slice(0, 300)}`);
    }

    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function runRegionImport(options: {
  prisma: any;
  region: TargetRegion;
  globalLimit: number | null;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
}): Promise<RegionSummary> {
  const { prisma, region, dryRun, force, verbose, globalLimit } = options;

  const payload = await fetchOverpass(region);
  const elements = parseOverpassElements(payload);

  const normalized = elements
    .map((el) => normalizeCandidate(el, REGION_CONFIGS[region]))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));

  const uniqueBySource = new Map<string, (typeof normalized)[number]>();
  for (const candidate of normalized) {
    if (!uniqueBySource.has(candidate.sourceId)) {
      uniqueBySource.set(candidate.sourceId, candidate);
    }
  }

  const distinctCandidates = Array.from(uniqueBySource.values());

  const existingRows = (await prisma.place.findMany({
    where: { type: "SEHENSWUERDIGKEIT" },
    select: { id: true, name: true, lat: true, lng: true, type: true },
  })) as ExistingPlace[];

  const accepted: typeof distinctCandidates = [];
  const seenInBatch: typeof distinctCandidates = [];

  for (const candidate of distinctCandidates) {
    const duplicateInBatch = seenInBatch.find((x) =>
      areLikelySamePlace({
        nameA: x.name,
        latA: x.lat,
        lngA: x.lng,
        nameB: candidate.name,
        latB: candidate.lat,
        lngB: candidate.lng,
      })
    );

    if (duplicateInBatch) {
      if (verbose) {
        console.log(`skip batch-duplicate: ${candidate.name} ~ ${duplicateInBatch.name}`);
      }
      continue;
    }

    seenInBatch.push(candidate);
    accepted.push(candidate);
  }

  const effectiveList = globalLimit ? accepted.slice(0, globalLimit) : accepted;

  let created = 0;
  let skippedDuplicate = 0;
  let skippedError = 0;

  for (const candidate of effectiveList) {
    try {
      const duplicateInDb = existingRows.find((existing) =>
        areLikelySamePlace({
          nameA: existing.name,
          latA: existing.lat,
          lngA: existing.lng,
          nameB: candidate.name,
          latB: candidate.lat,
          lngB: candidate.lng,
        })
      );

      if (duplicateInDb && !force) {
        skippedDuplicate += 1;
        if (verbose) {
          console.log(`skip db-duplicate: ${candidate.name} -> #${duplicateInDb.id} ${duplicateInDb.name}`);
        }
        continue;
      }

      if (dryRun) {
        created += 1;
        if (verbose) {
          console.log(`[dry-run] would create: ${candidate.name} (${candidate.lat}, ${candidate.lng}) ${candidate.category}`);
        }
        continue;
      }

      const createdPlace = await prisma.place.create({
        data: {
          name: candidate.name,
          type: "SEHENSWUERDIGKEIT",
          lat: candidate.lat,
          lng: candidate.lng,
        },
        select: { id: true },
      });

      existingRows.push({
        id: createdPlace.id,
        name: candidate.name,
        type: "SEHENSWUERDIGKEIT",
        lat: candidate.lat,
        lng: candidate.lng,
      });

      created += 1;
      if (verbose) {
        console.log(`created #${createdPlace.id}: ${candidate.name} (${candidate.category}) [${candidate.sourceId}]`);
      }
    } catch (error: any) {
      skippedError += 1;
      console.error(`failed candidate ${candidate.sourceId} (${candidate.name}): ${String(error?.message ?? error)}`);
    }
  }

  return {
    region,
    fetched: elements.length,
    normalized: normalized.length,
    afterDedupe: accepted.length,
    processed: effectiveList.length,
    created,
    skippedDuplicate,
    skippedError,
  };
}

async function run() {
  const options = parseCliArgs(process.argv.slice(2));

  const selectedRegions: TargetRegion[] =
    options.region === "all" ? ["normandie", "bretagne"] : [options.region];

  const summaries: RegionSummary[] = [];

  console.log("sightseeing-seed-import: start", {
    region: options.region,
    dryRun: options.dryRun,
    limit: options.limit,
    force: options.force,
    verbose: options.verbose,
  });

  try {
    for (const region of selectedRegions) {
      try {
        console.log(`\n--- region ${region} ---`);
        const summary = await runRegionImport({
          prisma,
          region,
          globalLimit: options.limit,
          dryRun: options.dryRun,
          force: options.force,
          verbose: options.verbose,
        });
        summaries.push(summary);
      } catch (error: any) {
        console.error(`region ${region} failed: ${String(error?.message ?? error)}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  if (summaries.length === 0) {
    console.error("No region completed successfully.");
    process.exitCode = 1;
    return;
  }

  const total = summaries.reduce(
    (acc, item) => ({
      fetched: acc.fetched + item.fetched,
      normalized: acc.normalized + item.normalized,
      afterDedupe: acc.afterDedupe + item.afterDedupe,
      processed: acc.processed + item.processed,
      created: acc.created + item.created,
      skippedDuplicate: acc.skippedDuplicate + item.skippedDuplicate,
      skippedError: acc.skippedError + item.skippedError,
    }),
    {
      fetched: 0,
      normalized: 0,
      afterDedupe: 0,
      processed: 0,
      created: 0,
      skippedDuplicate: 0,
      skippedError: 0,
    }
  );

  console.log("\n=== sightseeing-seed-import summary ===");
  for (const item of summaries) {
    console.log(
      `${item.region}: fetched=${item.fetched} normalized=${item.normalized} afterDedupe=${item.afterDedupe} processed=${item.processed} created=${item.created} duplicates=${item.skippedDuplicate} errors=${item.skippedError}`
    );
  }
  console.log(
    `TOTAL: fetched=${total.fetched} normalized=${total.normalized} afterDedupe=${total.afterDedupe} processed=${total.processed} created=${total.created} duplicates=${total.skippedDuplicate} errors=${total.skippedError}`
  );

  if (!options.dryRun) {
    console.log("Hint: Run /api/admin/sightseeing-autofill after seed import to enrich TS sightseeing scoring fields.");
  }
}

run().catch((error: any) => {
  console.error(`fatal: ${String(error?.message ?? error)}`);
  process.exitCode = 1;
});
