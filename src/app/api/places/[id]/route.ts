import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type TSValue = "STIMMIG" | "OKAY" | "PASST_NICHT";
type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";
type TSHaltung = "DNA" | "EXPLORER";

type RatingDetail = {
  tsUmgebung: TSValue;
  tsPlatzStruktur: TSValue;
  tsSanitaer: TSValue;
  tsBuchung: TSValue;
  tsHilde: TSValue;
  tsPreisLeistung: TSValue;
  tsNachklang: TSValue;
  totalPoints: number;
  note: string;
  cUmgebung: string;
  cPlatzStruktur: string;
  cSanitaer: string;
  cBuchung: string;
  cHilde: string;
  cPreisLeistung: string;
  cNachklang: string;
};

type TS2Detail = {
  haltung: TSHaltung;
  note: string;
};

const TS_DEFAULT: TSValue = "OKAY";

function blankRating(): RatingDetail {
  return {
    tsUmgebung: TS_DEFAULT,
    tsPlatzStruktur: TS_DEFAULT,
    tsSanitaer: TS_DEFAULT,
    tsBuchung: TS_DEFAULT,
    tsHilde: TS_DEFAULT,
    tsPreisLeistung: TS_DEFAULT,
    tsNachklang: TS_DEFAULT,
    totalPoints: 7,
    note: "",
    cUmgebung: "",
    cPlatzStruktur: "",
    cSanitaer: "",
    cBuchung: "",
    cHilde: "",
    cPreisLeistung: "",
    cNachklang: "",
  };
}

function blankTS2(): TS2Detail {
  return {
    haltung: "DNA",
    note: "",
  };
}

function asTSValue(v: any): TSValue {
  if (v === "STIMMIG" || v === "OKAY" || v === "PASST_NICHT") return v;
  return TS_DEFAULT;
}

function asString(v: any): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

function normalizePlaceType(v: any): PlaceType {
  if (v === "STELLPLATZ") return "STELLPLATZ";
  if (v === "CAMPINGPLATZ") return "CAMPINGPLATZ";
  if (v === "SEHENSWUERDIGKEIT") return "SEHENSWUERDIGKEIT";
  if (v === "HVO_TANKSTELLE") return "HVO_TANKSTELLE";
  return "CAMPINGPLATZ";
}

function normalizeTSHaltung(v: any): TSHaltung {
  if (v === "EXPLORER") return "EXPLORER";
  return "DNA";
}

function extractRatingDetail(input: any): any {
  if (!input) return null;

  if (input?.upsert?.update) return input.upsert.update;
  if (input?.upsert?.create) return input.upsert.create;

  if (input?.update) return input.update;
  if (input?.create) return input.create;

  return input;
}

function normalizeRatingDetail(input: any): RatingDetail {
  const b = blankRating();
  const src = extractRatingDetail(input) ?? {};

  const total = Number(src.totalPoints);
  const totalPoints = Number.isFinite(total) ? total : b.totalPoints;

  return {
    tsUmgebung: asTSValue(src.tsUmgebung),
    tsPlatzStruktur: asTSValue(src.tsPlatzStruktur),
    tsSanitaer: asTSValue(src.tsSanitaer),
    tsBuchung: asTSValue(src.tsBuchung),
    tsHilde: asTSValue(src.tsHilde),
    tsPreisLeistung: asTSValue(src.tsPreisLeistung),
    tsNachklang: asTSValue(src.tsNachklang),
    totalPoints,
    note: asString(src.note),
    cUmgebung: asString(src.cUmgebung),
    cPlatzStruktur: asString(src.cPlatzStruktur),
    cSanitaer: asString(src.cSanitaer),
    cBuchung: asString(src.cBuchung),
    cHilde: asString(src.cHilde),
    cPreisLeistung: asString(src.cPreisLeistung),
    cNachklang: asString(src.cNachklang),
  };
}

function normalizeTS2Detail(input: any): TS2Detail {
  const b = blankTS2();
  const src = extractRatingDetail(input) ?? {};
  return {
    haltung: normalizeTSHaltung(src.haltung),
    note: asString(src.note),
  };
}

function getIdFromPath(req: NextRequest): number {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const last = parts[parts.length - 1] ?? "";
  return Number(last);
}

export async function PATCH(req: NextRequest) {
  try {
    const id = getIdFromPath(req);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const name = asString(body?.name).trim();
    const type = normalizePlaceType(body?.type);

    const lat = Number(body?.lat);
    const lng = Number(body?.lng);

    if (!name) {
      return NextResponse.json({ error: "Name fehlt" }, { status: 400 });
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return NextResponse.json(
        { error: "Koordinaten ungültig", lat: body?.lat, lng: body?.lng },
        { status: 400 }
      );
    }

    const rd = normalizeRatingDetail(body?.ratingDetail);

    // TS 2.0 - nur für Campingplatz und Stellplatz - additiv
    const shouldHaveTS2 = type === "CAMPINGPLATZ" || type === "STELLPLATZ";
    const ts2 = shouldHaveTS2 ? normalizeTS2Detail(body?.ts2) : null;

    const updated = await prisma.place.update({
      where: { id },
      data: {
        name,
        type,
        lat,
        lng,
        dogAllowed: !!body?.dogAllowed,
        sanitary: !!body?.sanitary,
        yearRound: !!body?.yearRound,
        onlineBooking: !!body?.onlineBooking,
        gastronomy: !!body?.gastronomy,
        ratingDetail: {
          upsert: {
            create: { ...rd },
            update: { ...rd },
          },
        },
        ...(shouldHaveTS2
          ? {
              ts2: {
                upsert: {
                  create: { ...ts2! },
                  update: { ...ts2! },
                },
              },
            }
          : {}),
      },
      include: { ratingDetail: true, ts2: true, images: true },
    });

    return NextResponse.json(updated);
  } catch (e: any) {
    const msg = typeof e?.message === "string" ? e.message : "PATCH failed";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}

export async function DELETE(req: NextRequest) {
  const id = getIdFromPath(req);
  if (!Number.isFinite(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  await prisma.place.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
