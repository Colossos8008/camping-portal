import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { getCuratedPresetCandidates, listCuratedPresetKeys } from "../src/lib/curated-sightseeing-presets.ts";
import { normalizeName } from "../src/lib/sightseeing-seed-import.ts";

type CuratedPlace = {
  id: number;
  name: string;
  type: "SEHENSWUERDIGKEIT";
  lat: number;
  lng: number;
  sightExternalId: string | null;
  sightSource: string | null;
};

function parsePresetArg(argv: string[]): string {
  const hit = argv.find((arg) => arg.startsWith("--preset="));
  const preset = hit?.slice("--preset=".length).trim().toLowerCase() || "nievern-highlights";
  if (!listCuratedPresetKeys().includes(preset)) {
    throw new Error(`Unknown curated preset: ${preset}. Allowed: ${listCuratedPresetKeys().join(" | ")}`);
  }
  return preset;
}

function nameSimilarity(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(" ").filter((x) => x.length >= 3));
  const tb = new Set(normalizeName(b).split(" ").filter((x) => x.length >= 3));
  if (ta.size === 0 || tb.size === 0) return 0;
  let overlap = 0;
  for (const token of ta) if (tb.has(token)) overlap += 1;
  return overlap / new Set([...ta, ...tb]).size;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const preset = parsePresetArg(process.argv.slice(2));
  const candidates = getCuratedPresetCandidates(preset);
  const bySourceId = new Map(candidates.map((c) => [c.sourceId, c]));
  const byNormalizedName = new Map(candidates.map((c) => [normalizeName(c.name), c]));

  const curatedPrefix = `curated:${preset}:`;
  const existing = (await prisma.place.findMany({
    where: {
      type: "SEHENSWUERDIGKEIT",
      OR: [
        { sightExternalId: { startsWith: curatedPrefix } },
        { name: { in: candidates.map((c) => c.name) } },
      ],
    },
    select: {
      id: true,
      name: true,
      type: true,
      lat: true,
      lng: true,
      sightExternalId: true,
      sightSource: true,
    },
    orderBy: { id: "asc" },
  })) as CuratedPlace[];

  const bySourceRow = new Map<string, CuratedPlace>();
  for (const row of existing) {
    if (row.sightExternalId) bySourceRow.set(row.sightExternalId, row);
  }

  let detached = 0;
  let reassigned = 0;
  let updatedByName = 0;
  let created = 0;

  for (const row of existing) {
    const sourceId = row.sightExternalId;
    if (!sourceId || !sourceId.startsWith(curatedPrefix)) continue;
    const expected = bySourceId.get(sourceId);
    if (!expected) continue;

    const mismatch = normalizeName(row.name) !== normalizeName(expected.name) && nameSimilarity(row.name, expected.name) < 0.6;
    if (!mismatch) continue;

    const preferred = byNormalizedName.get(normalizeName(row.name));
    if (preferred && preferred.sourceId !== sourceId && !bySourceRow.has(preferred.sourceId)) {
      console.log(`[repair] reassign #${row.id} ${row.name}: ${sourceId} -> ${preferred.sourceId}`);
      reassigned += 1;
      bySourceRow.delete(sourceId);
      bySourceRow.set(preferred.sourceId, row);
      row.sightExternalId = preferred.sourceId;
      if (!dryRun) {
        await prisma.place.update({
          where: { id: row.id },
          data: {
            sightExternalId: preferred.sourceId,
            sightSource: preferred.source,
            sightCategory: preferred.category,
            sightDescription: preferred.reason,
            sightTags: preferred.tags,
            sightRegion: preferred.sourceRegion,
            sightCountry: preferred.country,
            name: preferred.name,
            lat: preferred.lat,
            lng: preferred.lng,
          },
        });
      }
      continue;
    }

    console.log(`[repair] detach #${row.id} ${row.name} from mismatched ${sourceId}`);
    detached += 1;
    bySourceRow.delete(sourceId);
    row.sightExternalId = null;
    if (!dryRun) {
      await prisma.place.update({
        where: { id: row.id },
        data: { sightExternalId: null },
      });
    }
  }

  for (const candidate of candidates) {
    const existingBySource = bySourceRow.get(candidate.sourceId);
    if (existingBySource) {
      const mismatch =
        normalizeName(existingBySource.name) !== normalizeName(candidate.name) &&
        nameSimilarity(existingBySource.name, candidate.name) < 0.6;
      if (mismatch) {
        console.log(`[repair] keep mismatched #${existingBySource.id} (${existingBySource.name}) untouched for ${candidate.sourceId}`);
      }
      continue;
    }

    const byName = existing.find((row) => normalizeName(row.name) === normalizeName(candidate.name));
    if (byName) {
      console.log(`[repair] attach by name #${byName.id} ${byName.name} -> ${candidate.sourceId}`);
      updatedByName += 1;
      bySourceRow.set(candidate.sourceId, byName);
      if (!dryRun) {
        await prisma.place.update({
          where: { id: byName.id },
          data: {
            sightExternalId: candidate.sourceId,
            sightSource: candidate.source,
            sightCategory: candidate.category,
            sightDescription: candidate.reason,
            sightTags: candidate.tags,
            sightRegion: candidate.sourceRegion,
            sightCountry: candidate.country,
            lat: candidate.lat,
            lng: candidate.lng,
            ...(candidate.heroImageUrl ? { heroImageUrl: candidate.heroImageUrl } : {}),
          },
        });
      }
      continue;
    }

    console.log(`[repair] create missing ${candidate.name} (${candidate.sourceId})`);
    created += 1;
    if (!dryRun) {
      const createdRow = await prisma.place.create({
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
      });
      bySourceRow.set(candidate.sourceId, {
        id: createdRow.id,
        name: candidate.name,
        type: "SEHENSWUERDIGKEIT",
        lat: candidate.lat,
        lng: candidate.lng,
        sightExternalId: candidate.sourceId,
        sightSource: candidate.source,
      });
    }
  }

  console.log(`Done. preset=${preset} dryRun=${dryRun} detached=${detached} reassigned=${reassigned} updatedByName=${updatedByName} created=${created}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
