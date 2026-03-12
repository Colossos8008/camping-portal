import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCuratedPresetCandidates } from "../src/lib/curated-sightseeing-presets";

type CoordinateStatus = "GOOD" | "OKAY" | "BAD";
type ImageStatus = "GOOD" | "BAD" | "UNKNOWN";
type ConsensusQuality = "STRONG" | "MEDIUM" | "WEAK" | "NONE";
type SourceStatus = "ok" | "missing" | "error" | "unavailable";
type SourceName = "google_places" | "osm_nominatim" | "osm_direct" | "wikidata" | "wikipedia";

type GoldSetEntry = {
  placeKey: string;
  placeName: string;
  coordinateStatus: CoordinateStatus;
  imageStatus: ImageStatus;
  reviewNote: string;
  targetPointTypeExpected: string;
};

type CliArgs = {
  key: string | null;
  status: CoordinateStatus | null;
  limit: number | null;
  write: boolean;
};

type CandidateResult = {
  source: SourceName;
  lat: number | null;
  lng: number | null;
  label: string;
  sourceId: string;
  rawType: string;
  rawClass: string;
  confidenceHint: string;
  status: SourceStatus;
  note: string;
};

type CuratedHint = {
  wikidataId: string | null;
  osmType: string | null;
  osmId: string | null;
};

type AnalysisResult = {
  placeKey: string;
  placeName: string;
  goldSetReview: {
    coordinateStatus: CoordinateStatus;
    imageStatus: ImageStatus;
    reviewNote: string;
    targetPointTypeExpected: string;
  };
  candidates: {
    googlePlaces: CandidateResult;
    osmNominatim: CandidateResult;
    osmDirect: CandidateResult;
    wikidata: CandidateResult;
    wikipedia: CandidateResult;
  };
  distances: {
    candidateToCandidateMeters: Record<string, number>;
    candidateToCenterMeters: Record<string, number>;
  };
  consensus: {
    tightClusterCount: number;
    looseClusterCount: number;
    outlierSources: string[];
    consensusCenterLat: number | null;
    consensusCenterLng: number | null;
    consensusQuality: ConsensusQuality;
    bestClusterSources: string[];
  };
};

const GOLD_SET_PATH = resolve(process.cwd(), "data/review/koblenz-goldset-v1.json");
const OUTPUT_PATH = resolve(process.cwd(), "data/review/koblenz-goldset-source-comparison.json");
const UA = "camping-portal-koblenz-goldset-source-compare/1.0";

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { key: null, status: null, limit: null, write: true };
  for (const arg of argv) {
    if (arg.startsWith("--key=")) out.key = arg.slice(6).trim() || null;
    else if (arg.startsWith("--status=")) {
      const v = arg.slice(9).trim().toUpperCase();
      if (v === "GOOD" || v === "OKAY" || v === "BAD") out.status = v;
    } else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice(8));
      if (Number.isFinite(n) && n > 0) out.limit = Math.floor(n);
    } else if (arg === "--write") out.write = true;
  }
  return out;
}

function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (v: number) => (v * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const p = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(p), Math.sqrt(1 - p));
}

function pickGoogleApiKey(): { apiKey: string; source: "GOOGLE_PLACES_API_KEY" | "GOOGLE_MAPS_API_KEY" | "none" } {
  const places = String(process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
  if (places) return { apiKey: places, source: "GOOGLE_PLACES_API_KEY" };
  const maps = String(process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  if (maps) return { apiKey: maps, source: "GOOGLE_MAPS_API_KEY" };
  return { apiKey: "", source: "none" };
}

function parseCuratedHints(): Map<string, CuratedHint> {
  const map = new Map<string, CuratedHint>();
  for (const item of getCuratedPresetCandidates("nievern-highlights")) {
    const notes = String(item.suggestedReviewReason ?? "");
    const osmMatch = notes.match(/osm=osm:(node|way|relation)\/(\d+)/i);
    map.set(item.sourceId.split(":").at(-1) ?? item.name.toLowerCase(), {
      wikidataId: item.wikidataId ?? null,
      osmType: osmMatch?.[1]?.toLowerCase() ?? null,
      osmId: osmMatch?.[2] ?? null,
    });
  }
  return map;
}

async function fetchGoogle(placeName: string): Promise<CandidateResult> {
  const { apiKey, source } = pickGoogleApiKey();
  if (!apiKey) {
    return { source: "google_places", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "missing", note: "Missing GOOGLE_PLACES_API_KEY / GOOGLE_MAPS_API_KEY" };
  }

  try {
    const payload = { textQuery: `${placeName} Koblenz Region`, languageCode: "de", regionCode: "DE", maxResultCount: 5 };
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": apiKey,
        "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.location,places.types",
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) return { source: "google_places", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "error", note: `HTTP ${res.status} (key source: ${source})` };
    const data = (await res.json().catch(() => ({}))) as { places?: Array<{ id?: string; displayName?: { text?: string }; formattedAddress?: string; location?: { latitude?: number; longitude?: number }; types?: string[] }> };
    const best = (data.places ?? []).find((p) => Number.isFinite(p.location?.latitude) && Number.isFinite(p.location?.longitude));
    if (!best) return { source: "google_places", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "missing", note: "No place with coordinates" };
    return {
      source: "google_places",
      lat: Number(best.location?.latitude),
      lng: Number(best.location?.longitude),
      label: String(best.displayName?.text ?? placeName),
      sourceId: String(best.id ?? ""),
      rawType: String(best.types?.[0] ?? ""),
      rawClass: "google_place",
      confidenceHint: "text_search_best_hit",
      status: "ok",
      note: `via places-v1 (${source})`,
    };
  } catch (error) {
    return { source: "google_places", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "error", note: String(error) };
  }
}

async function fetchNominatim(placeName: string): Promise<CandidateResult> {
  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&accept-language=de&q=${encodeURIComponent(placeName)}&limit=5`;
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok) return { source: "osm_nominatim", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "error", note: `HTTP ${res.status}` };
    const items = (await res.json().catch(() => [])) as Array<{ lat?: string; lon?: string; display_name?: string; osm_id?: string | number; osm_type?: string; type?: string; class?: string; importance?: number }>;
    const best = items.find((it) => Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lon)));
    if (!best) return { source: "osm_nominatim", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "missing", note: "No nominatim result" };
    return {
      source: "osm_nominatim",
      lat: Number(best.lat),
      lng: Number(best.lon),
      label: String(best.display_name ?? placeName),
      sourceId: `osm:${String(best.osm_type ?? "unknown")}/${String(best.osm_id ?? "unknown")}`,
      rawType: String(best.type ?? ""),
      rawClass: String(best.class ?? ""),
      confidenceHint: `importance=${String(best.importance ?? "n/a")}`,
      status: "ok",
      note: "best text-search hit",
    };
  } catch (error) {
    return { source: "osm_nominatim", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "error", note: String(error) };
  }
}

async function fetchOsmDirect(hint: CuratedHint): Promise<CandidateResult> {
  if (!hint.osmType || !hint.osmId) {
    return { source: "osm_direct", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "unavailable", note: "No direct OSM id available" };
  }
  try {
    const prefix = hint.osmType === "node" ? "N" : hint.osmType === "way" ? "W" : "R";
    const url = `https://nominatim.openstreetmap.org/lookup?format=jsonv2&osm_ids=${prefix}${encodeURIComponent(hint.osmId)}`;
    const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok) return { source: "osm_direct", lat: null, lng: null, label: "", sourceId: `osm:${hint.osmType}/${hint.osmId}`, rawType: "", rawClass: "", confidenceHint: "", status: "error", note: `HTTP ${res.status}` };
    const items = (await res.json().catch(() => [])) as Array<{ lat?: string; lon?: string; display_name?: string; class?: string; type?: string }>;
    const best = items.find((it) => Number.isFinite(Number(it.lat)) && Number.isFinite(Number(it.lon)));
    if (!best) return { source: "osm_direct", lat: null, lng: null, label: "", sourceId: `osm:${hint.osmType}/${hint.osmId}`, rawType: "", rawClass: "", confidenceHint: "", status: "missing", note: "Direct OSM element has no coordinate" };
    return {
      source: "osm_direct",
      lat: Number(best.lat),
      lng: Number(best.lon),
      label: String(best.display_name ?? "OSM direct"),
      sourceId: `osm:${hint.osmType}/${hint.osmId}`,
      rawType: String(best.type ?? ""),
      rawClass: String(best.class ?? ""),
      confidenceHint: "derived_from_curated_sourceNotes",
      status: "ok",
      note: "lookup via nominatim/osm_ids",
    };
  } catch (error) {
    return { source: "osm_direct", lat: null, lng: null, label: "", sourceId: `osm:${hint.osmType}/${hint.osmId}`, rawType: "", rawClass: "", confidenceHint: "", status: "error", note: String(error) };
  }
}

async function fetchWikidata(placeName: string, hint: CuratedHint): Promise<CandidateResult> {
  const wikidataId = hint.wikidataId;
  if (!wikidataId) {
    return { source: "wikidata", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "unavailable", note: "No Wikidata id available" };
  }

  try {
    const entityUrl = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(wikidataId)}.json`;
    const res = await fetch(entityUrl, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!res.ok) return { source: "wikidata", lat: null, lng: null, label: "", sourceId: wikidataId, rawType: "", rawClass: "", confidenceHint: "", status: "error", note: `HTTP ${res.status}` };
    const payload = (await res.json().catch(() => ({}))) as any;
    const entity = payload.entities?.[wikidataId];
    const coord = entity?.claims?.P625?.[0]?.mainsnak?.datavalue?.value;
    if (!Number.isFinite(coord?.latitude) || !Number.isFinite(coord?.longitude)) {
      return { source: "wikidata", lat: null, lng: null, label: "", sourceId: wikidataId, rawType: "P625", rawClass: "globe-coordinate", confidenceHint: "", status: "missing", note: "Wikidata item has no P625 coordinate" };
    }
    return {
      source: "wikidata",
      lat: Number(coord?.latitude),
      lng: Number(coord?.longitude),
      label: String(entity?.labels?.de?.value ?? entity?.labels?.en?.value ?? placeName),
      sourceId: wikidataId,
      rawType: "P625",
      rawClass: "globe-coordinate",
      confidenceHint: "identity_coordinate",
      status: "ok",
      note: "from Wikidata entity P625",
    };
  } catch (error) {
    return { source: "wikidata", lat: null, lng: null, label: "", sourceId: wikidataId, rawType: "", rawClass: "", confidenceHint: "", status: "error", note: String(error) };
  }
}

async function fetchWikipedia(wikidataCandidate: CandidateResult): Promise<CandidateResult> {
  if (wikidataCandidate.status !== "ok" || !wikidataCandidate.sourceId) {
    return { source: "wikipedia", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "unavailable", note: "Wikipedia lookup skipped without stable Wikidata base" };
  }

  try {
    const entityUrl = `https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(wikidataCandidate.sourceId)}.json`;
    const entityRes = await fetch(entityUrl, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!entityRes.ok) return { source: "wikipedia", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "error", note: `Wikidata sitelink HTTP ${entityRes.status}` };
    const entityPayload = (await entityRes.json().catch(() => ({}))) as any;
    const sitelinks = entityPayload.entities?.[wikidataCandidate.sourceId]?.sitelinks;
    const deTitle = sitelinks?.dewiki?.title;
    const enTitle = sitelinks?.enwiki?.title;
    const wikiHost = deTitle ? "de.wikipedia.org" : enTitle ? "en.wikipedia.org" : "";
    const title = deTitle ?? enTitle;
    if (!title || !wikiHost) return { source: "wikipedia", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "missing", note: "No dewiki/enwiki sitelink" };

    const url = new URL(`https://${wikiHost}/w/api.php`);
    url.searchParams.set("action", "query");
    url.searchParams.set("format", "json");
    url.searchParams.set("prop", "coordinates");
    url.searchParams.set("titles", title);

    const wpRes = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
    if (!wpRes.ok) return { source: "wikipedia", lat: null, lng: null, label: String(title), sourceId: String(title), rawType: "", rawClass: "", confidenceHint: "", status: "error", note: `HTTP ${wpRes.status}` };
    const wpData = (await wpRes.json().catch(() => ({}))) as { query?: { pages?: Record<string, { title?: string; coordinates?: Array<{ lat?: number; lon?: number }> }> } };
    const page = Object.values(wpData.query?.pages ?? {})[0];
    const coord = page?.coordinates?.[0];
    if (!Number.isFinite(coord?.lat) || !Number.isFinite(coord?.lon)) {
      return { source: "wikipedia", lat: null, lng: null, label: String(page?.title ?? title), sourceId: String(title), rawType: "coordinates", rawClass: "wikipedia-api", confidenceHint: "", status: "missing", note: "No coordinates in Wikipedia API result" };
    }
    return {
      source: "wikipedia",
      lat: Number(coord?.lat),
      lng: Number(coord?.lon),
      label: String(page?.title ?? title),
      sourceId: String(title),
      rawType: "coordinates",
      rawClass: "wikipedia-api",
      confidenceHint: "sitelink_coordinates",
      status: "ok",
      note: "from Wikipedia API (no HTML scraping)",
    };
  } catch (error) {
    return { source: "wikipedia", lat: null, lng: null, label: "", sourceId: "", rawType: "", rawClass: "", confidenceHint: "", status: "error", note: String(error) };
  }
}

function buildClusters(points: Array<{ source: string; lat: number; lng: number }>, thresholdMeters: number): string[] {
  if (!points.length) return [];
  const visited = new Set<number>();
  let best: number[] = [];

  for (let i = 0; i < points.length; i += 1) {
    if (visited.has(i)) continue;
    const stack = [i];
    const component: number[] = [];
    visited.add(i);
    while (stack.length) {
      const current = stack.pop()!;
      component.push(current);
      for (let j = 0; j < points.length; j += 1) {
        if (visited.has(j)) continue;
        const d = distanceMeters(points[current]!, points[j]!);
        if (d <= thresholdMeters) {
          visited.add(j);
          stack.push(j);
        }
      }
    }
    if (component.length > best.length) best = component;
  }

  return best.map((idx) => points[idx]!.source);
}

function analyzeConsensus(candidates: CandidateResult[]) {
  const valid = candidates
    .filter((c) => c.status === "ok" && Number.isFinite(c.lat) && Number.isFinite(c.lng))
    .map((c) => ({ source: c.source, lat: c.lat as number, lng: c.lng as number }));

  const pairwise: Record<string, number> = {};
  for (let i = 0; i < valid.length; i += 1) {
    for (let j = i + 1; j < valid.length; j += 1) {
      const key = `${valid[i]!.source}__${valid[j]!.source}`;
      pairwise[key] = Math.round(distanceMeters(valid[i]!, valid[j]!));
    }
  }

  if (!valid.length) {
    return {
      pairwise,
      toCenter: {} as Record<string, number>,
      consensusCenterLat: null,
      consensusCenterLng: null,
      tightClusterCount: 0,
      looseClusterCount: 0,
      bestClusterSources: [] as string[],
      outlierSources: [] as string[],
      consensusQuality: "NONE" as ConsensusQuality,
    };
  }

  const center = {
    lat: valid.reduce((sum, p) => sum + p.lat, 0) / valid.length,
    lng: valid.reduce((sum, p) => sum + p.lng, 0) / valid.length,
  };

  const toCenter: Record<string, number> = {};
  for (const point of valid) toCenter[point.source] = Math.round(distanceMeters(point, center));

  const tightSources = buildClusters(valid, 75);
  const looseSources = buildClusters(valid, 250);
  const outlierSources = valid.filter((p) => !looseSources.includes(p.source)).map((p) => p.source);

  let consensusQuality: ConsensusQuality = "WEAK";
  if (tightSources.length >= 3 || (tightSources.length >= 2 && valid.length >= 3)) consensusQuality = "STRONG";
  else if (looseSources.length >= 2 && outlierSources.length === 0) consensusQuality = "MEDIUM";
  else if (valid.length <= 1) consensusQuality = "WEAK";
  if (valid.length === 0) consensusQuality = "NONE";

  return {
    pairwise,
    toCenter,
    consensusCenterLat: Number(center.lat.toFixed(6)),
    consensusCenterLng: Number(center.lng.toFixed(6)),
    tightClusterCount: tightSources.length,
    looseClusterCount: looseSources.length,
    bestClusterSources: tightSources.length ? tightSources : looseSources,
    outlierSources,
    consensusQuality,
  };
}

async function analyzeEntry(entry: GoldSetEntry, hint: CuratedHint): Promise<AnalysisResult> {
  const [googlePlaces, osmNominatim, osmDirect, wikidata] = await Promise.all([
    fetchGoogle(entry.placeName),
    fetchNominatim(`${entry.placeName} Rheinland-Pfalz`),
    fetchOsmDirect(hint),
    fetchWikidata(entry.placeName, hint),
  ]);
  const wikipedia = await fetchWikipedia(wikidata);

  const allCandidates = [googlePlaces, osmNominatim, osmDirect, wikidata, wikipedia];
  const consensus = analyzeConsensus(allCandidates);

  return {
    placeKey: entry.placeKey,
    placeName: entry.placeName,
    goldSetReview: {
      coordinateStatus: entry.coordinateStatus,
      imageStatus: entry.imageStatus,
      reviewNote: entry.reviewNote,
      targetPointTypeExpected: entry.targetPointTypeExpected,
    },
    candidates: { googlePlaces, osmNominatim, osmDirect, wikidata, wikipedia },
    distances: {
      candidateToCandidateMeters: consensus.pairwise,
      candidateToCenterMeters: consensus.toCenter,
    },
    consensus: {
      tightClusterCount: consensus.tightClusterCount,
      looseClusterCount: consensus.looseClusterCount,
      outlierSources: consensus.outlierSources,
      consensusCenterLat: consensus.consensusCenterLat,
      consensusCenterLng: consensus.consensusCenterLng,
      consensusQuality: consensus.consensusQuality,
      bestClusterSources: consensus.bestClusterSources,
    },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const raw = readFileSync(GOLD_SET_PATH, "utf-8");
  const parsed = JSON.parse(raw) as GoldSetEntry[];
  const hints = parseCuratedHints();

  let entries = parsed;
  if (args.key) entries = entries.filter((e) => e.placeKey === args.key);
  if (args.status) entries = entries.filter((e) => e.coordinateStatus === args.status);
  if (args.limit) entries = entries.slice(0, args.limit);

  const results: AnalysisResult[] = [];
  for (const entry of entries) {
    const hint = hints.get(entry.placeKey) ?? { wikidataId: null, osmType: null, osmId: null };
    results.push(await analyzeEntry(entry, hint));
  }

  const consensusCounts = { STRONG: 0, MEDIUM: 0, WEAK: 0, NONE: 0 };
  const goldCounts = { GOOD: 0, OKAY: 0, BAD: 0 };
  let badWithConsensus = 0;
  let badWithoutConsensus = 0;

  for (const row of results) {
    consensusCounts[row.consensus.consensusQuality] += 1;
    goldCounts[row.goldSetReview.coordinateStatus] += 1;
    if (row.goldSetReview.coordinateStatus === "BAD") {
      if (row.consensus.consensusQuality === "STRONG" || row.consensus.consensusQuality === "MEDIUM") badWithConsensus += 1;
      else badWithoutConsensus += 1;
    }
  }

  const output = {
    generatedAt: new Date().toISOString(),
    input: "data/review/koblenz-goldset-v1.json",
    total: results.length,
    options: args,
    summary: {
      consensusCounts,
      goldCounts,
      badWithStrongOrMediumConsensus: badWithConsensus,
      badWithoutUsableConsensus: badWithoutConsensus,
    },
    results,
  };

  if (args.write) writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf-8");

  console.log(`total POIs: ${results.length}`);
  console.log(`consensus STRONG/MEDIUM/WEAK/NONE: ${consensusCounts.STRONG}/${consensusCounts.MEDIUM}/${consensusCounts.WEAK}/${consensusCounts.NONE}`);
  console.log(`gold GOOD/OKAY/BAD: ${goldCounts.GOOD}/${goldCounts.OKAY}/${goldCounts.BAD}`);
  console.log(`BAD with STRONG|MEDIUM consensus: ${badWithConsensus}`);
  console.log(`BAD without usable consensus: ${badWithoutConsensus}`);
  console.log("");

  for (const row of results) {
    const cluster = row.consensus.bestClusterSources.join(",") || "-";
    const outliers = row.consensus.outlierSources.join(",") || "-";
    console.log(`${row.placeKey} | gold=${row.goldSetReview.coordinateStatus} | consensus=${row.consensus.consensusQuality} | cluster=${cluster} | outliers=${outliers}`);
  }

  if (args.write) console.log(`\nWrote: data/review/koblenz-goldset-source-comparison.json`);
}

main().catch((error) => {
  console.error("compare-koblenz-goldset-sources failed", error);
  process.exit(1);
});
