import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildSightseeingAutofillUpdate } from "@/lib/sightseeing-autofill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

function parseBody(raw: unknown): {
  limit: number;
  offset: number;
  cursor?: number;
  ids?: number[];
  type?: PlaceType;
  dryRun: boolean;
  force: boolean;
} {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const limit = typeof body.limit === "number" ? Math.floor(body.limit) : 100;
  const offset = typeof body.offset === "number" ? Math.max(0, Math.floor(body.offset)) : 0;
  const cursorRaw = typeof body.cursor === "number" ? Math.floor(body.cursor) : typeof body.cursor === "string" ? Number.parseInt(body.cursor, 10) : undefined;

  const ids = Array.isArray(body.ids)
    ? body.ids
        .map((x) => Number(x))
        .filter((x) => Number.isFinite(x) && x > 0)
        .map((x) => Math.floor(x))
    : undefined;

  const typeRaw = typeof body.type === "string" ? body.type.trim().toUpperCase() : "";
  const type =
    typeRaw === "SEHENSWUERDIGKEIT" || typeRaw === "CAMPINGPLATZ" || typeRaw === "STELLPLATZ" || typeRaw === "HVO_TANKSTELLE"
      ? (typeRaw as PlaceType)
      : undefined;

  return {
    limit: Math.min(500, Math.max(1, Number.isFinite(limit) ? limit : 100)),
    offset,
    cursor: Number.isFinite(cursorRaw as number) ? (cursorRaw as number) : undefined,
    ids: ids && ids.length > 0 ? Array.from(new Set(ids)) : undefined,
    type,
    dryRun: body.dryRun === true,
    force: body.force === true,
  };
}

export async function POST(req: Request) {
  try {
    const parsed = parseBody(await req.json().catch(() => ({})));

    const where: any = {
      type: parsed.type ?? "SEHENSWUERDIGKEIT",
      ...(parsed.ids ? { id: { in: parsed.ids } } : {}),
    };

    const places = await prisma.place.findMany({
      where,
      orderBy: { id: "asc" },
      ...(parsed.cursor != null ? { cursor: { id: parsed.cursor }, skip: 1 } : { skip: parsed.offset }),
      take: parsed.limit,
      select: {
        id: true,
        name: true,
        type: true,
        heroReason: true,
        ratingDetail: { select: { note: true } },
        natureScore: true,
        architectureScore: true,
        historyScore: true,
        uniquenessScore: true,
        spontaneityScore: true,
        calmScore: true,
        sightseeingTotalScore: true,
        sightRelevanceType: true,
        sightVisitModePrimary: true,
        sightVisitModeSecondary: true,
        crowdRiskScore: true,
        bestVisitHint: true,
        summaryWhyItMatches: true,
      },
    });

    const results: Array<{ id: number; name: string; status: "UPDATED" | "SKIPPED"; reason: string; preview?: any }> = [];

    for (const place of places) {
      const plan = buildSightseeingAutofillUpdate(place as any, parsed.force);
      if (plan.skip || !plan.data) {
        results.push({ id: place.id, name: place.name, status: "SKIPPED", reason: plan.reason ?? "skipped" });
        continue;
      }

      if (!parsed.dryRun) {
        await prisma.place.update({
          where: { id: place.id },
          data: plan.data,
        });
      }

      results.push({
        id: place.id,
        name: place.name,
        status: "UPDATED",
        reason: parsed.dryRun ? "dry-run" : "autofill-applied",
        preview: plan.rating,
      });
    }

    return NextResponse.json({
      ok: true,
      dryRun: parsed.dryRun,
      force: parsed.force,
      count: results.length,
      updated: results.filter((r) => r.status === "UPDATED").length,
      skipped: results.filter((r) => r.status === "SKIPPED").length,
      nextCursor: places.length ? places[places.length - 1].id : null,
      results,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
