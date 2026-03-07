import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import {
  areLikelySamePlace,
  buildOverpassQuery,
  buildOverpassQueryFromClauses,
  getNearbyQueryParts,
  normalizeCandidate,
  parseOverpassElements,
  REGION_CONFIGS,
  scoreHighlightCandidate,
  type BoundingBox,
  type ImportMode,
  type OverpassElement,
  type RegionConfig,
  type SightseeingCandidate,
  type TargetRegion,
} from "../src/lib/sightseeing-seed-import.ts";
import { getCuratedPresetCandidates, listCuratedPresetKeys } from "../src/lib/curated-sightseeing-presets.ts";

const REQUEST_TIMEOUT_MS = 45_000;
const DEFAULT_OVERPASS_URL = "https://overpass-api.de/api/interpreter";
const FALLBACK_OVERPASS_URLS = ["https://lz4.overpass-api.de/api/interpreter"];
const MAX_RETRIES_PER_ENDPOINT = 2;

const NEAR_PRESETS = {
  nievern: {
    label: "Nievern (DE)",
    center: { lat: 50.316, lng: 7.617 },
    radiusKm: 35,
  },
} as const;

type CliOptions = {
  region: TargetRegion | "all";
  curatedSet: string | null;
  limit: number | null;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
  overpassUrl: string;
  bbox: BoundingBox | null;
  maxElements: number | null;
  testMode: boolean;
  center: { lat: number; lng: number } | null;
  radiusKm: number | null;
  nearPreset: keyof typeof NEAR_PRESETS | null;
  subqueries: string[] | null;
  importMode: ImportMode;
};

type ExistingPlace = {
  id: number;
  name: string;
  type: "SEHENSWUERDIGKEIT";
  lat: number;
  lng: number;
  sightExternalId: string | null;
};

const TEST_MODE_BBOXES: Record<TargetRegion, BoundingBox> = {
  normandie: { minLon: -1.585, minLat: 49.63, maxLon: -1.42, maxLat: 49.705 },
  bretagne: { minLon: -4.495, minLat: 48.36, maxLon: -4.405, maxLat: 48.41 },
};

type RankedCandidate = {
  candidate: SightseeingCandidate;
  highlightScore: number | null;
};

type RegionSummary = {
  region: string;
  sourceMode: "overpass" | "curated";
  fetched: number;
  normalized: number;
  afterDedupe: number;
  processed: number;
  created: number;
  updated: number;
  skippedDuplicate: number;
  skippedError: number;
  successfulSubqueries: number;
  failedSubqueries: number;
};

type NearbySubqueryStatus = {
  key: string;
  label: string;
  success: boolean;
  fetched: number;
  error?: string;
};

type FetchScopeResult = {
  elements: OverpassElement[];
  successfulSubqueries: number;
  failedSubqueries: number;
};

type QueryScope = {
  regionConfig: RegionConfig;
  bbox: BoundingBox | null;
  around: { lat: number; lng: number; radiusKm: number } | null;
  label: string;
};

function parseCliArgs(argv: string[]): CliOptions {
  const args = new Set(argv);
  const readValue = (prefix: string): string | null => {
    const hit = argv.find((x) => x.startsWith(`${prefix}=`));
    if (!hit) return null;
    return hit.slice(prefix.length + 1).trim() || null;
  };

  const nearRaw = readValue("--near")?.toLowerCase() ?? null;
  if (nearRaw && !(nearRaw in NEAR_PRESETS)) {
    throw new Error(`Invalid --near value. Allowed: ${Object.keys(NEAR_PRESETS).join(" | ")}`);
  }

  const centerRaw = readValue("--center");
  let center: { lat: number; lng: number } | null = null;
  if (centerRaw) {
    const parts = centerRaw.split(",").map((part) => Number(part.trim()));
    if (parts.length !== 2 || parts.some((part) => !Number.isFinite(part))) {
      throw new Error("Invalid --center value. Expected format: lat,lng");
    }
    const [lat, lng] = parts;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error("Invalid --center value. Coordinates outside valid lat/lng range.");
    }
    center = { lat, lng };
  }

  const radiusRaw = readValue("--radius-km");
  const radiusKm = radiusRaw ? Number(radiusRaw) : null;
  if (radiusRaw && (!Number.isFinite(radiusKm) || Number(radiusKm) <= 0)) {
    throw new Error("Invalid --radius-km value. Must be a positive number.");
  }

  const curatedSetRaw = (readValue("--curated-set") ?? readValue("--preset"))?.toLowerCase() ?? null;
  if (curatedSetRaw) {
    const allowedCuratedSets = new Set(listCuratedPresetKeys());
    if (!allowedCuratedSets.has(curatedSetRaw)) {
      throw new Error(`Invalid curated preset. Allowed: ${Array.from(allowedCuratedSets).join(" | ")}`);
    }
  }

  const regionRaw = (readValue("--region") ?? "all").toLowerCase();
  if (!["all", "normandie", "bretagne"].includes(regionRaw)) {
    throw new Error("Invalid --region value. Allowed: all | normandie | bretagne");
  }

  const limitRaw = readValue("--limit");
  const limit = limitRaw ? Number(limitRaw) : null;
  if (limitRaw && (!Number.isFinite(limit) || Number(limit) <= 0)) {
    throw new Error("Invalid --limit value. Must be a positive number.");
  }

  const bboxRaw = readValue("--bbox");
  let bbox: BoundingBox | null = null;
  if (bboxRaw) {
    const parts = bboxRaw.split(",").map((part) => Number(part.trim()));
    if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
      throw new Error("Invalid --bbox value. Expected format: minLon,minLat,maxLon,maxLat");
    }
    const [minLon, minLat, maxLon, maxLat] = parts;
    if (minLon >= maxLon || minLat >= maxLat) {
      throw new Error("Invalid --bbox value. Must satisfy minLon < maxLon and minLat < maxLat.");
    }
    if (minLon < -180 || maxLon > 180 || minLat < -90 || maxLat > 90) {
      throw new Error("Invalid --bbox value. Coordinates outside valid lon/lat range.");
    }
    bbox = { minLon, minLat, maxLon, maxLat };
  }

  const maxElementsRaw = readValue("--max-elements");
  const maxElements = maxElementsRaw ? Number(maxElementsRaw) : null;
  if (maxElementsRaw && (!Number.isFinite(maxElements) || Number(maxElements) <= 0)) {
    throw new Error("Invalid --max-elements value. Must be a positive number.");
  }

  const testMode = args.has("--test-mode");
  const subqueriesRaw = readValue("--subqueries") ?? readValue("--include-subqueries");

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

  const nearPreset = nearRaw ? (nearRaw as keyof typeof NEAR_PRESETS) : null;
  if (nearPreset && !center) {
    center = { ...NEAR_PRESETS[nearPreset].center };
  }

  const effectiveRadius = radiusKm ?? (nearPreset ? NEAR_PRESETS[nearPreset].radiusKm : null);
  const hasNearby = Boolean(center || effectiveRadius);
  if (hasNearby && (!center || !effectiveRadius)) {
    throw new Error("Nearby mode requires both --center=<lat,lng> and --radius-km=<number> (or --near=<preset>). ");
  }

  if (hasNearby && bbox) {
    throw new Error("Cannot combine nearby mode (--center/--radius-km) with --bbox.");
  }
  if (hasNearby && testMode) {
    throw new Error("Cannot combine nearby mode (--center/--radius-km) with --test-mode.");
  }

  const hasCuratedSet = Boolean(curatedSetRaw);
  if (hasCuratedSet) {
    if (hasNearby || bbox || testMode || subqueriesRaw || maxElementsRaw) {
      throw new Error(
        "Curated preset mode (--curated-set / --preset) cannot be combined with --center/--radius-km/--near, --bbox, --test-mode, --subqueries, or --max-elements."
      );
    }
  }

  const highlightMode = args.has("--highlight-mode") || args.has("--top-sights");

  const availableNearbySubqueryKeys = new Set(getNearbyQueryParts(highlightMode ? "highlight" : "default").map((part) => part.key));
  const subqueries = subqueriesRaw
    ? Array.from(new Set(subqueriesRaw.split(",").map((item) => item.trim()).filter(Boolean)))
    : null;
  if (subqueries && subqueries.length === 0) {
    throw new Error("Invalid --subqueries value. Provide a comma-separated list of nearby subquery keys.");
  }
  if (subqueries) {
    const invalidSubqueries = subqueries.filter((key) => !availableNearbySubqueryKeys.has(key));
    if (invalidSubqueries.length > 0) {
      throw new Error(
        `Invalid nearby subquery keys: ${invalidSubqueries.join(", ")}. Allowed: ${Array.from(availableNearbySubqueryKeys).join(", ")}`
      );
    }
    if (!hasNearby) {
      throw new Error("--subqueries / --include-subqueries can only be used in nearby mode (--center/--radius-km or --near). ");
    }
  }

  return {
    region: regionRaw as CliOptions["region"],
    curatedSet: curatedSetRaw,
    limit: limit ? Math.floor(limit) : null,
    dryRun: args.has("--dry-run"),
    force: args.has("--force"),
    verbose: args.has("--verbose"),
    overpassUrl,
    bbox,
    maxElements: maxElements ? Math.floor(maxElements) : null,
    testMode,
    center,
    radiusKm: effectiveRadius,
    nearPreset,
    subqueries,
    importMode: highlightMode ? "highlight" : "default",
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

async function fetchOverpass(input: {
  scope: QueryScope;
  overpassUrl: string;
  query: string;
  queryLabel?: string;
}): Promise<unknown> {
  const { scope, overpassUrl, query, queryLabel } = input;
  const endpoints = getOverpassEndpoints(overpassUrl);
  const failures: string[] = [];
  const queryLabelSuffix = queryLabel ? ` query=${queryLabel}` : "";

  for (const [endpointIndex, endpoint] of endpoints.entries()) {
    for (let attempt = 1; attempt <= MAX_RETRIES_PER_ENDPOINT; attempt += 1) {
      const attemptPrefix = `[overpass] scope=${scope.label}${queryLabelSuffix} endpoint=${endpoint} attempt=${attempt}/${MAX_RETRIES_PER_ENDPOINT}`;
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

      try {
        if (attempt === 1) console.log(`${attemptPrefix} start`);
        const response = await fetch(endpoint, {
          method: "POST",
          body: query,
          signal: abortController.signal,
          headers: { "content-type": "text/plain;charset=UTF-8" },
        });

        if (!response.ok) {
          const payload = await response.text().catch(() => "");
          const retryable = isRetryableStatus(response.status);
          const detail = payload.slice(0, 300);
          if (response.status === 429) console.warn(`${attemptPrefix} received 429 Too Many Requests`);
          else console.warn(`${attemptPrefix} failed with status=${response.status}`);

          throw new OverpassRequestError({
            endpoint,
            status: response.status,
            retryable,
            message: `Overpass request failed (${response.status}) at ${endpoint}: ${detail}`,
          });
        }

        const json = await response.json();
        const fetchedElements = Array.isArray((json as { elements?: unknown }).elements)
          ? (json as { elements: unknown[] }).elements.length
          : 0;

        console.log(`${attemptPrefix} success elements=${fetchedElements}`);
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
          `scope=${scope.label}${queryLabelSuffix} endpoint=${normalizedError.endpoint} status=${normalizedError.status ?? "n/a"} message=${normalizedError.message}`
        );

        const isLastAttemptForEndpoint = attempt >= MAX_RETRIES_PER_ENDPOINT;
        if (normalizedError.retryable && !isLastAttemptForEndpoint) {
          const backoffMs = 1_000 * attempt;
          console.warn(`${attemptPrefix} temporary error. Retrying in ${backoffMs}ms (${normalizedError.message})`);
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
      console.warn(`[overpass] scope=${scope.label}${queryLabelSuffix} falling back to next endpoint: ${nextEndpoint}`);
    }
  }

  throw new Error(
    `Overpass failed for scope=${scope.label}${queryLabelSuffix}. Tried endpoints: ${endpoints.join(", ")}. Last errors: ${failures
      .slice(-4)
      .join(" | ")}`
  );
}

function dedupeElementsByOverpassIdentity(elements: OverpassElement[]): OverpassElement[] {
  const byId = new Map<string, OverpassElement>();
  for (const element of elements) {
    const key = `${element.type}/${element.id}`;
    if (!byId.has(key)) byId.set(key, element);
  }
  return Array.from(byId.values());
}

async function fetchScopeElements(input: {
  scope: QueryScope;
  overpassUrl: string;
  maxElements: number | null;
  verbose: boolean;
  selectedSubqueries: string[] | null;
  importMode: ImportMode;
}): Promise<FetchScopeResult> {
  const { scope, overpassUrl, maxElements, verbose, selectedSubqueries, importMode } = input;

  if (!scope.around) {
    const query = buildOverpassQuery(scope.regionConfig, { bbox: scope.bbox, around: scope.around, mode: importMode });
    const payload = await fetchOverpass({ scope, overpassUrl, query });
    const elements = parseOverpassElements(payload);
    if (maxElements && elements.length > maxElements) {
      console.log(`[overpass] scope=${scope.label} applying --max-elements=${maxElements} to fetched=${elements.length}`);
      return { elements: elements.slice(0, maxElements), successfulSubqueries: 0, failedSubqueries: 0 };
    }
    return { elements, successfulSubqueries: 0, failedSubqueries: 0 };
  }

  const mergedElements: OverpassElement[] = [];
  const allParts = getNearbyQueryParts(importMode);
  const parts = selectedSubqueries ? allParts.filter((part) => selectedSubqueries.includes(part.key)) : allParts;
  const statusRows: NearbySubqueryStatus[] = [];

  if (parts.length === 0) {
    throw new Error("No nearby subqueries selected. Provide at least one key via --subqueries/--include-subqueries.");
  }

  if (selectedSubqueries) {
    console.log(`[overpass] scope=${scope.label} nearby subquery filter active: ${selectedSubqueries.join(", ")}`);
  }

  for (const [index, part] of parts.entries()) {
    const query = buildOverpassQueryFromClauses({
      region: scope.regionConfig,
      clauses: part.clauses,
      options: { around: scope.around, bbox: null },
    });
    const queryLabel = `part=${index + 1}/${parts.length}:${part.key}`;
    if (verbose) {
      console.log(`[overpass] scope=${scope.label} running nearby subquery ${index + 1}/${parts.length} (${part.label})`);
    }
    try {
      const payload = await fetchOverpass({ scope, overpassUrl, query, queryLabel });
      const partElements = parseOverpassElements(payload);
      console.log(`[overpass] scope=${scope.label} subquery=${part.key} status=success fetched=${partElements.length}`);
      statusRows.push({ key: part.key, label: part.label, success: true, fetched: partElements.length });
      mergedElements.push(...partElements);
    } catch (error: any) {
      const reason = String(error?.message ?? error).replace(/\s+/g, " ").trim().slice(0, 220);
      console.warn(`[overpass] scope=${scope.label} subquery=${part.key} status=failed reason=${reason}`);
      statusRows.push({ key: part.key, label: part.label, success: false, fetched: 0, error: reason });
    }
  }

  const successfulSubqueries = statusRows.filter((row) => row.success).length;
  const failedSubqueries = statusRows.length - successfulSubqueries;

  console.log(
    `[overpass] scope=${scope.label} nearby subquery summary success=${successfulSubqueries} failed=${failedSubqueries}`
  );
  if (failedSubqueries > 0) {
    const failedDetails = statusRows
      .filter((row) => !row.success)
      .map((row) => `${row.key}: ${row.error ?? "unknown error"}`)
      .join(" | ");
    console.warn(`[overpass] scope=${scope.label} nearby failed subqueries -> ${failedDetails}`);
  }

  if (successfulSubqueries === 0) {
    throw new Error(`All nearby subqueries failed (${failedSubqueries}/${statusRows.length}).`);
  }

  const deduped = dedupeElementsByOverpassIdentity(mergedElements);
  console.log(
    `[overpass] scope=${scope.label} nearby merged elementsFromSuccessfulSubqueries=${mergedElements.length} dedupedByOverpassId=${deduped.length}`
  );

  if (maxElements && deduped.length > maxElements) {
    console.log(`[overpass] scope=${scope.label} applying --max-elements=${maxElements} to merged=${deduped.length}`);
    return {
      elements: deduped.slice(0, maxElements),
      successfulSubqueries,
      failedSubqueries,
    };
  }

  return {
    elements: deduped,
    successfulSubqueries,
    failedSubqueries,
  };
}

async function runRegionImport(options: {
  prisma: any;
  scope: QueryScope;
  globalLimit: number | null;
  dryRun: boolean;
  force: boolean;
  verbose: boolean;
  overpassUrl: string;
  maxElements: number | null;
  selectedSubqueries: string[] | null;
  importMode: ImportMode;
  curatedSet: string | null;
}): Promise<RegionSummary> {
  const { prisma, scope, dryRun, force, verbose, globalLimit, overpassUrl, maxElements, selectedSubqueries, importMode, curatedSet } = options;

  const sourceMode: RegionSummary["sourceMode"] = curatedSet ? "curated" : "overpass";

  const fetchedResult = curatedSet
    ? { elements: [] as OverpassElement[], successfulSubqueries: 0, failedSubqueries: 0 }
    : await fetchScopeElements({ scope, overpassUrl, maxElements, verbose, selectedSubqueries, importMode });
  const { elements, successfulSubqueries, failedSubqueries } = fetchedResult;

  const normalized = curatedSet
    ? getCuratedPresetCandidates(curatedSet)
    : elements
        .map((el) => {
          if (!verbose) {
            return normalizeCandidate(el, scope.regionConfig);
          }
          const rawName = String(el.tags?.name ?? "").trim() || `${el.type}/${el.id}`;
          return normalizeCandidate(el, scope.regionConfig, {
            onReject: (reason) => {
              console.log(`skip candidate: ${rawName} [${el.type}/${el.id}] -> ${reason}`);
            },
          });
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

  if (curatedSet) {
    console.log(`[pipeline:${scope.label}] curated preset=${curatedSet} candidates=${normalized.length}`);
  } else {
    console.log(`[pipeline:${scope.label}] overpass elements fetched=${elements.length}`);
  }

  const uniqueBySource = new Map<string, (typeof normalized)[number]>();
  for (const candidate of normalized) {
    if (!uniqueBySource.has(candidate.sourceId)) uniqueBySource.set(candidate.sourceId, candidate);
  }

  const distinctCandidates = Array.from(uniqueBySource.values());
  console.log(`[pipeline:${scope.label}] normalized candidates=${normalized.length} distinctBySource=${distinctCandidates.length}`);

  const existingRows = (await prisma.place.findMany({
    where: { type: "SEHENSWUERDIGKEIT" },
    select: { id: true, name: true, lat: true, lng: true, type: true, sightExternalId: true },
  })) as ExistingPlace[];

  const accepted: RankedCandidate[] = [];
  const seenInBatch: SightseeingCandidate[] = [];

  for (const candidate of distinctCandidates) {
    const isCuratedCandidate = candidate.source === "curated-preset";
    const duplicateInBatch = seenInBatch.find((x) => {
      const bothCurated = isCuratedCandidate && x.source === "curated-preset";
      if (bothCurated) {
        if (x.sourceId !== candidate.sourceId) return false;
        return true;
      }

      return areLikelySamePlace({
        nameA: x.name,
        latA: x.lat,
        lngA: x.lng,
        nameB: candidate.name,
        latB: candidate.lat,
        lngB: candidate.lng,
      });
    });

    if (duplicateInBatch) {
      if (verbose) console.log(`skip batch-duplicate: ${candidate.name} ~ ${duplicateInBatch.name}`);
      continue;
    }

    seenInBatch.push(candidate);
    const highlightScore = importMode === "highlight" ? scoreHighlightCandidate(candidate) : null;
    if (importMode === "highlight" && (highlightScore ?? 0) < 0) {
      if (verbose) console.log(`skip highlight-negative: ${candidate.name} score=${highlightScore}`);
      continue;
    }
    accepted.push({ candidate, highlightScore });
  }

  const rankedAccepted =
    importMode === "highlight"
      ? [...accepted].sort((a, b) => (b.highlightScore ?? 0) - (a.highlightScore ?? 0))
      : accepted;

  const effectiveList = globalLimit ? rankedAccepted.slice(0, globalLimit) : rankedAccepted;
  if (globalLimit) {
    console.log(
      `[pipeline:${scope.label}] local processing limit active --limit=${globalLimit}: accepted=${rankedAccepted.length} -> processed=${effectiveList.length}`
    );
  } else {
    console.log(`[pipeline:${scope.label}] local processing without --limit: processed=${effectiveList.length}`);
  }

  if (importMode === "highlight") {
    const topLog = effectiveList
      .slice(0, Math.min(10, effectiveList.length))
      .map((entry, idx) => `#${idx + 1} ${entry.candidate.name} (score=${entry.highlightScore ?? 0}, category=${entry.candidate.category})`)
      .join(" | ");
    if (topLog) console.log(`[highlight] scope=${scope.label} top=${topLog}`);
  }

  let created = 0;
  let updated = 0;
  let skippedDuplicate = 0;
  let skippedError = 0;

  for (const ranked of effectiveList) {
    const candidate = ranked.candidate;
    try {
      const matchByExternalId = existingRows.find(
        (existing) => existing.sightExternalId && existing.sightExternalId === candidate.sourceId
      );

      if (matchByExternalId) {
        if (dryRun) {
          updated += 1;
          if (verbose) {
            console.log(
              `[dry-run] would upsert by sightExternalId #${matchByExternalId.id}: ${matchByExternalId.name} <- ${candidate.name} (${candidate.category}) [${candidate.sourceId}]`
            );
          }
          continue;
        }

        await prisma.place.update({
          where: { id: matchByExternalId.id },
          data: {
            name: candidate.name,
            lat: candidate.lat,
            lng: candidate.lng,
            sightSource: candidate.source,
            sightExternalId: candidate.sourceId,
            sightCategory: candidate.category,
            sightDescription: candidate.reason,
            sightTags: candidate.tags,
            sightRegion: candidate.sourceRegion,
            sightCountry: candidate.country,
            ...(candidate.heroImageUrl ? { heroImageUrl: candidate.heroImageUrl } : {}),
          },
          select: { id: true },
        });

        matchByExternalId.name = candidate.name;
        matchByExternalId.lat = candidate.lat;
        matchByExternalId.lng = candidate.lng;

        updated += 1;
        if (verbose) {
          console.log(
            `updated by sightExternalId #${matchByExternalId.id}: ${candidate.name} (${candidate.category}) [${candidate.sourceId}]`
          );
        }
        continue;
      }

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
        if (verbose) console.log(`skip db-duplicate: ${candidate.name} -> #${duplicateInDb.id} ${duplicateInDb.name}`);
        continue;
      }

      if (duplicateInDb && force) {
        if (dryRun) {
          updated += 1;
          if (verbose) {
            console.log(
              `[dry-run] would update existing place #${duplicateInDb.id}: ${duplicateInDb.name} <- ${candidate.name} (${candidate.category})`
            );
          }
          continue;
        }

        await prisma.place.update({
          where: { id: duplicateInDb.id },
          data: {
            sightSource: candidate.source,
            sightExternalId: candidate.sourceId,
            sightCategory: candidate.category,
            sightDescription: candidate.reason,
            sightTags: candidate.tags,
            sightRegion: candidate.sourceRegion,
            sightCountry: candidate.country,
            ...(candidate.heroImageUrl ? { heroImageUrl: candidate.heroImageUrl } : {}),
          },
          select: { id: true },
        });

        updated += 1;
        if (verbose) console.log(`updated #${duplicateInDb.id}: ${duplicateInDb.name} (${candidate.category}) [${candidate.sourceId}]`);
        continue;
      }

      if (dryRun) {
        created += 1;
        if (verbose) console.log(`[dry-run] would create: ${candidate.name} (${candidate.lat}, ${candidate.lng}) ${candidate.category}`);
        continue;
      }

      const createdPlace = await prisma.place.create({
        data: {
          name: candidate.name,
          type: "SEHENSWUERDIGKEIT",
          lat: candidate.lat,
          lng: candidate.lng,
          sightSource: candidate.source,
          sightExternalId: candidate.sourceId,
          sightCategory: candidate.category,
          sightDescription: candidate.reason,
          sightTags: candidate.tags,
          sightRegion: candidate.sourceRegion,
          sightCountry: candidate.country,
          heroImageUrl: candidate.heroImageUrl ?? null,
        },
        select: { id: true },
      });

      existingRows.push({
        id: createdPlace.id,
        name: candidate.name,
        type: "SEHENSWUERDIGKEIT",
        lat: candidate.lat,
        lng: candidate.lng,
        sightExternalId: candidate.sourceId,
      });

      created += 1;
      if (verbose) console.log(`created #${createdPlace.id}: ${candidate.name} (${candidate.category}) [${candidate.sourceId}]`);
    } catch (error: any) {
      skippedError += 1;
      console.error(`failed candidate ${candidate.sourceId} (${candidate.name}): ${String(error?.message ?? error)}`);
    }
  }

  return {
    region: scope.label,
    sourceMode,
    fetched: curatedSet ? normalized.length : elements.length,
    normalized: normalized.length,
    afterDedupe: rankedAccepted.length,
    processed: effectiveList.length,
    created,
    updated,
    skippedDuplicate,
    skippedError,
    successfulSubqueries,
    failedSubqueries,
  };
}

function getScopes(options: CliOptions): QueryScope[] {
  if (options.curatedSet) {
    return [
      {
        regionConfig: {
          key: options.curatedSet,
          label: options.curatedSet,
          country: "Germany",
        },
        bbox: null,
        around: null,
        label: `curated:${options.curatedSet}`,
      },
    ];
  }

  if (options.center && options.radiusKm) {
    const nearLabel = options.nearPreset ? `near:${options.nearPreset}` : "nearby";
    return [
      {
        regionConfig: {
          key: nearLabel,
          label: nearLabel,
          country: "Germany",
        },
        bbox: null,
        around: { lat: options.center.lat, lng: options.center.lng, radiusKm: options.radiusKm },
        label: `${nearLabel}(${options.center.lat},${options.center.lng},${options.radiusKm}km)`,
      },
    ];
  }

  const selectedRegions: TargetRegion[] = options.region === "all" ? ["normandie", "bretagne"] : [options.region];
  return selectedRegions.map((region) => ({
    regionConfig: REGION_CONFIGS[region],
    bbox: options.bbox ?? (options.testMode ? TEST_MODE_BBOXES[region] : null),
    around: null,
    label: region,
  }));
}

async function run() {
  const options = parseCliArgs(process.argv.slice(2));

  const summaries: RegionSummary[] = [];
  const failedScopes: string[] = [];
  const overpassEndpoints = getOverpassEndpoints(options.overpassUrl);
  const scopes = getScopes(options);

  console.log("sightseeing-seed-import: start", {
    region: options.region,
    dryRun: options.dryRun,
    limit: options.limit,
    force: options.force,
    verbose: options.verbose,
    overpassUrl: options.overpassUrl,
    overpassFallbacks: overpassEndpoints.slice(1),
    bbox: options.bbox,
    center: options.center,
    radiusKm: options.radiusKm,
    near: options.nearPreset,
    maxElements: options.maxElements,
    testMode: options.testMode,
    subqueries: options.subqueries,
    importMode: options.importMode,
    curatedSet: options.curatedSet,
  });

  try {
    for (const scope of scopes) {
      try {
        console.log(`\n--- scope ${scope.label} ---`);
        if (!options.curatedSet && scope.bbox) {
          console.log(
            `[overpass] scope=${scope.label} query scope reduced via bbox=${scope.bbox.minLon},${scope.bbox.minLat},${scope.bbox.maxLon},${scope.bbox.maxLat}`
          );
        }
        if (!options.curatedSet && scope.around) {
          console.log(
            `[overpass] scope=${scope.label} query scope reduced via around=${scope.around.lat},${scope.around.lng} radiusKm=${scope.around.radiusKm}`
          );
          console.log(`[overpass] scope=${scope.label} using split nearby query strategy (multiple smaller Overpass requests)`);
        }
        if (!options.curatedSet && options.maxElements) {
          console.log(`[overpass] scope=${scope.label} response capped by --max-elements=${options.maxElements}`);
        }
        if (options.curatedSet) {
          console.log(`[curated] scope=${scope.label} preset=${options.curatedSet} (without Overpass)`);
        }

        const summary = await runRegionImport({
          prisma,
          scope,
          globalLimit: options.limit,
          dryRun: options.dryRun,
          force: options.force,
          verbose: options.verbose,
          overpassUrl: options.overpassUrl,
          maxElements: options.maxElements,
          selectedSubqueries: options.subqueries,
          importMode: options.importMode,
          curatedSet: options.curatedSet,
        });
        summaries.push(summary);
      } catch (error: any) {
        failedScopes.push(scope.label);
        console.error(`scope ${scope.label} failed: ${String(error?.message ?? error)}`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  if (summaries.length === 0) {
    console.error(`No scope completed successfully. Failed scopes: ${failedScopes.join(", ") || "unknown"}.`);
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
      updated: acc.updated + item.updated,
      skippedDuplicate: acc.skippedDuplicate + item.skippedDuplicate,
      skippedError: acc.skippedError + item.skippedError,
    }),
    { fetched: 0, normalized: 0, afterDedupe: 0, processed: 0, created: 0, updated: 0, skippedDuplicate: 0, skippedError: 0 }
  );

  console.log("\n=== sightseeing-seed-import summary ===");
  for (const item of summaries) {
    console.log(
      `${item.region} [${item.sourceMode}]: fetched=${item.fetched} normalized=${item.normalized} afterDedupe=${item.afterDedupe} processed=${item.processed} created=${item.created} updated=${item.updated} duplicates=${item.skippedDuplicate} errors=${item.skippedError} successfulSubqueries=${item.successfulSubqueries} failedSubqueries=${item.failedSubqueries}`
    );
  }
  if (failedScopes.length > 0) {
    console.warn(`FAILED SCOPES: ${failedScopes.join(", ")}`);
  }
  console.log(
    `TOTAL: fetched=${total.fetched} normalized=${total.normalized} afterDedupe=${total.afterDedupe} processed=${total.processed} created=${total.created} updated=${total.updated} duplicates=${total.skippedDuplicate} errors=${total.skippedError}`
  );

  if (!options.dryRun) {
    console.log("Hint: Run /api/admin/sightseeing-autofill after seed import to enrich TS sightseeing scoring fields.");
  }
}

run().catch((error: any) => {
  console.error(`fatal: ${String(error?.message ?? error)}`);
  process.exitCode = 1;
});
