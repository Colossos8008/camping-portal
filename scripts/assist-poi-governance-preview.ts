import { derivePoiGovernanceFromOsmElement } from "../src/lib/poi-governance";
import { parseOverpassElements, normalizeCandidate, REGION_CONFIGS } from "../src/lib/sightseeing-seed-import";

type CliArgs = {
  region: keyof typeof REGION_CONFIGS;
  limit: number;
};

function parseArgs(argv: string[]): CliArgs {
  const regionRaw = String(argv.find((arg) => arg.startsWith("--region=")) ?? "").replace("--region=", "").trim();
  const limitRaw = String(argv.find((arg) => arg.startsWith("--limit=")) ?? "").replace("--limit=", "").trim();

  const region = (regionRaw || "normandie") as keyof typeof REGION_CONFIGS;
  if (!(region in REGION_CONFIGS)) {
    throw new Error(`Unknown region=${region}. Allowed: ${Object.keys(REGION_CONFIGS).join(", ")}`);
  }

  const limit = limitRaw ? Number(limitRaw) : 15;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("--limit must be an integer between 1 and 100.");
  }

  return { region, limit };
}

async function queryOverpass(region: string): Promise<unknown> {
  const query = `[out:json][timeout:90];\narea["ISO3166-2"="${region}"]["admin_level"="4"]->.searchArea;\n(\n  nwr["tourism"="attraction"](area.searchArea);\n  nwr["historic"](area.searchArea);\n  nwr["tourism"="viewpoint"](area.searchArea);\n);\nout center tags;`;

  const response = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      "User-Agent": "camping-portal-poi-governance-preview/1.0",
    },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass call failed with status=${response.status}`);
  }

  return response.json();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const regionCfg = REGION_CONFIGS[args.region];
  const payload = await queryOverpass(regionCfg.iso3166_2 ?? "FR-NOR");
  const parsed = parseOverpassElements(payload).slice(0, args.limit * 4);

  const accepted = parsed
    .map((element) => {
      const candidate = normalizeCandidate(element, regionCfg);
      if (!candidate) return null;
      const governance = derivePoiGovernanceFromOsmElement(element);
      return {
        name: candidate.name,
        sourceId: candidate.sourceId,
        category: candidate.category,
        poiDecisionType: governance.poiDecisionType,
        identityPrimarySource: governance.identityPrimarySource,
        coordinatePrimarySource: governance.coordinatePrimarySource,
        coordinateMode: governance.coordinateMode,
        coordinateConfidence: governance.coordinateConfidence,
        reviewState: governance.suggestedReviewState,
        canonicalSource: governance.canonicalSource,
        canonicalSourceId: governance.canonicalSourceId,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
    .slice(0, args.limit);

  const histogram = accepted.reduce<Record<string, number>>((acc, entry) => {
    acc[entry.reviewState] = (acc[entry.reviewState] ?? 0) + 1;
    return acc;
  }, {});

  console.log(JSON.stringify({ region: args.region, limit: args.limit, histogram, sample: accepted }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
