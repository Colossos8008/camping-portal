import process from "node:process";
import "dotenv/config";

import { prisma } from "../src/lib/prisma.ts";
import { GET } from "../src/app/api/places/[id]/route.ts";

type CheckResult = { ok: boolean; message: string };

type Candidate = { id: number; name: string; type: string; heroImageUrl: string };

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

async function run(): Promise<CheckResult> {
  if (!process.env.DATABASE_URL) {
    return { ok: true, message: "Skipped (DATABASE_URL missing in environment)." };
  }

  const candidate = await findCandidate();
  if (!candidate) {
    return { ok: false, message: "No non-camping place with heroImageUrl found in DB." };
  }

  const response = await GET({} as any, { params: { id: String(candidate.id) } });
  if (!response.ok) {
    return {
      ok: false,
      message: `GET handler for /api/places/${candidate.id} failed: HTTP ${response.status}`,
    };
  }

  const payload: any = await response.json();
  const apiHeroImageUrl = String(payload?.heroImageUrl ?? "").trim();

  if (apiHeroImageUrl !== candidate.heroImageUrl) {
    return {
      ok: false,
      message: `Mismatch: DB=${candidate.heroImageUrl} API=${payload?.heroImageUrl}`,
    };
  }

  return { ok: true, message: `Verified ${candidate.type}#${candidate.id} (${candidate.name}).` };
}

run()
  .then((result) => {
    if (result.ok) {
      console.log(`PASS verify:hero - ${result.message}`);
      process.exit(0);
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
