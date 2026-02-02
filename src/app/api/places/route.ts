// src/app/api/places/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type TSValue = "STIMMIG" | "OKAY" | "PASST_NICHT";
type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

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

function asOptionalString(v: any): string | undefined {
  if (v == null) return undefined;
  const s = asString(v);
  return s;
}

function asOptionalBoolean(v: any): boolean | undefined {
  if (v == null) return undefined;
  return !!v;
}

function asOptionalNumber(v: any): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function normalizePlaceType(v: any): PlaceType {
  if (v === "STELLPLATZ" || v === "CAMPINGPLATZ" || v === "SEHENSWUERDIGKEIT" || v === "HVO_TANKSTELLE") return v;
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
      thumbnailImageId: body?.thumbnailImageId ?? null,
      ratingDetail: { create: { ...rd } },
    },
    include: { ratingDetail: true, images: true },
  });

  return NextResponse.json(created);
}

/**
 * PUT – Updates an existing Place (and its ratingDetail via upsert).
 * Expected body:
 * - id (required)
 * - any subset of: name, type, lat, lng, dogAllowed, sanitary, yearRound, onlineBooking, gastronomy, thumbnailImageId
 * - optional ratingDetail (partial or full), will be normalized and upserted
 */
export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const idNum = Number(body?.id);
  if (!Number.isFinite(idNum)) return NextResponse.json({ error: "id fehlt/ungueltig" }, { status: 400 });

  const data: any = {};

  const name = asOptionalString(body?.name);
  if (name !== undefined) {
    const trimmed = name.trim();
    if (!trimmed) return NextResponse.json({ error: "Name fehlt" }, { status: 400 });
    data.name = trimmed;
  }

  if (body?.type != null) data.type = normalizePlaceType(body?.type);

  const lat = asOptionalNumber(body?.lat);
  const lng = asOptionalNumber(body?.lng);
  if ((body?.lat != null && lat === undefined) || (body?.lng != null && lng === undefined)) {
    return NextResponse.json({ error: "Koordinaten ungültig", lat: body?.lat, lng: body?.lng }, { status: 400 });
  }
  if (lat !== undefined) data.lat = lat;
  if (lng !== undefined) data.lng = lng;

  const dogAllowed = asOptionalBoolean(body?.dogAllowed);
  const sanitary = asOptionalBoolean(body?.sanitary);
  const yearRound = asOptionalBoolean(body?.yearRound);
  const onlineBooking = asOptionalBoolean(body?.onlineBooking);
  const gastronomy = asOptionalBoolean(body?.gastronomy);

  if (dogAllowed !== undefined) data.dogAllowed = dogAllowed;
  if (sanitary !== undefined) data.sanitary = sanitary;
  if (yearRound !== undefined) data.yearRound = yearRound;
  if (onlineBooking !== undefined) data.onlineBooking = onlineBooking;
  if (gastronomy !== undefined) data.gastronomy = gastronomy;

  if (body?.thumbnailImageId !== undefined) {
    data.thumbnailImageId = body.thumbnailImageId === null ? null : Number(body.thumbnailImageId);
    if (data.thumbnailImageId !== null && !Number.isFinite(data.thumbnailImageId)) {
      return NextResponse.json({ error: "thumbnailImageId ungültig" }, { status: 400 });
    }
  }

  if (body?.ratingDetail !== undefined) {
    const rd = normalizeRatingDetail(body?.ratingDetail);
    data.ratingDetail = {
      upsert: {
        create: { ...rd },
        update: { ...rd },
      },
    };
  }

  try {
    const updated = await prisma.place.update({
      where: { id: idNum },
      data,
      include: { ratingDetail: true, images: true },
    });

    return NextResponse.json(updated);
  } catch (e: any) {
    return NextResponse.json(
      { error: "Update fehlgeschlagen", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}

/**
 * DELETE – Deletes a Place by id.
 * Expected body: { id: number }
 */
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const idNum = Number(body?.id);
  if (!Number.isFinite(idNum)) return NextResponse.json({ error: "id fehlt/ungueltig" }, { status: 400 });

  try {
    await prisma.place.delete({ where: { id: idNum } });
    return NextResponse.json({ ok: true, id: idNum });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Delete fehlgeschlagen", details: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
