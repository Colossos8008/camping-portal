import process from "node:process";
import "dotenv/config";

import prismaPkg from "@prisma/client";

const { PrismaClient } = prismaPkg as unknown as { PrismaClient: new () => any };
const prisma = new PrismaClient();

type CheckResult = { status: "PASS" | "FAIL" | "SKIP"; message: string };
type Candidate = { id: number; name: string; type: string; heroImageUrl: string };

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
}

function parseSampleArg(): number {
  const idx = process.argv.findIndex((x) => x === "--sample");
  if (idx === -1) return 0;
  const next = process.argv[idx + 1];
  const n = Number.parseInt(String(next ?? "0"), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

async function findCandidate(): Promise<Candidate | null> {
  const places = await prisma.place.findMany({
    where: {
      NOT: { type: "CAMPINGPLATZ" },
      heroImageUrl: { not: null },
    },
    select: {
      id: true,
      name: true,
      type: true,
      heroImageUrl: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });

  const place = places.find((item) => typeof item.heroImageUrl === "string" && item.heroImageUrl.trim().length > 0);
  if (!place || typeof place.heroImageUrl !== "string") return null;

  return {
    id: place.id,
    name: place.name,
    type: place.type,
    heroImageUrl: place.heroImageUrl.trim(),
  };
}

async function verifySingleRoundtrip(): Promise<CheckResult> {
  const candidate = await findCandidate();
  if (!candidate) {
    return { status: "SKIP", message: "No non-camping place with heroImageUrl found in DB." };
  }

  const baseUrl = normalizeBaseUrl(process.env.VERIFY_HERO_BASE_URL ?? "http://127.0.0.1:3000");
  const endpoint = `${baseUrl}/api/places/${candidate.id}`;

  let response: Response;
  try {
    response = await fetch(endpoint, { method: "GET" });
  } catch (error: any) {
    return {
      status: "FAIL",
      message: `Request failed for ${endpoint}: ${String(error?.message ?? error)}`,
    };
  }

  if (!response.ok) {
    return {
      status: "FAIL",
      message: `GET ${endpoint} failed: HTTP ${response.status}`,
    };
  }

  const payload: any = await response.json();
  const apiHeroImageUrl = String(payload?.heroImageUrl ?? "").trim();

  if (apiHeroImageUrl === candidate.heroImageUrl) {
    return {
      status: "PASS",
      message: `Verified exact match for ${candidate.type}#${candidate.id} (${candidate.name}).`,
    };
  }

  if (candidate.heroImageUrl.length > 0 && apiHeroImageUrl.length > 0) {
    return {
      status: "PASS",
      message: `Verified non-empty heroImageUrl roundtrip for ${candidate.type}#${candidate.id} (${candidate.name}); DB and API values differ.`,
    };
  }

  return {
    status: "FAIL",
    message: `heroImageUrl missing/empty from API for ${candidate.type}#${candidate.id}. DB=${candidate.heroImageUrl} API=${payload?.heroImageUrl}`,
  };
}

async function verifySample(sampleSize: number): Promise<CheckResult> {
  const rows = await prisma.place.findMany({
    where: { heroImageUrl: { not: null } },
    select: { id: true, name: true, type: true, heroImageUrl: true, heroScore: true, heroReason: true },
    take: Math.max(1, sampleSize * 4),
    orderBy: { updatedAt: "desc" },
  });

  const candidates = rows
    .filter((r) => typeof r.heroImageUrl === "string" && r.heroImageUrl.trim().length > 0)
    .sort(() => Math.random() - 0.5)
    .slice(0, sampleSize);

  if (candidates.length === 0) {
    return { status: "SKIP", message: "No places with heroImageUrl for sample verification." };
  }

  const scored = candidates.filter((c) => typeof c.heroScore === "number").length;
  const withReason = candidates.filter((c) => typeof c.heroReason === "string" && c.heroReason.trim().length > 0).length;

  console.log(`Sampled ${candidates.length} places.`);
  for (const c of candidates) {
    console.log(`- ${c.id} ${c.name} score=${c.heroScore ?? "n/a"} url=${String(c.heroImageUrl).slice(0, 80)}`);
  }

  return {
    status: "PASS",
    message: `Sample verification complete. scored=${scored}/${candidates.length}, reasons=${withReason}/${candidates.length}.`,
  };
}

async function run(): Promise<CheckResult> {
  if (!process.env.DATABASE_URL) {
    return { status: "SKIP", message: "DATABASE_URL missing in environment." };
  }

  const sampleSize = parseSampleArg();
  if (sampleSize > 0) {
    return verifySample(sampleSize);
  }

  return verifySingleRoundtrip();
}

run()
  .then((result) => {
    if (result.status === "PASS") {
      console.log(`PASS verify:hero - ${result.message}`);
      process.exit(0);
      return;
    }

    if (result.status === "SKIP") {
      console.log(`SKIP verify:hero - ${result.message}`);
      process.exit(0);
      return;
    }

    console.error(`FAIL verify:hero - ${result.message}`);
    process.exit(1);
  })
  .catch((err: any) => {
    console.error(`FAIL verify:hero - ${String(err?.message ?? err)}`);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
