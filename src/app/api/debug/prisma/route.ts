import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

export async function GET() {
  const prismaClientVersion =
    // @ts-ignore
    prisma?._engineConfig?.clientVersion ?? "unknown";

  const enums =
    // @ts-ignore
    prisma?._runtimeDataModel?.enums ?? null;

  return NextResponse.json({
    prismaClientVersion,
    enums,
  });
}
