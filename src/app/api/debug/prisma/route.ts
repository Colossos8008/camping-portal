import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

function maskUrl(raw?: string | null) {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const username = u.username ? `${u.username.slice(0, 2)}***` : "";
    const password = u.password ? `:***` : "";
    const auth = username ? `${username}${password}@` : "";
    return `${u.protocol}//${auth}${u.hostname}${u.port ? `:${u.port}` : ""}${u.pathname}`;
  } catch {
    return "invalid-url";
  }
}

export async function GET() {
  const databaseUrl = process.env.DATABASE_URL ?? null;

  try {
    // 1) Simple connectivity test
    const select1 = await prisma.$queryRaw<{ ok: number }[]>`SELECT 1 as ok`;

    // 2) Identify db, user, schema, version
    const dbInfo = await prisma.$queryRaw<
      {
        current_database: string;
        current_user: string;
        current_schema: string;
        server_version: string;
      }[]
    >`SELECT
        current_database() as current_database,
        current_user as current_user,
        current_schema() as current_schema,
        version() as server_version
      `;

    // 3) List public tables
    const tables = await prisma.$queryRaw<{ table_name: string }[]>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;

    // 4) Prisma internal
    const prismaClientVersion = (prisma as any)?._clientVersion ?? null;

    return NextResponse.json(
      {
        ok: true,
        prismaClientVersion,
        nodeEnv: process.env.NODE_ENV ?? null,
        databaseUrlMasked: maskUrl(databaseUrl),
        select1: select1?.[0]?.ok ?? null,
        dbInfo: dbInfo?.[0] ?? null,
        publicTables: tables.map((t) => t.table_name),
      },
      { status: 200 }
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        prismaClientVersion: (prisma as any)?._clientVersion ?? null,
        nodeEnv: process.env.NODE_ENV ?? null,
        databaseUrlMasked: maskUrl(databaseUrl),
        errorName: err?.name ?? null,
        errorMessage: err?.message ?? String(err),
        errorCode: err?.code ?? null,
        errorMeta: err?.meta ?? null,
        errorStack: err?.stack ?? null,
      },
      { status: 500 }
    );
  }
}
