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

const REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const FALLBACK_OVERPASS_URLS = ["https://lz4.overpass-api.de/api/interpreter"];
const MAX_RETRIES_PER_ENDPOINT = 2;

type CliOptions = {
  region: TargetRegion | "all";
  limit: number | null;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
  overpassUrl: string;
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

  const overpassUrlRaw = readValue("--overpass-url") ?? process.env.OVERPASS_URL ?? DEFAULT_OVERPASS_URL;
  const overpassUrl = overpassUrlRaw.trim();
  if (!overpassUrl) {
    throw new Error("Invalid Overpass URL. Provide --overpass-url=<url> or OVERPASS_URL=<url>.");
  }

  try {
    new URL(overpassUrl);
  } catch {
    throw new Error(`Invalid Overpass URL: ${overpassUrl}`);
  }

  return {
    region: regionRaw as CliOptions["region"],
    limit: limit ? Math.floor(limit) : null,
    dryRun: args.has("--dry-run"),
    force: args.has("--force"),
    verbose: args.has("--verbose"),
    overpassUrl,
  };
}

function getOverpassEndpoints(primaryUrl: string): string[] {
  const urls = [primaryUrl, ...FALLBACK_OVERPASS_URLS].map((url) => url.trim()).filter(Boolean);
  return Array.from(new Set(urls));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number): boolean {
  return [429, 502, 503, 504].includes(status);
}

class OverpassRequestError extends Error {
  endpoint: string;
  status: number | null;
  retryable: boolean;

  constructor(input: { endpoint: string; status: number | null; retryable: boolean; message: string }) {
    super(input.message);
    this.endpoint = input.endpoint;
    this.status = input.status;
    this.retryable = input.retryable;
  }
}

async function fetchOverpass(region: TargetRegion, overpassUrl: string): Promise<unknown> {
  const query = buildOverpassQuery(REGION_CONFIGS[region]);
  const endpoints = getOverpassEndpoints(overpassUrl);
  const failures: string[] = [];

  for (const [endpointIndex, endpoint] of endpoints.entries()) {
    for (let attempt = 1; attempt <= MAX_RETRIES_PER_ENDPOINT; attempt += 1) {
      const attemptPrefix = `[overpass] region=${region} endpoint=${endpoint} attempt=${attempt}/${MAX_RETRIES_PER_ENDPOINT}`;
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

      try {
        if (attempt === 1) {
          console.log(`${attemptPrefix} start`);
        }

        const response = await fetch(endpoint, {
          method: "POST",
          body: query,
          signal: abortController.signal,
          headers: {
            "content-type": "text/plain;charset=UTF-8",
          },
        });

        if (!response.ok) {
          const payload = await response.text().catch(() => "");
          const retryable = isRetryableStatus(response.status);
          const detail = payload.slice(0, 300);

          if (response.status === 429) {
            console.warn(`${attemptPrefix} received 429 Too Many Requests`);
          } else {
            console.warn(`${attemptPrefix} failed with status=${response.status}`);
          }

          throw new OverpassRequestError({
            endpoint,
            status: response.status,
            retryable,
            message: `Overpass request failed (${response.status}) at ${endpoint}: ${detail}`,
          });
        }

        const json = await response.json();
        console.log(`${attemptPrefix} success`);
        return json;
      } catch (error: any) {
        const isAbort = error?.name === "AbortError";
        const normalizedError =
          error instanceof OverpassRequestError
            ? error
            : new OverpassRequestError({
                endpoint,
                status: null,
                retryable: true,
                message: isAbort
                  ? `Overpass request timed out after ${REQUEST_TIMEOUT_MS}ms at ${endpoint}`
                  : `Overpass request error at ${endpoint}: ${String(error?.message ?? error)}`,
              });

        failures.push(
          `region=${region} endpoint=${normalizedError.endpoint} status=${normalizedError.status ?? "n/a"} message=${normalizedError.message}`
        );

        const isLastAttemptForEndpoint = attempt >= MAX_RETRIES_PER_ENDPOINT;
        if (normalizedError.retryable && !isLastAttemptForEndpoint) {
          const backoffMs = 1_000 * attempt;
          console.warn(
            `${attemptPrefix} temporary error. Retrying in ${backoffMs}ms (${normalizedError.message})`
          );
          await sleep(backoffMs);
          continue;
        }

        console.warn(`${attemptPrefix} giving up on endpoint (${normalizedError.message})`);
        break;
      } finally {
        clearTimeout(timeout);
      }
    }

    if (endpointIndex < endpoints.length - 1) {
      const nextEndpoint = endpoints[endpointIndex + 1];
      console.warn(`[overpass] region=${region} falling back to next endpoint: ${nextEndpoint}`);
    }
  }

  throw new Error(
    `Overpass failed for region=${region}. Tried endpoints: ${endpoints.join(", ")}. Last errors: ${failures.slice(-4).join(" | ")}`
  );
}

async function runRegionImport(options: {
  prisma: any;
  region: TargetRegion;
  globalLimit: number | null;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
  overpassUrl: string;
}): Promise<RegionSummary> {
  const { prisma, region, dryRun, force, verbose, globalLimit, overpassUrl } = options;

  const payload = await fetchOverpass(region, overpassUrl);
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
  const failedRegions: string[] = [];
  const overpassEndpoints = getOverpassEndpoints(options.overpassUrl);

  console.log("sightseeing-seed-import: start", {
    region: options.region,
    dryRun: options.dryRun,
    limit: options.limit,
    force: options.force,
    verbose: options.verbose,
    overpassUrl: options.overpassUrl,
    overpassFallbacks: overpassEndpoints.slice(1),
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
          overpassUrl: options.overpassUrl,
        });
        summaries.push(summary);
      } catch (error: any) {
        failedRegions.push(region);
        console.error(`region ${region} failed: ${String(error?.message ?? error)}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  if (summaries.length === 0) {
    console.error(
      `No region completed successfully. Failed regions: ${failedRegions.join(", ") || "unknown"}. Check Overpass endpoint or try --overpass-url=<url>.`
    );
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
  if (failedRegions.length > 0) {
    console.warn(`FAILED REGIONS: ${failedRegions.join(", ")}`);
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
