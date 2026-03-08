import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getCuratedPresetCandidates } from "../src/lib/curated-sightseeing-presets.ts";

type NominatimHit = {
  place_id?: number;
  display_name?: string;
  lat?: string;
  lon?: string;
  class?: string;
  type?: string;
  addresstype?: string;
  category?: string;
  importance?: number;
};

type CuratedTarget = {
  key: string;
  name: string;
  query: string;
};

type CliArgs = {
  key: string;
  query?: string;
  pick?: number;
  apply: boolean;
  limit: number;
};

const CURATED_FILE = "src/lib/curated-sightseeing-presets.ts";

const PRIORITY_TARGETS: CuratedTarget[] = [
  { key: "marksburg", name: "Marksburg", query: "Marksburg Braubach" },
  { key: "geysir-andernach", name: "Geysir Andernach", query: "Geysir Andernach" },
  { key: "kurhaus-bad-ems", name: "Kurhaus Bad Ems", query: "Kurhaus Bad Ems" },
  { key: "altstadt-koblenz", name: "Altstadt Koblenz", query: "Altstadt Koblenz" },
  {
    key: "kurfuerstliches-schloss-koblenz",
    name: "Kurfürstliches Schloss Koblenz",
    query: "Kurfürstliches Schloss Koblenz",
  },
  { key: "burg-lahneck", name: "Burg Lahneck", query: "Burg Lahneck Lahnstein" },
  { key: "jesuitenplatz", name: "Jesuitenplatz", query: "Jesuitenplatz Koblenz" },
];

function normalize(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseArgs(argv: string[]): CliArgs {
  const key = String(argv.find((arg) => arg.startsWith("--key=")) ?? "").replace("--key=", "").trim();
  const query = String(argv.find((arg) => arg.startsWith("--query=")) ?? "").replace("--query=", "").trim() || undefined;
  const pickRaw = String(argv.find((arg) => arg.startsWith("--pick=")) ?? "").replace("--pick=", "").trim();
  const limitRaw = String(argv.find((arg) => arg.startsWith("--limit=")) ?? "").replace("--limit=", "").trim();

  if (!key) {
    throw new Error([
      "Missing --key=<curated-key>.",
      "Example:",
      "  npm run assist:curated-priority-osm -- --key=marksburg --query=\"Marksburg Braubach\"",
      "  npm run assist:curated-priority-osm -- --key=marksburg --pick=1 --apply",
    ].join("\n"));
  }

  const pick = pickRaw ? Number(pickRaw) : undefined;
  if (pickRaw && (!Number.isInteger(pick) || Number(pick) < 1)) {
    throw new Error("--pick must be a positive integer (1-based index).");
  }

  const limit = limitRaw ? Number(limitRaw) : 6;
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new Error("--limit must be an integer between 1 and 20.");
  }

  return {
    key,
    query,
    pick,
    apply: argv.includes("--apply"),
    limit,
  };
}

function toRad(value: number): number {
  return (value * Math.PI) / 180;
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const earthRadius = 6_371_000;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(h));
}

async function searchViaNominatim(query: string, limit: number): Promise<NominatimHit[]> {
  const url =
    "https://nominatim.openstreetmap.org/search" +
    `?format=jsonv2` +
    `&q=${encodeURIComponent(query)}` +
    `&addressdetails=1` +
    `&limit=${limit}` +
    `&accept-language=de`;

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "User-Agent": "camping-portal-curated-osm-assist/2.0",
    },
  });

  if (!response.ok) {
    throw new Error(`Nominatim request failed for \"${query}\" with status ${response.status}`);
  }

  const payload = (await response.json().catch(() => [])) as unknown;
  return Array.isArray(payload) ? (payload as NominatimHit[]) : [];
}

function applyCoordinateUpdate(content: string, key: string, lat: number, lng: number): string {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(key: \"${escapedKey}\"[^\\n]*?lat:\\s*)(-?\\d+(?:\\.\\d+)?)(,\\s*lng:\\s*)(-?\\d+(?:\\.\\d+)?)`);
  if (!pattern.test(content)) {
    throw new Error(`Could not locate curated row for key=${key} in ${CURATED_FILE}`);
  }
  return content.replace(pattern, `$1${lat.toFixed(6)}$3${lng.toFixed(6)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const curated = getCuratedPresetCandidates("nievern-highlights");

  const byKey = new Map(curated.map((entry) => [entry.sourceId.split(":").at(-1) ?? "", entry]));
  const target = byKey.get(args.key);

  if (!target) {
    const knownPriority = PRIORITY_TARGETS.map((entry) => entry.key).join(", ");
    throw new Error(`Unknown curated key: ${args.key}. Known priority keys: ${knownPriority}`);
  }

  const defaultTarget = PRIORITY_TARGETS.find((entry) => normalize(entry.key) === normalize(args.key));
  const query = args.query ?? defaultTarget?.query ?? target.name;

  const hits = await searchViaNominatim(query, args.limit);

  const candidates = hits
    .map((hit, index) => {
      const lat = Number(hit.lat);
      const lng = Number(hit.lon);
      const hasCoords = Number.isFinite(lat) && Number.isFinite(lng);
      const distance = hasCoords ? distanceMeters(target.lat, target.lng, lat, lng) : null;

      return {
        pick: index + 1,
        place_id: hit.place_id ?? null,
        lat: hasCoords ? lat : null,
        lng: hasCoords ? lng : null,
        display_name: String(hit.display_name ?? ""),
        class: String(hit.class ?? hit.category ?? ""),
        type: String(hit.type ?? hit.addresstype ?? ""),
        importance: Number(hit.importance ?? 0),
        distance_to_curated_m: distance == null ? null : Math.round(distance),
      };
    })
    .filter((entry) => entry.lat != null && entry.lng != null);

  const selected = args.pick != null ? candidates.find((entry) => entry.pick === args.pick) : undefined;

  if (args.apply) {
    if (!selected) {
      throw new Error("--apply requires a valid --pick=<index> from the result list.");
    }

    let content = readFileSync(resolve(CURATED_FILE), "utf8");
    content = applyCoordinateUpdate(content, args.key, Number(selected.lat), Number(selected.lng));
    writeFileSync(resolve(CURATED_FILE), content, "utf8");
  }

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "applied" : "inspect",
        key: args.key,
        curated_name: target.name,
        query,
        is_priority_target: Boolean(defaultTarget),
        curated_point: {
          lat: target.lat,
          lng: target.lng,
        },
        selected_pick: selected ?? null,
        candidates,
        hint: "Review candidates manually. Apply only with --pick and --apply.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
