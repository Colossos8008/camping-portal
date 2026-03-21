import { prisma } from "../src/lib/prisma.ts";
import { generateSightseeingQualityReport, runSightseeingQualityRepair } from "../src/lib/sightseeing-quality.ts";

async function main(): Promise<void> {
  const baseUrl = String(process.env.SIGHTSEEING_QUALITY_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");

  const before = await generateSightseeingQualityReport(baseUrl);
  console.log(`Before repair: total=${before.total} failed=${before.failed}`);
  if (before.failures.length > 0) {
    console.log(JSON.stringify(before.failures, null, 2));
  }

  const after = await runSightseeingQualityRepair(baseUrl);
  console.log(`After repair: total=${after.total} failed=${after.failed}`);
  if (after.failures.length > 0) {
    console.error(JSON.stringify(after.failures, null, 2));
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
