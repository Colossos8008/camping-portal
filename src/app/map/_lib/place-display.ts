import type { Place, PlaceType } from "./types";

const PLACE_TYPE_LABELS: Record<PlaceType, string> = {
  CAMPINGPLATZ: "Campingplatz",
  STELLPLATZ: "Stellplatz",
  SEHENSWUERDIGKEIT: "Sehenswuerdigkeit",
  HVO_TANKSTELLE: "HVO-Tankstelle",
};

const SIGHT_RELEVANCE_LABELS: Record<string, string> = {
  ICON: "Highlight",
  STRONG_MATCH: "Starker Treffer",
  GOOD_MATCH: "Guter Treffer",
  OPTIONAL: "Optional",
  LOW_MATCH: "Niedrige Relevanz",
};

const SIGHT_VISIT_MODE_LABELS: Record<string, string> = {
  EASY_STOP: "Einfacher Stopp",
  SMART_WINDOW: "Gutes Zeitfenster",
  OUTSIDE_BEST: "Ausserhalb der Top-Zeit",
  MAIN_DESTINATION: "Hauptziel",
  WEATHER_WINDOW: "Wetterfenster",
};

export function isTsRelevantType(type: unknown): boolean {
  return type === "CAMPINGPLATZ" || type === "STELLPLATZ";
}

export function getPlaceTypeLabel(type: unknown): string {
  if (type === "CAMPINGPLATZ" || type === "STELLPLATZ" || type === "SEHENSWUERDIGKEIT" || type === "HVO_TANKSTELLE") {
    return PLACE_TYPE_LABELS[type];
  }
  return String(type ?? "");
}

type TS21Value = "S" | "O" | "X";

function ts21ToPoints(v: TS21Value): number {
  if (v === "S") return 2;
  if (v === "O") return 1;
  return 0;
}

function normTS21Value(v: unknown): TS21Value {
  return v === "S" || v === "O" || v === "X" ? v : "O";
}

export function getTs21Total(raw: any): number | null {
  if (!raw || typeof raw !== "object") return null;

  const src = raw.activeSource === "USER" ? "USER" : "AI";
  const scoreSet = src === "USER" ? raw.user : raw.ai;
  const scores = scoreSet && typeof scoreSet === "object" ? scoreSet : {};

  const keys = ["1a", "1b", "2a", "2b", "3", "4a", "4b", "5", "6", "7"];
  let sum = 0;
  for (const key of keys) sum += ts21ToPoints(normTS21Value(scores[key]));
  return sum;
}

export function getPlaceScore(place: Place | null | undefined): { icon: string; value: number; max: number; title: string } | null {
  if (!place) return null;

  if (place.type === "SEHENSWUERDIGKEIT") {
    const total = Number((place as any).sightseeingTotalScore);
    if (!Number.isFinite(total)) return null;
    return { icon: "🧭", value: Math.round(total), max: 100, title: "TS Sehenswuerdigkeit" };
  }

  if (!isTsRelevantType(place.type)) return null;

  const ts21Total = getTs21Total((place as any).ts21);
  if (ts21Total != null) return { icon: "🍰", value: Math.round(ts21Total), max: 20, title: "Toertchensystem" };

  const t1 = Number((place as any)?.ratingDetail?.totalPoints ?? Number.NaN);
  if (Number.isFinite(t1)) return { icon: "🍰", value: Math.round(t1), max: 14, title: "Toertchensystem" };

  return null;
}

export function getCampingStance(place: Place | null | undefined): { icon: string; label: string } | null {
  if (!place || !isTsRelevantType(place.type)) return null;

  const ts21 = (place as any)?.ts21;
  if (ts21 && typeof ts21 === "object") {
    const dna = !!ts21.dna;
    const explorer = !!ts21.explorer;

    if (explorer && !dna) return { icon: "🧭", label: "Explorer" };
    if (dna || (!dna && !explorer)) return { icon: "🧬", label: "DNA" };
  }

  const haltung = (place as any)?.ts2?.haltung;
  if (haltung === "EXPLORER") return { icon: "🧭", label: "Explorer" };
  if (haltung === "DNA") return { icon: "🧬", label: "DNA" };

  return null;
}

export function getSightseeingMeta(place: Place | null | undefined): { category: string | null; relevance: string | null; visitMode: string | null } | null {
  if (!place || place.type !== "SEHENSWUERDIGKEIT") return null;

  const rawCategory = String((place as any)?.sightCategory ?? "").trim();
  const rawRelevance = String((place as any)?.sightRelevanceType ?? "").trim();
  const rawVisitMode = String((place as any)?.sightVisitModePrimary ?? "").trim();

  return {
    category: rawCategory || null,
    relevance: rawRelevance ? SIGHT_RELEVANCE_LABELS[rawRelevance] ?? rawRelevance : null,
    visitMode: rawVisitMode ? SIGHT_VISIT_MODE_LABELS[rawVisitMode] ?? rawVisitMode : null,
  };
}
