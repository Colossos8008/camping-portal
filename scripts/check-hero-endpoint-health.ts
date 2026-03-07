import { prisma } from "../src/lib/prisma";

async function main() {
  const baseUrl = String(process.env.HERO_CHECK_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  const limit = Math.max(1, Number(process.env.HERO_CHECK_LIMIT ?? 50) || 50);

  const places = await prisma.place.findMany({
    where: {
      type: "SEHENSWUERDIGKEIT",
      heroImageUrl: { not: null },
    },
    select: { id: true, name: true, heroImageUrl: true },
    orderBy: { id: "asc" },
    take: limit,
  });

  if (!places.length) {
    console.log("No sightseeing places with heroImageUrl found.");
    return;
  }

  let okCount = 0;
  let failCount = 0;

  for (const place of places) {
    const url = `${baseUrl}/api/places/${place.id}/hero`;
    try {
      const res = await fetch(url, { method: "GET", redirect: "follow" });
      const type = String(res.headers.get("content-type") ?? "").toLowerCase();
      const ok = res.ok && type.startsWith("image/");
      if (ok) {
        okCount += 1;
        console.log(`OK   ${place.id}\t${place.name}\t${res.status}\t${type}`);
      } else {
        failCount += 1;
        console.log(`FAIL ${place.id}\t${place.name}\t${res.status}\t${type || "-"}`);
      }
    } catch (err: any) {
      failCount += 1;
      console.log(`FAIL ${place.id}\t${place.name}\terror=${err?.message ?? "request failed"}`);
    }
  }

  console.log(`\nSummary: ok=${okCount} fail=${failCount} total=${places.length}`);
  if (failCount > 0) process.exitCode = 2;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
