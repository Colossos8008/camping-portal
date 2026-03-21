import { NextResponse } from "next/server";
import { parseQualityPlaceType, runPlaceQualityRepair } from "@/lib/sightseeing-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RepairRunResult = {
  ok: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdoutTail: string;
  stderrTail: string;
};

function tail(value: string, maxChars = 12000): string {
  if (value.length <= maxChars) return value;
  return value.slice(-maxChars);
}

async function runRepair(placeType: string): Promise<RepairRunResult> {
  const startedAt = Date.now();
  const baseUrl = String(process.env.SIGHTSEEING_QUALITY_BASE_URL ?? "").trim();

  try {
    const normalizedType = parseQualityPlaceType(placeType) ?? "SEHENSWUERDIGKEIT";
    const report = await runPlaceQualityRepair(baseUrl, normalizedType);
    const lines = [
      `placeType=${report.placeType}`,
      `checkedAt=${report.checkedAt}`,
      `total=${report.total} passed=${report.passed} failed=${report.failed}`,
      `missingDescription=${report.counts.missingDescription} brokenHero=${report.counts.brokenHero}`,
      report.failures.length > 0 ? JSON.stringify(report.failures, null, 2) : "",
    ].filter(Boolean);

    return {
      ok: true,
      exitCode: 0,
      signal: null,
      durationMs: Date.now() - startedAt,
      stdoutTail: tail(lines.join("\n")),
      stderrTail: "",
    };
  } catch (error: any) {
    return {
      ok: false,
      exitCode: 1,
      signal: null,
      durationMs: Date.now() - startedAt,
      stdoutTail: "",
      stderrTail: tail(error?.stack ?? error?.message ?? String(error)),
    };
  }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const placeType = parseQualityPlaceType(url.searchParams.get("type")) ?? "SEHENSWUERDIGKEIT";
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
      process.env.SIGHTSEEING_QUALITY_BASE_URL?.trim() ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL.trim().replace(/^https?:\/\//, "")}` : "");

    if (!baseUrl) {
      return NextResponse.json(
        {
          ok: false,
          exitCode: 1,
          signal: null,
          durationMs: 0,
          stdoutTail: "",
          stderrTail: "Missing base URL env for sightseeing quality repair (NEXT_PUBLIC_SITE_URL, SIGHTSEEING_QUALITY_BASE_URL, or VERCEL_URL).",
        },
        { status: 500 }
      );
    }

    process.env.SIGHTSEEING_QUALITY_BASE_URL = baseUrl;
    const result = await runRepair(placeType);

    return NextResponse.json(result, {
      status: result.ok ? 200 : 500,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        exitCode: null,
        signal: null,
        durationMs: 0,
        stdoutTail: "",
        stderrTail: error?.message ?? String(error),
      },
      { status: 500 }
    );
  }
}
