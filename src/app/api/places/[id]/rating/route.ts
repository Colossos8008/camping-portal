// src/app/api/places/[id]/rating/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type TSValue = "STIMMIG" | "OKAY" | "PASST_NICHT";

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

function asTSValue(v: unknown): TSValue {
  if (v === "STIMMIG" || v === "OKAY" || v === "PASST_NICHT") return v;
  const s = String(v ?? "").toUpperCase();
  if (s === "STIMMIG") return "STIMMIG";
  if (s === "OKAY") return "OKAY";
  if (s === "PASST_NICHT" || s === "PASSTNICHT") return "PASST_NICHT";
  return TS_DEFAULT;
}

function asString(v: unknown): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

function asOptionalNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function extractDetail(input: any): any {
  if (!input) return null;
  if (input?.upsert?.update) return input.upsert.update;
  if (input?.upsert?.create) return input.upsert.create;
  if (input?.update) return input.update;
  if (input?.create) return input.create;
  return input;
}

function pickLegacy(src: any, key: string): unknown {
  // Backward compat: alte Payloads hatten z.B. aiUmgebung/userUmgebung etc.
  // Wir nehmen erst das neue Feld, dann ai*, dann user*.
  if (src && Object.prototype.hasOwnProperty.call(src, key)) return src[key];
  const aiKey = `ai${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  const userKey = `user${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  if (src && Object.prototype.hasOwnProperty.call(src, aiKey)) return src[aiKey];
  if (src && Object.prototype.hasOwnProperty.call(src, userKey)) return src[userKey];
  return undefined;
}

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

function normalizeRatingDetail(input: any): RatingDetail {
  const b = blankRating();
  const src = extractDetail(input) ?? {};

  const totalRaw = pickLegacy(src, "totalPoints");
  const total = asOptionalNumber(totalRaw);
  const totalPoints = total !== undefined ? total : b.totalPoints;

  return {
    tsUmgebung: asTSValue(pickLegacy(src, "tsUmgebung")),
    tsPlatzStruktur: asTSValue(pickLegacy(src, "tsPlatzStruktur")),
    tsSanitaer: asTSValue(pickLegacy(src, "tsSanitaer")),
    tsBuchung: asTSValue(pickLegacy(src, "tsBuchung")),
    tsHilde: asTSValue(pickLegacy(src, "tsHilde")),
    tsPreisLeistung: asTSValue(pickLegacy(src, "tsPreisLeistung")),
    tsNachklang: asTSValue(pickLegacy(src, "tsNachklang")),
    totalPoints,
    note: asString(pickLegacy(src, "note")),
    cUmgebung: asString(pickLegacy(src, "cUmgebung")),
    cPlatzStruktur: asString(pickLegacy(src, "cPlatzStruktur")),
    cSanitaer: asString(pickLegacy(src, "cSanitaer")),
    cBuchung: asString(pickLegacy(src, "cBuchung")),
    cHilde: asString(pickLegacy(src, "cHilde")),
    cPreisLeistung: asString(pickLegacy(src, "cPreisLeistung")),
    cNachklang: asString(pickLegacy(src, "cNachklang")),
  };
}

async function getPlaceId(ctx: { params: Promise<{ id: string }> | { id: string } }): Promise<number> {
  const p: any = await (ctx as any).params;
  const idNum = Number(p?.id);
  return idNum;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const idNum = await getPlaceId(ctx);
  if (!Number.isFinite(idNum)) return NextResponse.json({ error: "id fehlt oder ungueltig" }, { status: 400 });

  try {
    const place = await prisma.place.findUnique({
      where: { id: idNum },
      include: { ratingDetail: true },
    });

    if (!place) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ ratingDetail: place.ratingDetail ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const idNum = await getPlaceId(ctx);
  if (!Number.isFinite(idNum)) return NextResponse.json({ error: "id fehlt oder ungueltig" }, { status: 400 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  // akzeptiert entweder { ratingDetail: {...} } oder direkt die Felder
  const rd = normalizeRatingDetail(body?.ratingDetail ?? body);

  try {
    const updated = await prisma.place.update({
      where: { id: idNum },
      data: {
        ratingDetail: {
          upsert: {
            create: { ...rd },
            update: { ...rd },
          },
        },
      },
      include: { ratingDetail: true },
    });

    return NextResponse.json({ ratingDetail: updated.ratingDetail ?? null });
  } catch (e: any) {
    return NextResponse.json({ error: "Update fehlgeschlagen", details: e?.message ?? String(e) }, { status: 500 });
  }
}