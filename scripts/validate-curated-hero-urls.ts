import { getCuratedPresetCandidates } from "../src/lib/curated-sightseeing-presets.ts";

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
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "camping-portal/curated-hero-validator",
      },
    });

    const contentType = response.headers.get("content-type");
    const ok = response.ok && String(contentType ?? "").toLowerCase().startsWith("image/");

    return {
      key,
      name,
      url,
      ok,
      status: response.status,
      contentType,
      finalUrl: response.url,
    };
  } catch (error) {
    return {
      key,
      name,
      url,
      ok: false,
      status: null,
      contentType: null,
      finalUrl: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
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
    const extra = result.error ? ` error=${result.error}` : "";
    console.log(`${marker}\t${result.key}\tstatus=${status}\tcontent-type=${type}\turl=${result.url}${extra}`);
  }

  const failed = results.filter((item) => !item.ok);
  console.log(`\nsummary: total=${results.length} ok=${results.length - failed.length} failed=${failed.length}`);

  if (failed.length > 0) {
    process.exitCode = 1;
  }
}

void main();
