import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { validateHeroUrl } from "../src/lib/hero-url-validation.ts";

const PRIORITY_KEYS = [
  "deutsches-eck",
  "festung-ehrenbreitstein",
  "altstadt-koblenz",
  "schloss-stolzenfels",
  "kurfuerstliches-schloss-koblenz",
  "marksburg",
  "abtei-maria-laach",
  "burg-lahneck",
  "schloss-sayn",
  "burg-eltz",
  "geysir-andernach",
  "liebfrauenkirche-koblenz",
  "florinskirche-koblenz",
  "jesuitenplatz",
  "historiensaeule-koblenz",
  "garten-der-schmetterlinge-sayn",
  "kurhaus-bad-ems",
] as const;

async function main() {
  const externalIds = PRIORITY_KEYS.map((key) => `curated:nievern-highlights:${key}`);

  const places = await prisma.place.findMany({
    where: {
      type: "SEHENSWUERDIGKEIT",
      sightExternalId: { in: externalIds },
    },
    select: {
      id: true,
      name: true,
      lat: true,
      lng: true,
      sightExternalId: true,
      heroImageUrl: true,
      sightseeingTotalScore: true,
    },
    orderBy: { name: "asc" },
  });

  const byExternalId = new Map(places.map((p) => [String(p.sightExternalId), p]));

  for (const externalId of externalIds) {
    const place = byExternalId.get(externalId);
    if (!place) {
      console.log(`missing\tid=-\tname=-\tlat=-\tlng=-\tsightExternalId=${externalId}\theroImageUrl=-\thero=failed`);
      continue;
    }

    const heroImageUrl = String(place.heroImageUrl ?? "").trim();
    let heroStatus = "failed";
    let heroDetail = "-";

    if (heroImageUrl) {
      const validation = await validateHeroUrl(heroImageUrl);
      heroStatus = validation.ok ? "ok" : "failed";
      heroDetail = `status=${validation.status ?? "-"},type=${validation.contentType ?? "-"},final=${validation.finalUrl ?? "-"}${validation.error ? `,error=${validation.error}` : ""}`;
    }

    console.log(
      `${heroStatus}\tid=${place.id}\tname=${place.name}\tlat=${place.lat}\tlng=${place.lng}\tsightExternalId=${place.sightExternalId ?? "-"}\theroImageUrl=${heroImageUrl || "-"}\tscore=${typeof place.sightseeingTotalScore === "number" ? place.sightseeingTotalScore : "-"}\theroCheck=${heroDetail}`
    );
  }
}

void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
