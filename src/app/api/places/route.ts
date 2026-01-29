import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type TSValue = "STIMMIG" | "OKAY" | "PASST_NICHT";
type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT";

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
  if (v === "STELLPLATZ" || v === "CAMPINGPLATZ" || v === "SEHENSWUERDIGKEIT") return v;
  return "CAMPINGPLATZ";
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

export async function GET() {
  const places = await prisma.place.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      ratingDetail: true,
      images: true,
    },
  });

  return NextResponse.json({ places });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const name = asString(body?.name).trim();
  if (!name) return NextResponse.json({ error: "Name fehlt" }, { status: 400 });

  const type = normalizePlaceType(body?.type);

  const lat = Number(body?.lat);
  const lng = Number(body?.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "Koordinaten ungültig", lat: body?.lat, lng: body?.lng }, { status: 400 });
  }

  const rd = normalizeRatingDetail(body?.ratingDetail);

  const created = await prisma.place.create({
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
      ratingDetail: { create: { ...rd } },
    },
    include: { ratingDetail: true, images: true },
  });

  return NextResponse.json(created);
}
