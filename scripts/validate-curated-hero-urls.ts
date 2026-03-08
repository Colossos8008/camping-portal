import { getCuratedPresetCandidates } from "../src/lib/curated-sightseeing-presets.ts";
import { validateHeroUrl } from "../src/lib/hero-url-validation.ts";

type Result = {
  key: string;
  name: string;
  url: string;
  ok: boolean;
  status: number | null;
  contentType: string | null;
  finalUrl: string | null;
  error?: string;
};

async function validateUrl(key: string, name: string, url: string): Promise<Result> {
  const validation = await validateHeroUrl(url);
  return {
    key,
    name,
    url,
    ok: validation.ok,
    status: validation.status,
    contentType: validation.contentType,
    finalUrl: validation.finalUrl,
    error: validation.error,
  };
}

async function main() {
  const presetArg = process.argv.find((arg) => arg.startsWith("--preset="));
  const preset = presetArg?.split("=", 2)[1] || "nievern-highlights";
  const candidates = getCuratedPresetCandidates(preset).filter((entry) => typeof entry.heroImageUrl === "string" && entry.heroImageUrl.trim().length > 0);

  const results: Result[] = [];
  for (const entry of candidates) {
    const key = entry.sourceId.split(":").at(-1) ?? entry.sourceId;
    results.push(await validateUrl(key, entry.name, String(entry.heroImageUrl).trim()));
  }

  for (const result of results) {
    const marker = result.ok ? "ok" : "failed";
    const status = result.status ?? "-";
    const type = result.contentType ?? "-";
    const finalUrl = result.finalUrl ?? "-";
    const extra = result.error ? ` error=${result.error}` : "";
    console.log(`${marker}\t${result.key}\tstatus=${status}\tcontent-type=${type}\turl=${result.url}\tfinal=${finalUrl}${extra}`);
  }

  const failed = results.filter((item) => !item.ok);
  const networkErrors = failed.filter((item) => item.error && item.status === null);
  console.log(`\nsummary: total=${results.length} ok=${results.length - failed.length} failed=${failed.length}`);
  if (networkErrors.length > 0) {
    console.log(`note: ${networkErrors.length} failed requests had network/transport errors before receiving an HTTP status.`);
  }

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();
