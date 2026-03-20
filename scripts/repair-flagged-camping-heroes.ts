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

const FLAGGED_IDS = [1509, 1512, 1515, 1516, 1518, 1520, 1522, 1523, 1524, 1525, 1526, 1527];
const OUT_DIR = path.resolve(process.cwd(), "data/review/hero-audit-2026-03-17/repair");

type ManualOverride = {
  source: string;
  url: string;
  thumbUrl?: string | null;
  score: number;
  reason: string;
};

const MANUAL_OVERRIDES: Record<number, ManualOverride> = {
  1515: {
    source: "manual",
    url: "https://cdn.prod.v2.camping.info/media/campsites/waldcamping-erzgebirge/1TJh5fTfcB9r.jpg",
    score: 84,
    reason: "Manual hero override from camping.info aerial image for 'Waldcamping Erzgebirge'.",
  },
  1516: {
    source: "manual",
    url: "https://klostercamping-thale.de/assets/images/content/Headerbild_Zeltplatz.jpg",
    score: 90,
    reason: "Manual hero override from the official Klostercamping Thale header image.",
  },
  1522: {
    source: "manual",
    url: "https://fotos.verwaltungsportal.de/menuAdministration/1/4/5/5/2/6/gross/Anglerwiese.jpg",
    score: 92,
    reason: "Manual hero override from the official Campingpark Gedern slider image 'Zelten direkt am Wasser'.",
  },
  1523: {
    source: "manual",
    url: "https://www.campingplatz-werratal.de/images/DSC05467.jpg",
    score: 80,
    reason: "Manual hero override from the official Campingplatz Werratal gallery with visible tent and camping area.",
  },
  1525: {
    source: "manual",
    url: "https://www.lindelgrund.de/images/camping/Lindelgrund-12-k.jpg",
    score: 85,
    reason: "Manual hero override from the official Campingpark Lindelgrund camping gallery.",
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
    "User-Agent": "camping-portal-hero-repair/1.0",
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
    1509: 1,
    1512: 0,
    1515: 0,
    1516: 0,
    1518: 0,
    1520: 0,
    1522: 0,
    1523: 0,
    1524: 0,
    1525: 0,
    1526: 0,
    1527: 1,
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
        heroReason: `Hero repair 2026-03-17: selected ${chosen.source} candidate. ${chosen.reason}`,
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
