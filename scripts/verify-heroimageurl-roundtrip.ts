import { spawn } from "node:child_process";
import process from "node:process";
import "dotenv/config";

import { Client } from "pg";

const PORT = Number(process.env.VERIFY_HERO_PORT ?? 4011);
const BASE_URL = `http://127.0.0.1:${PORT}`;

type CheckResult = { ok: boolean; message: string };

type Candidate = { id: number; name: string; type: string; heroImageUrl: string };

async function waitForServer(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  let lastError = "";

  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (res.ok) return;
      lastError = `HTTP ${res.status}`;
    } catch (err: any) {
      lastError = String(err?.message ?? err);
    }

    await new Promise((r) => setTimeout(r, 1000));
  }

  throw new Error(`Server not ready at ${url} within ${timeoutMs}ms (${lastError})`);
}

async function findCandidate(): Promise<Candidate | null> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const result = await client.query(
      `SELECT id, name, type, "heroImageUrl"
       FROM "Place"
       WHERE type <> 'CAMPINGPLATZ' AND "heroImageUrl" IS NOT NULL AND length(trim("heroImageUrl")) > 0
       ORDER BY "updatedAt" DESC
       LIMIT 1`
    );

    if (!result.rows[0]) return null;

    const row = result.rows[0];
    return {
      id: Number(row.id),
      name: String(row.name ?? ""),
      type: String(row.type ?? ""),
      heroImageUrl: String(row.heroImageUrl ?? "").trim(),
    };
  } finally {
    await client.end();
  }
}

async function run(): Promise<CheckResult> {
  if (!process.env.DATABASE_URL) {
    return { ok: true, message: "Skipped (DATABASE_URL missing in environment)." };
  }

  const candidate = await findCandidate();
  if (!candidate?.heroImageUrl) {
    return { ok: false, message: "No non-camping place with heroImageUrl found in DB." };
  }

  const dev = spawn("npm", ["run", "dev", "--", "--port", String(PORT)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let logs = "";
  dev.stdout.on("data", (d) => (logs += d.toString()));
  dev.stderr.on("data", (d) => (logs += d.toString()));

  try {
    await waitForServer(`${BASE_URL}/api/places`, 90_000);

    const byIdRes = await fetch(`${BASE_URL}/api/places/${candidate.id}`, { cache: "no-store" });
    if (!byIdRes.ok) return { ok: false, message: `GET /api/places/${candidate.id} failed: HTTP ${byIdRes.status}` };

    const byIdJson: any = await byIdRes.json();
    if (String(byIdJson?.heroImageUrl ?? "").trim() !== candidate.heroImageUrl) {
      return { ok: false, message: `Mismatch: DB=${candidate.heroImageUrl} API=${byIdJson?.heroImageUrl}` };
    }

    return { ok: true, message: `Verified ${candidate.type}#${candidate.id} (${candidate.name}).` };
  } finally {
    dev.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 500));
    if (!dev.killed) dev.kill("SIGKILL");
    if (logs.trim()) {
      console.log("[verify:hero server log excerpt]");
      console.log(logs.split("\n").slice(-12).join("\n"));
    }
  }
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
  });
