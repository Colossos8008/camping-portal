// src/app/map/_lib/place.ts
import { Place, PlaceType, PlaceTS2, PlaceTS21, TSHaltung, TS21Source, TS21Scores, TS21Value } from "./types";

export const PLACE_TYPE_LABEL: Record<PlaceType, string> = {
  CAMPINGPLATZ: "Campingplatz",
  STELLPLATZ: "Stellplatz",
  SEHENSWUERDIGKEIT: "Sehenswürdigkeit",
  HVO_TANKSTELLE: "HVO-Tankstelle",
};

export const PLACE_TYPE_ORDER: PlaceType[] = ["CAMPINGPLATZ", "STELLPLATZ", "SEHENSWUERDIGKEIT", "HVO_TANKSTELLE"];

export const PLACE_TYPES_WITH_RATING: PlaceType[] = ["CAMPINGPLATZ", "STELLPLATZ"];

function normalizePlaceType(v: any): PlaceType {
  return v === "CAMPINGPLATZ" || v === "STELLPLATZ" || v === "SEHENSWUERDIGKEIT" || v === "HVO_TANKSTELLE"
    ? v
    : "CAMPINGPLATZ";
}

function normalizeTSHaltung(v: any): TSHaltung {
  return v === "EXPLORER" ? "EXPLORER" : "DNA";
}

function normalizeTS21Source(v: any): TS21Source {
  return v === "USER" ? "USER" : "AI";
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

function safeTs2(raw: any, placeId: number, type: PlaceType): PlaceTS2 | null {
  const relevant = type === "CAMPINGPLATZ" || type === "STELLPLATZ";
  if (!relevant) return null;
  if (!raw || typeof raw !== "object") return null;

  const id = Number(raw.id);
  const pid = Number(raw.placeId ?? placeId);

  return {
    id: Number.isFinite(id) ? id : 0,
    placeId: Number.isFinite(pid) ? pid : placeId,
    haltung: normalizeTSHaltung(raw.haltung),
    note: typeof raw.note === "string" ? raw.note : String(raw.note ?? ""),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  };
}

function safeTs21(raw: any, placeId: number, type: PlaceType): PlaceTS21 | null {
  const relevant = type === "CAMPINGPLATZ" || type === "STELLPLATZ";
  if (!relevant) return null;
  if (!raw || typeof raw !== "object") return null;

  const id = Number(raw.id);
  const pid = Number(raw.placeId ?? placeId);

  // NEU: DNA/Explorer Persistenz (mutual exclusive wird im UI erzwungen - hier nur robust lesen)
  const dna = !!raw.dna;
  const explorer = !!raw.explorer;
  const effectiveDna = dna && explorer ? true : dna;
  const effectiveExplorer = dna && explorer ? false : explorer;

  const dnaExplorerNote = typeof raw.dnaExplorerNote === "string" ? raw.dnaExplorerNote : String(raw.dnaExplorerNote ?? "");

  return {
    id: Number.isFinite(id) ? id : 0,
    placeId: Number.isFinite(pid) ? pid : placeId,
    activeSource: normalizeTS21Source(raw.activeSource),
    ai: normalizeTS21Scores(raw.ai),
    user: normalizeTS21Scores(raw.user),

    // NEU
    dna: effectiveDna,
    explorer: effectiveExplorer,
    dnaExplorerNote,

    note: typeof raw.note === "string" ? raw.note : String(raw.note ?? ""),
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : undefined,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : undefined,
  } as PlaceTS21;
}

/**
 * Normalisiert /api/places Response
 * - robust gegen leere, fehlerhafte oder alte Daten
 * - entfernt keine Features
 */
export function safePlacesFromApi(input: any): Place[] {
  const raw = Array.isArray(input?.places) ? input.places : Array.isArray(input) ? input : [];

  return raw
    .map((p: any) => {
      if (typeof p?.id !== "number" || typeof p?.lat !== "number" || typeof p?.lng !== "number") return null;

      const type: PlaceType = normalizePlaceType(p.type);

      return {
        id: p.id,
        name: String(p.name ?? ""),
        type,
        lat: p.lat,
        lng: p.lng,

        dogAllowed: !!p.dogAllowed,
        sanitary: !!p.sanitary,
        yearRound: !!p.yearRound,
        onlineBooking: !!p.onlineBooking,
        gastronomy: !!p.gastronomy,

        ratingDetail: p.ratingDetail ?? null,
        ts2: safeTs2(p.ts2, p.id, type),
        ts21: safeTs21(p.ts21, p.id, type),

        images: Array.isArray(p.images) ? p.images : [],
        thumbnailImageId: typeof p.thumbnailImageId === "number" ? p.thumbnailImageId : null,
      } as Place;
    })
    .filter(Boolean) as Place[];
}