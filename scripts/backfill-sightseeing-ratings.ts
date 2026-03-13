import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { rateSightseeing } from "../src/lib/sightseeing-rating.ts";

function toSightseeingInput(place: {
  name: string;
  type: "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";
  heroReason: string | null;
  sightDescription: string | null;
  sightCategory: string | null;
  sightTags: string[];
  sightSource: string | null;
  sightRegion: string | null;
  sightCountry: string | null;
}) {
  return {
    name: place.name,
    type: place.type,
    description: [place.sightDescription, place.heroReason].filter((value) => typeof value === "string" && value.trim().length > 0).join(" "),
    category: place.sightCategory ?? undefined,
    tags: Array.isArray(place.sightTags) ? place.sightTags : undefined,
    source: place.sightSource ?? undefined,
    region: place.sightRegion ?? undefined,
    country: place.sightCountry ?? undefined,
  };
}

async function main() {
  const places = await prisma.place.findMany({
    where: { type: "SEHENSWUERDIGKEIT" },
    select: {
      id: true,
      name: true,
      type: true,
      heroReason: true,
      sightDescription: true,
      sightCategory: true,
      sightTags: true,
      sightSource: true,
      sightRegion: true,
      sightCountry: true,
    },
    orderBy: { id: "asc" },
  });

  let updated = 0;

  for (const place of places) {
    const rating = rateSightseeing(toSightseeingInput(place));
    await prisma.place.update({
      where: { id: place.id },
      data: rating,
    });
    updated += 1;
  }

  console.log(`backfill-sightseeing-ratings: updated ${updated} sightseeing places`);
}

main()
  .catch((error) => {
    console.error("backfill-sightseeing-ratings: failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
