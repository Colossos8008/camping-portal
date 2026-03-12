import "dotenv/config";
import { prisma } from "../src/lib/prisma";

type CandidateRow = {
  id: number;
  sightExternalId: string;
  name: string;
  lat: number;
  lng: number;
  heroImageUrl: string | null;
  sightSource: string | null;
  sightCategory: string | null;
  sightDescription: string | null;
  sightTags: string[];
  sightRegion: string | null;
  sightCountry: string | null;
  thumbnailImageId: number | null;
  updatedAt: Date;
};

type DedupeGroup = {
  sightExternalId: string;
  rows: CandidateRow[];
};

function countFractionDigits(value: number): number {
  const [, fraction = ""] = String(value).split(".");
  return fraction.length;
}

function scoreRow(row: CandidateRow): number {
  const hasHero = row.heroImageUrl ? 1000 : 0;
  const coordPrecision = Math.min(12, countFractionDigits(row.lat)) + Math.min(12, countFractionDigits(row.lng));
  const sightseeingCompleteness =
    (row.sightCategory ? 10 : 0) +
    (row.sightDescription ? 10 : 0) +
    ((row.sightTags?.length ?? 0) > 0 ? 10 : 0) +
    (row.sightRegion ? 5 : 0) +
    (row.sightCountry ? 5 : 0);
  const freshness = Math.floor(row.updatedAt.getTime() / 1000);

  return hasHero * 1_000_000_000 + coordPrecision * 1_000_000 + sightseeingCompleteness * 1_000 + freshness;
}

function sortRowsByPriority(rows: CandidateRow[]): CandidateRow[] {
  return [...rows].sort((a, b) => {
    const scoreDiff = scoreRow(b) - scoreRow(a);
    if (scoreDiff !== 0) return scoreDiff;
    return b.id - a.id;
  });
}

async function findDuplicateGroups(): Promise<DedupeGroup[]> {
  const grouped = await prisma.place.groupBy({
    by: ["sightExternalId"],
    where: {
      type: "SEHENSWUERDIGKEIT",
      sightExternalId: { not: null },
    },
    _count: { _all: true },
    having: {
      sightExternalId: { _count: { gt: 1 } },
    },
  });

  const groups: DedupeGroup[] = [];
  for (const entry of grouped) {
    if (!entry.sightExternalId) continue;
    const rows = (await prisma.place.findMany({
      where: {
        type: "SEHENSWUERDIGKEIT",
        sightExternalId: entry.sightExternalId,
      },
      select: {
        id: true,
        sightExternalId: true,
        name: true,
        lat: true,
        lng: true,
        heroImageUrl: true,
        sightSource: true,
        sightCategory: true,
        sightDescription: true,
        sightTags: true,
        sightRegion: true,
        sightCountry: true,
        thumbnailImageId: true,
        updatedAt: true,
      },
      orderBy: { id: "asc" },
    })) as CandidateRow[];

    groups.push({
      sightExternalId: entry.sightExternalId,
      rows,
    });
  }

  return groups;
}

async function dedupe({ dryRun }: { dryRun: boolean }) {
  const groups = await findDuplicateGroups();

  if (groups.length === 0) {
    console.log("No duplicates found by sightExternalId.");
    return;
  }

  let deletedRows = 0;
  let updatedRows = 0;

  for (const group of groups) {
    const ranked = sortRowsByPriority(group.rows);
    const keeper = ranked[0];
    const losers = ranked.slice(1);

    console.log(
      `[dedupe] sightExternalId=${group.sightExternalId} keeper=#${keeper.id} (${keeper.name}) remove=${losers
        .map((x) => `#${x.id}`)
        .join(", ")}`
    );

    if (dryRun) continue;

    await prisma.$transaction(async (tx) => {
      for (const loser of losers) {
        await tx.image.updateMany({ where: { placeId: loser.id }, data: { placeId: keeper.id } });

        if (!keeper.thumbnailImageId && loser.thumbnailImageId) {
          await tx.place.update({ where: { id: keeper.id }, data: { thumbnailImageId: loser.thumbnailImageId } });
          keeper.thumbnailImageId = loser.thumbnailImageId;
          updatedRows += 1;
        }

        await tx.place.delete({ where: { id: loser.id } });
        deletedRows += 1;
      }
    });
  }

  console.log(`Done. groups=${groups.length} deletedRows=${deletedRows} updatedRows=${updatedRows}`);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  console.log(`Starting dedupe by sightExternalId. dryRun=${dryRun}`);
  await dedupe({ dryRun });
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
