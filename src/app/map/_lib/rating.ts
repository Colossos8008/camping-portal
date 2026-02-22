// src/app/map/_lib/rating.ts
import type { TSHaltung } from "./types";

export type TSValue = "STIMMIG" | "OKAY" | "PASST_NICHT";

export type RatingDetail = {
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

export const TS_DEFAULT: TSValue = "OKAY";

export function asTSValue(v: unknown): TSValue {
  if (v === "STIMMIG" || v === "OKAY" || v === "PASST_NICHT") return v;

  const s = String(v ?? "").toUpperCase();
  if (s === "STIMMIG") return "STIMMIG";
  if (s === "OKAY") return "OKAY";
  if (s === "PASST_NICHT" || s === "PASSTNICHT") return "PASST_NICHT";

  return TS_DEFAULT;
}

export function asTSHaltung(v: unknown): TSHaltung {
  return v === "EXPLORER" ? "EXPLORER" : "DNA";
}

export function blankRatingDetail(): RatingDetail {
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

// Backwards compatible alias - map/page.tsx importiert das so
export function blankRating(): RatingDetail {
  return blankRatingDetail();
}

export function tsValueToPoints(v: TSValue): number {
  if (v === "STIMMIG") return 2;
  if (v === "OKAY") return 1;
  return 0;
}

export function calcTotalPoints(
  detail: Pick<
    RatingDetail,
    | "tsUmgebung"
    | "tsPlatzStruktur"
    | "tsSanitaer"
    | "tsBuchung"
    | "tsHilde"
    | "tsPreisLeistung"
    | "tsNachklang"
  >
): number {
  return (
    tsValueToPoints(detail.tsUmgebung) +
    tsValueToPoints(detail.tsPlatzStruktur) +
    tsValueToPoints(detail.tsSanitaer) +
    tsValueToPoints(detail.tsBuchung) +
    tsValueToPoints(detail.tsHilde) +
    tsValueToPoints(detail.tsPreisLeistung) +
    tsValueToPoints(detail.tsNachklang)
  );
}

export function normalizeRatingDetail(input: unknown): RatingDetail {
  const b = blankRatingDetail();
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;

  const out: RatingDetail = {
    tsUmgebung: asTSValue(src.tsUmgebung),
    tsPlatzStruktur: asTSValue(src.tsPlatzStruktur),
    tsSanitaer: asTSValue(src.tsSanitaer),
    tsBuchung: asTSValue(src.tsBuchung),
    tsHilde: asTSValue(src.tsHilde),
    tsPreisLeistung: asTSValue(src.tsPreisLeistung),
    tsNachklang: asTSValue(src.tsNachklang),

    totalPoints:
      typeof src.totalPoints === "number" && Number.isFinite(src.totalPoints) ? (src.totalPoints as number) : b.totalPoints,

    note: typeof src.note === "string" ? (src.note as string) : "",
    cUmgebung: typeof src.cUmgebung === "string" ? (src.cUmgebung as string) : "",
    cPlatzStruktur: typeof src.cPlatzStruktur === "string" ? (src.cPlatzStruktur as string) : "",
    cSanitaer: typeof src.cSanitaer === "string" ? (src.cSanitaer as string) : "",
    cBuchung: typeof src.cBuchung === "string" ? (src.cBuchung as string) : "",
    cHilde: typeof src.cHilde === "string" ? (src.cHilde as string) : "",
    cPreisLeistung: typeof src.cPreisLeistung === "string" ? (src.cPreisLeistung as string) : "",
    cNachklang: typeof src.cNachklang === "string" ? (src.cNachklang as string) : "",
  };

  if (!(typeof src.totalPoints === "number" && Number.isFinite(src.totalPoints as number))) {
    out.totalPoints = calcTotalPoints(out);
  }

  return out;
}