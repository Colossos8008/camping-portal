import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

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

async function runRepair(): Promise<RepairRunResult> {
  const cwd = process.cwd();
  const scriptPath = path.join(cwd, "scripts", "ensure-sightseeing-quality.ts");
  const startedAt = Date.now();

  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--experimental-strip-types", "--experimental-specifier-resolution=node", scriptPath],
      {
        cwd,
        env: process.env,
        stdio: ["ignore", "pipe", "pipe"],
      }
    );

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (exitCode, signal) => {
      resolve({
        ok: exitCode === 0,
        exitCode,
        signal,
        durationMs: Date.now() - startedAt,
        stdoutTail: tail(stdout),
        stderrTail: tail(stderr),
      });
    });
  });
}

export async function POST() {
  try {
    const result = await runRepair();

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
