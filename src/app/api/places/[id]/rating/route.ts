// src/app/api/places/[id]/rating/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type TSValue = "STIMMIG" | "OKAY" | "PASST_NICHT";

function clampPoints(n: unknown) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(14, Math.round(x)));
}

function normTS(v: unknown): TSValue {
  const s = String(v ?? "OKAY").toUpperCase();
  if (s === "STIMMIG") return "STIMMIG";
  if (s === "PASST_NICHT") return "PASST_NICHT";
  return "OKAY";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const placeId = Number(id);
    if (!Number.isFinite(placeId)) return new NextResponse("Bad id", { status: 400 });

    const body = await req.json().catch(() => ({} as any));
    const rd = body?.ratingDetail ?? body ?? {};

    const payload: any = {
      tsUmgebung: normTS(rd.tsUmgebung),
      tsPlatzStruktur: normTS(rd.tsPlatzStruktur),
      tsSanitaer: normTS(rd.tsSanitaer),
      tsBuchung: normTS(rd.tsBuchung),
      tsHilde: normTS(rd.tsHilde),
      tsPreisLeistung: normTS(rd.tsPreisLeistung),
      tsNachklang: normTS(rd.tsNachklang),
      totalPoints: clampPoints(rd.totalPoints),
      note: String(rd.note ?? ""),
      cUmgebung: String(rd.cUmgebung ?? ""),
      cPlatzStruktur: String(rd.cPlatzStruktur ?? ""),
      cSanitaer: String(rd.cSanitaer ?? ""),
      cBuchung: String(rd.cBuchung ?? ""),
      cHilde: String(rd.cHilde ?? ""),
      cPreisLeistung: String(rd.cPreisLeistung ?? ""),
      cNachklang: String(rd.cNachklang ?? ""),
    };

    const updated = await prisma.place.update({
      where: { id: placeId },
      data: {
        ratingDetail: {
          upsert: {
            create: payload,
            update: payload,
          },
        },
      },
      include: { ratingDetail: true },
    });

    return NextResponse.json(updated.ratingDetail);
  } catch (e: any) {
    return new NextResponse(e?.message || "Rating update failed", { status: 500 });
  }
}
