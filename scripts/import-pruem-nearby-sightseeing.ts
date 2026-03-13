import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { rateSightseeing } from "../src/lib/sightseeing-rating.ts";

type SeedEntry = {
  pageId: number;
  title: string;
  fallbackLat?: number;
  fallbackLng?: number;
  heroImageUrl?: string;
  category?: string;
  tags?: string[];
  customDescription?: string;
};

const SEEDS: SeedEntry[] = [
  { pageId: 842142, title: "Sankt-Salvator-Basilika (Prüm)", category: "basilica", tags: ["basilica", "church", "landmark", "historic", "pruem"] },
  { pageId: 89027, title: "Abtei Prüm", category: "abbey", tags: ["abbey", "monastery", "historic", "major-attraction", "pruem"] },
  { pageId: 10340461, title: "Menhir von Niederprüm", category: "megalith", tags: ["menhir", "prehistoric", "archaeological-site", "unique"] },
  {
    pageId: 10883842,
    title: "Kalvarienberg (Prüm)",
    heroImageUrl: "https://resc.deskline.net/images/RPT/1/f251959e-5203-4079-905d-6c93daecaae7/99/image.jpg",
    category: "viewpoint",
    tags: ["hill", "viewpoint", "forest", "pruem", "panorama"],
    customDescription: "Bewaldete Anhöhe oberhalb von Prüm mit Kreuzweg- und Aussichtskontext als kurzer Natur- und Panoramastopp.",
  },
  { pageId: 12085352, title: "Benediktinerinnenkloster Niederprüm", fallbackLat: 50.196746, fallbackLng: 6.411946, category: "monastery", tags: ["monastery", "historic", "religious-heritage"] },
  { pageId: 1039140, title: "Burg Schönecken", category: "castle", tags: ["castle", "ruins", "landmark", "historic"] },
  {
    pageId: 9898766,
    title: "Schönecker Schweiz",
    heroImageUrl: "https://www.eifel-gast.de/.cm4all/iproc.php/Geologie/Altburgtal%20Dez.%202014.jpg/downsize_1280_0/Altburgtal%20Dez.%202014.jpg",
    category: "nature-area",
    tags: ["nature-reserve", "landscape", "hiking", "scenic", "limestone-valley", "cliffs", "panorama"],
    customDescription: "Großes Naturschutzgebiet der Prümer Kalkmulde mit markanten Felsformationen, Talblicken und landschaftlich starkem Wanderziel.",
  },
  {
    pageId: 11661595,
    title: "Duppacher Maar",
    fallbackLat: 50.2633,
    fallbackLng: 6.54737,
    category: "maar",
    tags: ["maar", "volcanic", "geology", "nature", "vulkaneifel", "crater-lake", "scenic"],
    customDescription: "Vulkanisch geprägtes Maar der Vulkaneifel mit geologischem Erlebniswert und typischer Kraterlandschaft.",
  },
  {
    pageId: 3614606,
    title: "Eichholzmaar",
    category: "maar",
    tags: ["maar", "volcanic", "geology", "nature", "vulkaneifel", "crater-lake", "scenic"],
    customDescription: "Kleineres Maar der Vulkaneifel mit sichtbarem Maarkessel und hohem geologischen Reiz als kurzer Naturstopp.",
  },
  { pageId: 10335740, title: "Menhir von Wallersheim", category: "megalith", tags: ["menhir", "prehistoric", "archaeological-site"] },
  {
    pageId: 663104,
    title: "Schwarzer Mann",
    category: "mountain",
    tags: ["mountain", "viewpoint", "nature", "snow", "hiking", "panorama"],
    customDescription: "Markanter Berg der Schneifel mit Höhenlage, Weitblick und klarer Naturkulisse.",
  },
  {
    pageId: 1043137,
    title: "Hardtkopf (Eifel)",
    heroImageUrl: "https://d2exd72xrrp1s7.cloudfront.net/www/000/1k1/19/19xaykhll34bn17q8spg8ypdh3260qvpry-uhi943014/0?width=768&height=576&crop=true",
    category: "mountain",
    tags: ["mountain", "nature", "viewpoint", "eifel", "panorama", "hiking"],
    customDescription: "Höchste Erhebung am Rand der Prümer Kalkmulde mit Naturpark-Lage und Aussichtspotenzial.",
  },
];

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function toWikiUrl(title: string) {
  return `https://de.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
}

function fallbackCategory(seed: SeedEntry, description: string, categories: string[]) {
  if (seed.category) return seed.category;
  const text = `${description} ${categories.join(" ")}`.toLowerCase();
  if (text.includes("maar")) return "maar";
  if (text.includes("menhir")) return "megalith";
  if (text.includes("burg")) return "castle";
  if (text.includes("abtei")) return "abbey";
  if (text.includes("basilika")) return "basilica";
  if (text.includes("berg")) return "mountain";
  return "landmark";
}

async function fetchPages() {
  const url = new URL("https://de.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "coordinates|extracts|pageimages|description|categories");
  url.searchParams.set("pageids", SEEDS.map((seed) => String(seed.pageId)).join("|"));
  url.searchParams.set("exintro", "1");
  url.searchParams.set("explaintext", "1");
  url.searchParams.set("piprop", "original");
  url.searchParams.set("cllimit", "20");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "camping-portal-pruem-import/1.0",
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Wikipedia request failed: ${response.status}`);
  }

  const json = (await response.json()) as any;
  return new Map<number, any>(Object.values(json.query?.pages ?? {}).map((page: any) => [Number(page.pageid), page]));
}

async function main() {
  const pages = await fetchPages();
  const createdOrUpdated: Array<{ id: number; name: string; action: "created" | "updated" }> = [];

  for (const seed of SEEDS) {
    const page = pages.get(seed.pageId);
    if (!page) {
      console.warn(`missing wikipedia page for ${seed.title} (${seed.pageId})`);
      continue;
    }

    const title = cleanText(page.title) || seed.title;
    const description = cleanText(page.description);
    const extract = cleanText(page.extract);
    const lat = Number(page.coordinates?.[0]?.lat ?? seed.fallbackLat);
    const lng = Number(page.coordinates?.[0]?.lon ?? seed.fallbackLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.warn(`missing coordinates for ${title}`);
      continue;
    }

    const image = cleanText(seed.heroImageUrl) || cleanText(page.original?.source) || null;
    const categories = Array.isArray(page.categories)
      ? page.categories.map((entry: any) => cleanText(String(entry?.title ?? "").replace(/^Kategorie:/, ""))).filter(Boolean)
      : [];
    const tags = Array.from(new Set([...(seed.tags ?? []), ...categories.slice(0, 8).map((entry) => entry.toLowerCase().replace(/\s+/g, "-"))]));
    const sightCategory = fallbackCategory(seed, `${description} ${extract}`, categories);
    const fullDescription = [seed.customDescription, description, extract].filter(Boolean).join(". ");
    const rating = rateSightseeing({
      name: title,
      type: "SEHENSWUERDIGKEIT",
      description: fullDescription,
      category: sightCategory,
      tags,
      source: "Wikipedia",
      region: "Prüm / Eifel",
      country: "Germany",
    });

    const data: any = {
      name: title,
      type: "SEHENSWUERDIGKEIT",
      lat,
      lng,
      heroImageUrl: image,
      sightSource: "wikipedia-nearby",
      sightExternalId: `dewiki:${seed.pageId}`,
      sightCategory,
      sightDescription: fullDescription,
      sightTags: tags,
      sightRegion: "Prüm / Eifel",
      sightCountry: "Germany",
      wikipediaTitle: title,
      wikipediaUrl: toWikiUrl(title),
      canonicalSource: "wikipedia",
      canonicalSourceId: `dewiki:${seed.pageId}`,
      coordinateSource: "wikipedia-geosearch",
      coordinateConfidence: 0.78,
      coordinateMode: "POINT",
      poiReviewState: "MANUAL_REVIEW",
      poiReviewReason: "curated import near Waldcamping Prüm",
      ...rating,
    };

    const existing = await prisma.place.findFirst({
      where: {
        type: "SEHENSWUERDIGKEIT",
        OR: [{ sightExternalId: `dewiki:${seed.pageId}` }, { name: title }],
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.place.update({
        where: { id: existing.id },
        data,
      });
      createdOrUpdated.push({ id: existing.id, name: title, action: "updated" });
      continue;
    }

    const created = await prisma.place.create({
      data,
      select: { id: true },
    });
    createdOrUpdated.push({ id: created.id, name: title, action: "created" });
  }

  console.log(JSON.stringify({ count: createdOrUpdated.length, results: createdOrUpdated }, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
