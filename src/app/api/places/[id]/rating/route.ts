import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { TSValue } from "@prisma/client";

function clampPoints(n: unknown) {
  const x = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(x)) return 1;
  if (x < 0) return 0;
  if (x > 2) return 2;
  return x;
}

function calcTotal(p: {
  pUmgebung: number;
  pPlatzStruktur: number;
  pSanitaer: number;
  pBuchung: number;
  pHilde: number;
  pPreisLeistung: number;
  pNachklang: number;
}) {
  return (
    p.pUmgebung +
    p.pPlatzStruktur +
    p.pSanitaer +
    p.pBuchung +
    p.pHilde +
    p.pPreisLeistung +
    p.pNachklang
  );
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const placeId = Number(id);
    if (!Number.isFinite(placeId)) {
      return NextResponse.json({ ok: false, error: "invalid id" }, { status: 400 });
    }

    const body = (await req.json()) as Partial<{
      tsUmgebung: TSValue;
      tsPlatzStruktur: TSValue;
      tsSanitaer: TSValue;
      tsBuchung: TSValue;
      tsHilde: TSValue;
      tsPreisLeistung: TSValue;
      tsNachklang: TSValue;

      pUmgebung: number;
      pPlatzStruktur: number;
      pSanitaer: number;
      pBuchung: number;
      pHilde: number;
      pPreisLeistung: number;
      pNachklang: number;

      note: string | null;
    }>;

    // Defaults - falls Rating neu angelegt wird
    const defaults = {
      tsUmgebung: TSValue.OKAY,
      tsPlatzStruktur: TSValue.OKAY,
      tsSanitaer: TSValue.OKAY,
      tsBuchung: TSValue.OKAY,
      tsHilde: TSValue.OKAY,
      tsPreisLeistung: TSValue.OKAY,
      tsNachklang: TSValue.OKAY,

      pUmgebung: 1,
      pPlatzStruktur: 1,
      pSanitaer: 1,
      pBuchung: 1,
      pHilde: 1,
      pPreisLeistung: 1,
      pNachklang: 1,

      note: null as string | null,
    };

    const next = {
      tsUmgebung: body.tsUmgebung ?? defaults.tsUmgebung,
      tsPlatzStruktur: body.tsPlatzStruktur ?? defaults.tsPlatzStruktur,
      tsSanitaer: body.tsSanitaer ?? defaults.tsSanitaer,
      tsBuchung: body.tsBuchung ?? defaults.tsBuchung,
      tsHilde: body.tsHilde ?? defaults.tsHilde,
      tsPreisLeistung: body.tsPreisLeistung ?? defaults.tsPreisLeistung,
      tsNachklang: body.tsNachklang ?? defaults.tsNachklang,

      pUmgebung: clampPoints(body.pUmgebung ?? defaults.pUmgebung),
      pPlatzStruktur: clampPoints(body.pPlatzStruktur ?? defaults.pPlatzStruktur),
      pSanitaer: clampPoints(body.pSanitaer ?? defaults.pSanitaer),
      pBuchung: clampPoints(body.pBuchung ?? defaults.pBuchung),
      pHilde: clampPoints(body.pHilde ?? defaults.pHilde),
      pPreisLeistung: clampPoints(body.pPreisLeistung ?? defaults.pPreisLeistung),
      pNachklang: clampPoints(body.pNachklang ?? defaults.pNachklang),

      note: body.note ?? defaults.note,
    };

    const totalPoints = calcTotal(next);

    const saved = await prisma.placeRating.upsert({
      where: { placeId },
      create: {
        placeId,
        ...next,
        totalPoints,
      },
      update: {
        ...next,
        totalPoints,
      },
    });

    return NextResponse.json({ ok: true, rating: saved });
  } catch (e: any) {
    console.error("PATCH /api/places/[id]/rating failed:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "unknown error" }, { status: 500 });
  }
}
