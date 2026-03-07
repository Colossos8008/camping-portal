// src/app/api/places/route.ts
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { placeSelect } from "@/lib/place-select";
import { normalizePlaceHeroImageUrlForPublic } from "@/lib/hero-image";
import { rateSightseeing } from "@/lib/sightseeing-rating";

export const runtime = "nodejs";

type TSValue = "STIMMIG" | "OKAY" | "PASST_NICHT";
type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";
type TSHaltung = "DNA" | "EXPLORER";
type TS21Source = "AI" | "USER";
type SightRelevanceType = "ICON" | "STRONG_MATCH" | "GOOD_MATCH" | "OPTIONAL" | "LOW_MATCH";
type SightVisitMode = "EASY_STOP" | "SMART_WINDOW" | "OUTSIDE_BEST" | "MAIN_DESTINATION" | "WEATHER_WINDOW";

// TS 2.1 Einzelwertung
type TS21Value = "S" | "O" | "X";
type TS21Scores = Record<string, TS21Value>;

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

type TS21Detail = {
  activeSource: TS21Source;
  ai: TS21Scores;
  user: TS21Scores;

  dna: boolean;
  explorer: boolean;
  dnaExplorerNote: string;

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
  return { haltung: "DNA", note: "" };
}

function blankTS21(): TS21Detail {
  return { activeSource: "AI", ai: {}, user: {}, dna: false, explorer: false, dnaExplorerNote: "", note: "" };
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
  return asString(v);
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

function normalizeTSHaltung(v: any): TSHaltung {
  if (v === "EXPLORER") return "EXPLORER";
  return "DNA";
}

function normalizeTS21Source(v: any): TS21Source {
  if (v === "USER") return "USER";
  return "AI";
}

function extractDetail(input: any): any {
  if (!input) return null;
  if (input?.upsert?.update) return input.upsert.update;
  if (input?.upsert?.create) return input.upsert.create;
  if (input?.update) return input.update;
  if (input?.create) return input.create;
  return input;
}

function normalizeRatingDetail(input: any): RatingDetail {
  const b = blankRating();
  const src = extractDetail(input) ?? {};

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
  const src = extractDetail(input) ?? {};
  return {
    haltung: normalizeTSHaltung(src.haltung),
    note: asString(src.note),
  };
}

function normTS21Value(v: any): TS21Value {
  if (v === "S" || v === "O" || v === "X") return v;
  const s = String(v ?? "").toUpperCase();
  if (s === "STIMMIG") return "S";
  if (s === "OKAY") return "O";
  if (s === "PASST_NICHT") return "X";
  return "O";
}

function normalizeTS21Scores(raw: any): TS21Scores {
  const src = raw && typeof raw === "object" ? raw : {};
  const out: TS21Scores = {};
  for (const k of Object.keys(src)) out[String(k)] = normTS21Value((src as any)[k]);
  return out;
}


function normalizeHeroImageUrl(v: any): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;

  const raw = asString(v).trim();
  if (!raw) return null;

  try {
    const u = new URL(raw);
    if (u.protocol === "http:" || u.protocol === "https:") return raw;
    return null;
  } catch {
    return null;
  }
}

function normalizeSightRelevanceType(v: any): SightRelevanceType | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || String(v).trim() === "") return null;
  if (v === "ICON" || v === "STRONG_MATCH" || v === "GOOD_MATCH" || v === "OPTIONAL" || v === "LOW_MATCH") return v;
  return null;
}

function normalizeSightVisitMode(v: any): SightVisitMode | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || String(v).trim() === "") return null;
  if (v === "EASY_STOP" || v === "SMART_WINDOW" || v === "OUTSIDE_BEST" || v === "MAIN_DESTINATION" || v === "WEATHER_WINDOW") return v;
  return null;
}

function normalizeScore0to5(v: any): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(5, Math.round(n * 10) / 10));
}

function normalizeScore0to100(v: any): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || String(v).trim() === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n * 10) / 10));
}

function normalizeTS21Detail(input: any): TS21Detail {
  const src = extractDetail(input) ?? {};

  const dna = !!src.dna;
  const explorer = !!src.explorer;

  // mutual exclusive – falls beides true kommt
  const fixedDna = dna && explorer ? true : dna;
  const fixedExplorer = dna && explorer ? false : explorer;

  return {
    activeSource: normalizeTS21Source(src.activeSource),
    ai: normalizeTS21Scores(src.ai),
    user: normalizeTS21Scores(src.user),

    dna: fixedDna,
    explorer: fixedExplorer,
    dnaExplorerNote: asString(src.dnaExplorerNote),

    note: asString(src.note),
  };
}

function hasExplicitSightseeingInput(body: any): boolean {
  const keys = [
    "natureScore",
    "architectureScore",
    "historyScore",
    "uniquenessScore",
    "spontaneityScore",
    "calmScore",
    "sightseeingTotalScore",
    "sightRelevanceType",
    "sightVisitModePrimary",
    "sightVisitModeSecondary",
    "crowdRiskScore",
    "bestVisitHint",
    "summaryWhyItMatches",
  ];
  return keys.some((k) => body && Object.prototype.hasOwnProperty.call(body, k));
}

function autoSightseeingData(body: any, resolvedType: PlaceType, fallbackName: string) {
  if (resolvedType !== "SEHENSWUERDIGKEIT") return {};
  if (hasExplicitSightseeingInput(body)) return {};

  const rating = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: asString(body?.name ?? fallbackName),
    description: asString(body?.description),
    category: asString(body?.category),
    source: asString(body?.source),
    tags: Array.isArray(body?.tags) ? body.tags.map((x: any) => asString(x)).filter((x: string) => x.length > 0) : [],
    address: asString(body?.address),
    region: asString(body?.region),
    country: asString(body?.country),
  });

  return {
    natureScore: rating.natureScore,
    architectureScore: rating.architectureScore,
    historyScore: rating.historyScore,
    uniquenessScore: rating.uniquenessScore,
    spontaneityScore: rating.spontaneityScore,
    calmScore: rating.calmScore,
    sightseeingTotalScore: rating.sightseeingTotalScore,
    sightRelevanceType: rating.sightRelevanceType,
    sightVisitModePrimary: rating.sightVisitModePrimary,
    sightVisitModeSecondary: rating.sightVisitModeSecondary,
    crowdRiskScore: rating.crowdRiskScore,
    bestVisitHint: rating.bestVisitHint,
    summaryWhyItMatches: rating.summaryWhyItMatches,
  };
}

function isUnknownFieldError(e: any, field: string) {
  const msg = String(e?.message ?? e ?? "");
  return msg.includes(`Unknown field \`${field}\``) || msg.includes(`Unknown argument \`${field}\``);
}

// Cache – Schema-Check (ohne select+include Mix!)
let _supportsTs21Promise: Promise<boolean> | null = null;

async function supportsTs21(): Promise<boolean> {
  if (_supportsTs21Promise) return _supportsTs21Promise;

  _supportsTs21Promise = (async () => {
    try {
      await prisma.place.findFirst({
        select: {
          id: true,
          ts21: { select: { id: true } },
        },
      } as any);
      return true;
    } catch (e: any) {
      if (isUnknownFieldError(e, "ts21")) return false;
      throw e;
    }
  })();

  return _supportsTs21Promise;
}

function ts21IsRequested(body: any): boolean {
  return body && Object.prototype.hasOwnProperty.call(body, "ts21");
}

function ts21NotSupportedResponse() {
  return NextResponse.json(
    {
      error: "TS kann nicht gespeichert werden – Prisma Schema hat keine Relation Place.ts21",
      hint: "Wenn du das hier siehst, ist Prisma Client - Migration Stand inkonsistent.",
    },
    { status: 409 }
  );
}

async function findManyPlaces() {
  const canTs21 = await supportsTs21();

  if (canTs21) {
    return prisma.place.findMany({
      orderBy: { updatedAt: "desc" },
      select: placeSelect(true),
    });
  }

  const places = await prisma.place.findMany({
    orderBy: { updatedAt: "desc" },
    select: placeSelect(false),
  });

  return places.map((p: any) => ({ ...p, ts21: null }));
}

export async function GET() {
  try {
    const places = await findManyPlaces();
    const normalizedPlaces = places.map((place: any) => ({
      ...place,
      heroImageUrl: normalizePlaceHeroImageUrlForPublic(place?.id, place?.heroImageUrl),
    }));
    return NextResponse.json({ places: normalizedPlaces });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? String(e) }, { status: 500 });
  }
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

  const shouldHaveTS = type === "CAMPINGPLATZ" || type === "STELLPLATZ";
  const ts2 = shouldHaveTS ? normalizeTS2Detail(body?.ts2) : null;

  const wantTs21 = shouldHaveTS && ts21IsRequested(body);
  const canTs21 = await supportsTs21();
  if (wantTs21 && !canTs21) return ts21NotSupportedResponse();

  const heroImageUrl = normalizeHeroImageUrl(body?.heroImageUrl);
  if (heroImageUrl === null && typeof body?.heroImageUrl === "string" && body.heroImageUrl.trim() !== "") {
    return NextResponse.json({ error: "heroImageUrl ungültig" }, { status: 400 });
  }

  const autoSight = autoSightseeingData(body, type, name);

  const data: any = {
    name,
    type,
    lat,
    lng,
    dogAllowed: !!body?.dogAllowed,
    sanitary: !!body?.sanitary,
    yearRound: !!body?.yearRound,
    onlineBooking: !!body?.onlineBooking,
    gastronomy: !!body?.gastronomy,
    heroImageUrl: normalizeHeroImageUrl(body?.heroImageUrl),
    thumbnailImageId: body?.thumbnailImageId ?? null,
    natureScore: normalizeScore0to5(body?.natureScore),
    architectureScore: normalizeScore0to5(body?.architectureScore),
    historyScore: normalizeScore0to5(body?.historyScore),
    uniquenessScore: normalizeScore0to5(body?.uniquenessScore),
    spontaneityScore: normalizeScore0to5(body?.spontaneityScore),
    calmScore: normalizeScore0to5(body?.calmScore),
    sightseeingTotalScore: normalizeScore0to100(body?.sightseeingTotalScore),
    sightRelevanceType: normalizeSightRelevanceType(body?.sightRelevanceType),
    sightVisitModePrimary: normalizeSightVisitMode(body?.sightVisitModePrimary),
    sightVisitModeSecondary: normalizeSightVisitMode(body?.sightVisitModeSecondary),
    crowdRiskScore: normalizeScore0to5(body?.crowdRiskScore),
    bestVisitHint: asOptionalString(body?.bestVisitHint) ?? null,
    summaryWhyItMatches: asOptionalString(body?.summaryWhyItMatches) ?? null,
    ...autoSight,

    ratingDetail: { create: { ...rd } },
    ...(shouldHaveTS ? { ts2: { create: { ...(ts2 ?? blankTS2()) } } } : {}),
  };

  if (shouldHaveTS && canTs21) {
    const ts21 = normalizeTS21Detail(body?.ts21);
    data.ts21 = { create: { ...(ts21 ?? blankTS21()) } };
  }

  try {
    const created = await prisma.place.create({
      data,
      select: placeSelect(canTs21),
    });

    const normalizedCreated = {
      ...created,
      heroImageUrl: normalizePlaceHeroImageUrlForPublic(created?.id, (created as any)?.heroImageUrl),
    };

    if (!canTs21) return NextResponse.json({ ...normalizedCreated, ts21: null });
    return NextResponse.json(normalizedCreated);
  } catch (e: any) {
    return NextResponse.json({ error: "Create fehlgeschlagen", details: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const idNum = Number(body?.id);
  if (!Number.isFinite(idNum)) return NextResponse.json({ error: "id fehlt oder ungueltig" }, { status: 400 });

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

  if (body?.heroImageUrl !== undefined) {
    const heroImageUrl = normalizeHeroImageUrl(body?.heroImageUrl);
    if (heroImageUrl === null && typeof body?.heroImageUrl === "string" && body.heroImageUrl.trim() !== "") {
      return NextResponse.json({ error: "heroImageUrl ungültig" }, { status: 400 });
    }
    data.heroImageUrl = heroImageUrl;
  }

  if (body?.thumbnailImageId !== undefined) {
    data.thumbnailImageId = body.thumbnailImageId === null ? null : Number(body.thumbnailImageId);
    if (data.thumbnailImageId !== null && !Number.isFinite(data.thumbnailImageId)) {
      return NextResponse.json({ error: "thumbnailImageId ungültig" }, { status: 400 });
    }
  }

  if (body?.natureScore !== undefined) data.natureScore = normalizeScore0to5(body?.natureScore);
  if (body?.architectureScore !== undefined) data.architectureScore = normalizeScore0to5(body?.architectureScore);
  if (body?.historyScore !== undefined) data.historyScore = normalizeScore0to5(body?.historyScore);
  if (body?.uniquenessScore !== undefined) data.uniquenessScore = normalizeScore0to5(body?.uniquenessScore);
  if (body?.spontaneityScore !== undefined) data.spontaneityScore = normalizeScore0to5(body?.spontaneityScore);
  if (body?.calmScore !== undefined) data.calmScore = normalizeScore0to5(body?.calmScore);
  if (body?.sightseeingTotalScore !== undefined) data.sightseeingTotalScore = normalizeScore0to100(body?.sightseeingTotalScore);
  if (body?.sightRelevanceType !== undefined) data.sightRelevanceType = normalizeSightRelevanceType(body?.sightRelevanceType);
  if (body?.sightVisitModePrimary !== undefined) data.sightVisitModePrimary = normalizeSightVisitMode(body?.sightVisitModePrimary);
  if (body?.sightVisitModeSecondary !== undefined) data.sightVisitModeSecondary = normalizeSightVisitMode(body?.sightVisitModeSecondary);
  if (body?.crowdRiskScore !== undefined) data.crowdRiskScore = normalizeScore0to5(body?.crowdRiskScore);
  if (body?.bestVisitHint !== undefined) data.bestVisitHint = asOptionalString(body?.bestVisitHint) ?? null;
  if (body?.summaryWhyItMatches !== undefined) data.summaryWhyItMatches = asOptionalString(body?.summaryWhyItMatches) ?? null;

  if (body?.ratingDetail !== undefined) {
    const rd = normalizeRatingDetail(body?.ratingDetail);
    data.ratingDetail = {
      upsert: {
        create: { ...rd },
        update: { ...rd },
      },
    };
  }

  const typeFromBody = body?.type != null ? normalizePlaceType(body?.type) : null;
  let finalType: PlaceType | null = typeFromBody;
  if (!finalType) {
    const existing = await prisma.place.findUnique({ where: { id: idNum }, select: { type: true } });
    finalType = existing?.type ?? null;
  }
  const shouldHaveTS = finalType === "CAMPINGPLATZ" || finalType === "STELLPLATZ";

  if (finalType === "SEHENSWUERDIGKEIT" && !hasExplicitSightseeingInput(body)) {
    Object.assign(data, autoSightseeingData(body, finalType, data.name ?? ""));
  }

  if (body?.ts2 !== undefined && shouldHaveTS) {
    const ts2 = normalizeTS2Detail(body?.ts2);
    data.ts2 = {
      upsert: {
        create: { ...ts2 },
        update: { ...ts2 },
      },
    };
  }

  const wantTs21 = shouldHaveTS && ts21IsRequested(body);
  const canTs21 = await supportsTs21();
  if (wantTs21 && !canTs21) return ts21NotSupportedResponse();

  if (body?.ts21 !== undefined && shouldHaveTS && canTs21) {
    const ts21 = normalizeTS21Detail(body?.ts21);
    data.ts21 = {
      upsert: {
        create: { ...ts21 },
        update: { ...ts21 },
      },
    };
  }

  try {
    const updated = await prisma.place.update({
      where: { id: idNum },
      data,
      select: placeSelect(canTs21),
    });

    const normalizedUpdated = {
      ...updated,
      heroImageUrl: normalizePlaceHeroImageUrlForPublic(updated?.id, (updated as any)?.heroImageUrl),
    };

    if (!canTs21) return NextResponse.json({ ...normalizedUpdated, ts21: null });
    return NextResponse.json(normalizedUpdated);
  } catch (e: any) {
    return NextResponse.json({ error: "Update fehlgeschlagen", details: e?.message ?? String(e) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const idNum = Number(body?.id);
  if (!Number.isFinite(idNum)) return NextResponse.json({ error: "id fehlt oder ungueltig" }, { status: 400 });

  try {
    await prisma.place.delete({ where: { id: idNum } });
    return NextResponse.json({ ok: true, id: idNum });
  } catch (e: any) {
    return NextResponse.json({ error: "Delete fehlgeschlagen", details: e?.message ?? String(e) }, { status: 500 });
  }
}