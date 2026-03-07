import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildSightseeingAutofillUpdate } from "@/lib/sightseeing-autofill";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

function parsePositiveInt(value: unknown): number | undefined {
  const raw = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return undefined;
  return parsed;
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1 ? true : value === 0 ? false : undefined;
  if (typeof value !== "string") return undefined;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function parseType(value: unknown): PlaceType | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  if (normalized === "SEHENSWUERDIGKEIT" || normalized === "CAMPINGPLATZ" || normalized === "STELLPLATZ" || normalized === "HVO_TANKSTELLE") {
    return normalized as PlaceType;
  }
  return undefined;
}

function parseIds(value: unknown): number[] | undefined {
  const candidates: unknown[] =
    typeof value === "string"
      ? value
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : Array.isArray(value)
      ? value
      : [];

  const parsed = candidates
    .map((x) => parsePositiveInt(x))
    .filter((x): x is number => typeof x === "number" && x > 0)
    .map((x) => Math.floor(x));

  if (!parsed.length) return undefined;
  return Array.from(new Set(parsed));
}

function parseBody(raw: unknown): {
  limit?: number;
  offset?: number;
  cursor?: number;
  ids?: number[];
  type?: PlaceType;
  dryRun?: boolean;
  force?: boolean;
} {
  const body = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    limit: parsePositiveInt(body.limit),
    offset: parsePositiveInt(body.offset),
    cursor: parsePositiveInt(body.cursor),
    ids: parseIds(body.ids),
    type: parseType(body.type),
    dryRun: parseBoolean(body.dryRun),
    force: parseBoolean(body.force),
  };
}

function parseQuery(searchParams: URLSearchParams): {
  limit?: number;
  offset?: number;
  cursor?: number;
  ids?: number[];
  type?: PlaceType;
  dryRun?: boolean;
  force?: boolean;
} {
  const getQueryValue = (key: string): string | null => {
    const direct = searchParams.get(key);
    if (direct != null) return direct;

    const loweredKey = key.toLowerCase();
    for (const [entryKey, entryValue] of searchParams.entries()) {
      if (entryKey.toLowerCase() === loweredKey) return entryValue;
    }
    return null;
  };

  return {
    limit: parsePositiveInt(getQueryValue("limit")),
    offset: parsePositiveInt(getQueryValue("offset")),
    cursor: parsePositiveInt(getQueryValue("cursor")),
    ids: parseIds(getQueryValue("ids")),
    type: parseType(getQueryValue("type")),
    dryRun: parseBoolean(getQueryValue("dryRun")),
    force: parseBoolean(getQueryValue("force")),
  };
}

export async function POST(req: Request) {
  try {
    const body = parseBody(await req.json().catch(() => ({})));
    const query = parseQuery(new URL(req.url).searchParams);

    const parsed = {
      limit: Math.min(500, Math.max(1, query.limit ?? body.limit ?? 100)),
      offset: Math.max(0, query.offset ?? body.offset ?? 0),
      cursor: query.cursor ?? body.cursor,
      ids: query.ids ?? body.ids,
      type: query.type ?? body.type,
      dryRun: query.dryRun ?? body.dryRun ?? false,
      force: query.force ?? body.force ?? false,
    };

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
        sightSource: true,
        sightCategory: true,
        sightDescription: true,
        sightTags: true,
        sightRegion: true,
        sightCountry: true,
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
