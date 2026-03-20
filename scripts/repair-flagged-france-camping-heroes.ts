import "dotenv/config";

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { prisma } from "../src/lib/prisma.ts";
import { discoverHeroCandidates, type HeroCandidateRecord } from "../src/lib/hero-candidates.ts";

type PlaceRow = {
  id: number;
  name: string;
  type: "CAMPINGPLATZ";
  lat: number;
  lng: number;
  heroImageUrl: string | null;
  heroScore: number | null;
};

const FLAGGED_IDS = [1531, 1532, 1533, 1536, 1537, 1538, 1539, 1540, 1542, 1545, 1547, 1549, 1551];
const OUT_DIR = path.resolve(process.cwd(), "data/review/france-hero-audit-2026-03-17/repair");

type ManualOverride = {
  source: string;
  url: string;
  thumbUrl?: string | null;
  score: number;
  reason: string;
};

const MANUAL_OVERRIDES: Record<number, ManualOverride> = {
  1533: {
    source: "manual",
    url: "https://www.camping-laveniseverte.fr/images/raccourci/Emplacements_camping_la_venise_verte_coulon_marais_poitevin.jpg",
    score: 95,
    reason: "Manual hero override from the official La Venise Verte emplacement image.",
  },
  1536: {
    source: "manual",
    url: "https://www.ardechois-camping.com/wp-content/uploads/2025/03/05.jpg",
    score: 96,
    reason: "Manual hero override from the official Ardechois river landscape image.",
  },
  1545: {
    source: "manual",
    url: "https://www.laviste.fr/wp-content/uploads/2021/06/panorama-camping-laviste-05-scaled.jpg",
    score: 94,
    reason: "Manual hero override from the official La Viste panorama image.",
  },
};

function escapeSvg(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function titleSvg(lines: string[], width: number, height: number) {
  const text = lines
    .map(
      (line, index) =>
        `<text x="14" y="${28 + index * 22}" font-family="Arial, sans-serif" font-size="${index === 0 ? 20 : 16}" font-weight="${
          index === 0 ? 700 : 400
        }" fill="#111">${escapeSvg(line)}</text>`
    )
    .join("");
  return Buffer.from(
    `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#f6f1e7"/>${text}</svg>`
  );
}

async function fetchBuffer(url: string, googleKey: string): Promise<Buffer> {
  const headers: Record<string, string> = {
    "User-Agent": "camping-portal-france-hero-repair/1.0",
  };
  if (url.includes("places.googleapis.com")) {
    headers["X-Goog-Api-Key"] = googleKey;
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function buildBoard(place: PlaceRow, candidates: HeroCandidateRecord[], googleKey: string) {
  const width = 1260;
  const cols = 3;
  const cardW = 420;
  const titleH = 72;
  const imageH = 220;
  const cardH = titleH + imageH + 20;
  const rows = Math.ceil(candidates.length / cols);
  const canvas = sharp({
    create: {
      width,
      height: Math.max(1, rows) * cardH,
      channels: 3,
      background: { r: 246, g: 241, b: 231 },
    },
  });

  const composites: sharp.OverlayOptions[] = [];

  for (const [index, candidate] of candidates.entries()) {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const left = col * cardW;
    const top = row * cardH;

    const title = await sharp(
      titleSvg(
        [
          `#${index + 1} ${place.name}`,
          `${candidate.source} score=${candidate.score} rank=${candidate.rank ?? 0}`,
          `${candidate.reason}`.slice(0, 72),
        ],
        cardW,
        titleH
      )
    )
      .png()
      .toBuffer();

    composites.push({ input: title, left, top });

    try {
      const buffer = await fetchBuffer(String(candidate.thumbUrl ?? candidate.url), googleKey);
      const image = await sharp(buffer).resize({ width: cardW - 20, height: imageH, fit: "cover", position: "attention" }).jpeg().toBuffer();
      composites.push({ input: image, left: left + 10, top: top + titleH });
    } catch {
      const fallback = await sharp(titleSvg([`Bild konnte nicht geladen werden`], cardW - 20, imageH)).png().toBuffer();
      composites.push({ input: fallback, left: left + 10, top: top + titleH });
    }
  }

  const outputPath = path.join(OUT_DIR, `${String(place.id)}-${place.name.replace(/[^a-z0-9]+/gi, "_")}-board.jpg`);
  await canvas.composite(composites).jpeg({ quality: 90 }).toFile(outputPath);
  return outputPath;
}

function pickCandidate(placeId: number, candidates: HeroCandidateRecord[]): HeroCandidateRecord | null {
  const choices: Record<number, number> = {
    1531: 0,
    1532: 0,
    1533: 0,
    1536: 0,
    1537: 0,
    1538: 0,
    1539: 0,
    1540: 1,
    1542: 0,
    1545: 0,
    1547: 0,
    1549: 1,
    1551: 0,
  };

  const chosenIndex = choices[placeId];
  return typeof chosenIndex === "number" ? candidates[chosenIndex] ?? null : candidates[0] ?? null;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const googleKey = String(process.env.GOOGLE_PLACES_API_KEY ?? process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  if (!googleKey) throw new Error("Missing Google Places key");

  const places = (await prisma.place.findMany({
    where: { id: { in: FLAGGED_IDS } },
    select: {
      id: true,
      name: true,
      type: true,
      lat: true,
      lng: true,
      heroImageUrl: true,
      heroScore: true,
    },
    orderBy: { id: "asc" },
  })) as PlaceRow[];

  const summary: Array<Record<string, unknown>> = [];

  for (const place of places) {
    const candidates = await discoverHeroCandidates(
      {
        id: place.id,
        name: place.name,
        type: place.type,
        lat: place.lat,
        lng: place.lng,
        heroImageUrl: place.heroImageUrl,
      },
      {
        googleKey,
        limit: 6,
        explorationLevel: 3,
        reloadRound: 1,
      }
    );

    const boardPath = await buildBoard(place, candidates, googleKey);
    const manualOverride = MANUAL_OVERRIDES[place.id];
    const chosen = manualOverride ?? pickCandidate(place.id, candidates);
    if (!chosen) {
      summary.push({ id: place.id, name: place.name, status: "no-candidate", boardPath });
      continue;
    }

    await prisma.place.update({
      where: { id: place.id },
      data: {
        heroImageUrl: chosen.url,
        heroScore: chosen.score,
        heroReason: `France hero repair 2026-03-17: selected ${chosen.source} candidate. ${chosen.reason}`,
        heroCandidates: {
          deleteMany: {},
          create: [
            ...(manualOverride
              ? [
                  {
                    source: manualOverride.source,
                    url: manualOverride.url,
                    thumbUrl: manualOverride.thumbUrl ?? null,
                    width: null,
                    height: null,
                    score: manualOverride.score,
                    reason: manualOverride.reason,
                    rank: 1,
                  },
                ]
              : []),
            ...candidates.map((candidate, index) => ({
              source: candidate.source,
              url: candidate.url,
              thumbUrl: candidate.thumbUrl,
              width: candidate.width,
              height: candidate.height,
              score: candidate.score,
              reason: candidate.reason,
              rank: index + 1 + (manualOverride ? 1 : 0),
            })),
          ],
        },
      },
    });

    summary.push({
      id: place.id,
      name: place.name,
      status: "updated",
      chosenSource: chosen.source,
      chosenScore: chosen.score,
      chosenReason: chosen.reason,
      boardPath,
    });
    console.log(`UPDATED ${place.id} ${place.name} -> ${chosen.source} score=${chosen.score}`);
  }

  fs.writeFileSync(path.join(OUT_DIR, "repair-summary.json"), JSON.stringify(summary, null, 2), "utf8");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
