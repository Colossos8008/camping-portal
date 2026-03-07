export type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

export type SightRelevanceType = "ICON" | "STRONG_MATCH" | "GOOD_MATCH" | "OPTIONAL" | "LOW_MATCH";
export type SightVisitMode = "EASY_STOP" | "SMART_WINDOW" | "OUTSIDE_BEST" | "MAIN_DESTINATION" | "WEATHER_WINDOW";

export type SightseeingPlaceLikeInput = {
  name?: string | null;
  type?: PlaceType | null;
  description?: string | null;
  category?: string | null;
  tags?: string[] | null;
  source?: string | null;
  address?: string | null;
  region?: string | null;
  country?: string | null;
};

export type SightseeingRatingResult = {
  natureScore: number;
  architectureScore: number;
  historyScore: number;
  uniquenessScore: number;
  spontaneityScore: number;
  calmScore: number;
  sightseeingTotalScore: number;
  sightRelevanceType: SightRelevanceType;
  sightVisitModePrimary: SightVisitMode;
  sightVisitModeSecondary: SightVisitMode | null;
  crowdRiskScore: number;
  bestVisitHint: string;
  summaryWhyItMatches: string;
};

type SignalBucket = {
  nature: number;
  architecture: number;
  history: number;
  uniqueness: number;
  negative: number;
  crowd: number;
  calm: number;
  weather: number;
  outside: number;
};

const NATURE_SIGNAL_WORDS = [
  "cliff", "cliffs", "coast", "coastal", "bay", "headland", "rock", "rocks", "forest", "dune", "dunes", "viewpoint", "panorama", "panoramic", "natural site", "waterfall", "valley", "gorge", "geologic", "geological", "nature reserve", "estuary", "lighthouse setting",
];

const ARCHITECTURE_SIGNAL_WORDS = [
  "abbey", "cathedral", "basilica", "church", "fortress", "citadel", "castle", "ramparts", "medieval town", "old town", "historic center", "lighthouse", "half-timbered", "bridge", "monument", "chapel", "priory",
];

const HISTORY_SIGNAL_WORDS = [
  "memorial", "national monument", "battlefield", "heritage", "historic", "archaeological", "megalithic", "dolmen", "menhir", "ancient", "medieval", "listed monument", "remembrance",
];

const UNIQUENESS_SIGNAL_WORDS = [
  "iconic", "exceptional", "unique", "unesco", "emblematic", "remarkable", "spectacular", "famous landmark",
];

const NEGATIVE_SIGNAL_WORDS = [
  "amusement", "theme park", "aquarium", "shopping", "entertainment complex", "indoor attraction", "family park", "water park", "selfie spot", "commercial village", "gaming", "mall",
];

const CROWD_SIGNAL_WORDS = [
  "must-see", "very popular", "busiest", "hotspot", "queue", "crowded", "overcrowded", "packed", "tourist trap", "peak season",
];

const CALM_SIGNAL_WORDS = [
  "hidden gem", "peaceful", "quiet", "tranquil", "less visited", "off the beaten path", "unspoiled", "secluded",
];

const WEATHER_SIGNAL_WORDS = ["viewpoint", "panorama", "panoramic", "coast", "coastal", "dune", "cliff", "waterfall"];
const OUTSIDE_SIGNAL_WORDS = ["landmark", "lighthouse", "ramparts", "fortress", "citadel", "castle", "old town", "medieval town", "coast", "headland"];

function countSignals(haystack: string, words: string[]): number {
  let hits = 0;
  for (const word of words) {
    if (haystack.includes(word)) hits += 1;
  }
  return hits;
}

function normalizeText(input: SightseeingPlaceLikeInput): string {
  const tagsText = Array.isArray(input.tags) ? input.tags.join(" ") : "";
  return [input.name, input.description, input.category, input.source, input.address, input.region, input.country, tagsText]
    .filter((x) => typeof x === "string" && x.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function toFiveScale(base: number): number {
  return clamp(Math.round(base * 10) / 10, 0, 5);
}

function signalsFromText(text: string): SignalBucket {
  return {
    nature: countSignals(text, NATURE_SIGNAL_WORDS),
    architecture: countSignals(text, ARCHITECTURE_SIGNAL_WORDS),
    history: countSignals(text, HISTORY_SIGNAL_WORDS),
    uniqueness: countSignals(text, UNIQUENESS_SIGNAL_WORDS),
    negative: countSignals(text, NEGATIVE_SIGNAL_WORDS),
    crowd: countSignals(text, CROWD_SIGNAL_WORDS),
    calm: countSignals(text, CALM_SIGNAL_WORDS),
    weather: countSignals(text, WEATHER_SIGNAL_WORDS),
    outside: countSignals(text, OUTSIDE_SIGNAL_WORDS),
  };
}

function calculateCoreScores(sig: SignalBucket): Omit<SightseeingRatingResult, "sightseeingTotalScore" | "sightRelevanceType" | "sightVisitModePrimary" | "sightVisitModeSecondary" | "bestVisitHint" | "summaryWhyItMatches"> {
  const natureScore = toFiveScale(sig.nature * 1.1 - sig.negative * 0.6 + (sig.weather > 0 ? 0.4 : 0));
  const architectureScore = toFiveScale(sig.architecture * 1.2 - sig.negative * 0.8 + (sig.outside > 0 ? 0.3 : 0));
  const historyScore = toFiveScale(sig.history * 1.2 - sig.negative * 0.7);
  const uniquenessScore = toFiveScale(sig.uniqueness * 1.6 + (sig.architecture + sig.history >= 3 ? 0.8 : 0) + (sig.uniqueness >= 2 ? 1.2 : 0) - sig.negative * 0.6);

  const crowdRiskScore = toFiveScale(sig.crowd * 1.3 + sig.uniqueness * 0.4 + sig.architecture * 0.2 - sig.calm * 0.8);
  const calmScore = toFiveScale(sig.calm * 1.4 - sig.crowd * 0.9 - sig.negative * 0.5 + (sig.nature > 1 ? 0.7 : 0));

  const spontaneityRaw =
    2.0 +
    (sig.outside > 0 ? 1.0 : 0) +
    (sig.nature > 0 ? 0.5 : 0) +
    (sig.architecture > 0 ? 0.4 : 0) -
    (sig.negative > 0 ? 1.2 : 0) -
    (crowdRiskScore > 3.5 ? 0.4 : 0);
  const spontaneityScore = toFiveScale(spontaneityRaw);

  return {
    natureScore,
    architectureScore,
    historyScore,
    uniquenessScore,
    spontaneityScore,
    calmScore,
    crowdRiskScore,
  };
}

function buildTotalScore(core: Pick<SightseeingRatingResult, "natureScore" | "architectureScore" | "historyScore" | "uniquenessScore" | "spontaneityScore" | "calmScore" | "crowdRiskScore">) {
  const weighted =
    core.natureScore * 0.18 +
    core.architectureScore * 0.2 +
    core.historyScore * 0.2 +
    core.uniquenessScore * 0.24 +
    core.spontaneityScore * 0.12 +
    core.calmScore * 0.06;

  const crowdPenalty = core.crowdRiskScore > 4 ? 1.5 : core.crowdRiskScore > 3 ? 0.8 : 0;
  const total = clamp(Math.round((weighted * 20 - crowdPenalty) * 10) / 10, 0, 100);
  return total;
}

function pickRelevanceType(total: number, uniquenessScore: number, architectureScore: number, historyScore: number): SightRelevanceType {
  const iconCandidate = uniquenessScore >= 4.2 && (architectureScore + historyScore >= 2.4 || total >= 70);
  if (iconCandidate) return "ICON";
  if (total >= 74) return "STRONG_MATCH";
  if (total >= 58) return "GOOD_MATCH";
  if (total >= 40) return "OPTIONAL";
  return "LOW_MATCH";
}

function pickVisitModes(input: {
  crowdRiskScore: number;
  spontaneityScore: number;
  natureScore: number;
  architectureScore: number;
  historyScore: number;
  uniquenessScore: number;
  relevanceType: SightRelevanceType;
  signal: SignalBucket;
}): { primary: SightVisitMode; secondary: SightVisitMode | null } {
  const mainDestinationCandidate = input.uniquenessScore >= 3.8 && (input.architectureScore + input.historyScore >= 7 || input.relevanceType === "ICON");

  let primary: SightVisitMode = "EASY_STOP";

  if (input.crowdRiskScore >= 3.5 || input.signal.crowd > 0) primary = "SMART_WINDOW";
  else if (mainDestinationCandidate) primary = "MAIN_DESTINATION";
  else if (input.natureScore >= 3.5 && input.signal.weather > 0) primary = "WEATHER_WINDOW";
  else if (input.spontaneityScore >= 3.6) primary = "EASY_STOP";

  let secondary: SightVisitMode | null = null;
  if ((input.relevanceType === "ICON" || input.uniquenessScore >= 4) && input.signal.outside > 0) {
    secondary = "OUTSIDE_BEST";
  } else if (primary !== "MAIN_DESTINATION" && mainDestinationCandidate) {
    secondary = "MAIN_DESTINATION";
  } else if (primary !== "WEATHER_WINDOW" && input.natureScore >= 4 && input.signal.weather > 0) {
    secondary = "WEATHER_WINDOW";
  }

  if (secondary === primary) secondary = null;

  return { primary, secondary };
}

function buildVisitHint(relevance: SightRelevanceType, visitPrimary: SightVisitMode, crowdRiskScore: number, calmScore: number): string {
  if (visitPrimary === "SMART_WINDOW") {
    return relevance === "ICON"
      ? "Ikonischer Spot trotz Andrang: früh/spät besuchen und Wartezeiten gezielt umgehen."
      : "Zeitfenster planen: früh morgens oder am späten Nachmittag ist meist deutlich entspannter.";
  }
  if (visitPrimary === "WEATHER_WINDOW") {
    return "Wetter und Sicht prüfen: bei klaren Bedingungen ist der Ort deutlich eindrucksvoller.";
  }
  if (visitPrimary === "MAIN_DESTINATION") {
    return "Als Hauptstopp einplanen: der Ort lohnt mehr als nur einen kurzen Fotostopp.";
  }
  if (calmScore >= 3.5 && crowdRiskScore <= 2) {
    return "Gut für einen spontanen, ruhigen Zwischenstopp ohne großen Planungsaufwand.";
  }
  return "Flexibel als kurzer Stopp geeignet; am besten außerhalb typischer Stoßzeiten.";
}

function buildSummary(input: {
  relevance: SightRelevanceType;
  natureScore: number;
  architectureScore: number;
  historyScore: number;
  uniquenessScore: number;
  crowdRiskScore: number;
}): string {
  const strengths: string[] = [];
  if (input.natureScore >= 3) strengths.push("Naturwirkung");
  if (input.architectureScore >= 3) strengths.push("Architektur");
  if (input.historyScore >= 3) strengths.push("Geschichte");
  if (input.uniquenessScore >= 3.5) strengths.push("Einzigartigkeit");

  const base = strengths.length ? `Starker Match durch ${strengths.join(", ")}.` : "Nur begrenzter Match mit den TS-Sehenswürdigkeits-Präferenzen.";
  if (input.relevance === "ICON" && input.crowdRiskScore >= 3.5) {
    return `${base} Trotz hoher Besucherzahl bleibt der Ort ein ikonischer Kandidat.`;
  }
  if (input.crowdRiskScore >= 3.5) return `${base} Mit erhöhtem Andrang ist ein cleveres Zeitfenster wichtig.`;
  return base;
}

export function rateSightseeing(input: SightseeingPlaceLikeInput): SightseeingRatingResult {
  const isSight = input.type === "SEHENSWUERDIGKEIT" || input.type == null;
  const text = normalizeText(input);
  const signal = signalsFromText(text);

  const core = calculateCoreScores(signal);

  if (!isSight) {
    return {
      ...core,
      sightseeingTotalScore: 0,
      sightRelevanceType: "LOW_MATCH",
      sightVisitModePrimary: "EASY_STOP",
      sightVisitModeSecondary: null,
      bestVisitHint: "Nur für Sehenswürdigkeiten relevant.",
      summaryWhyItMatches: "Ortstyp ist nicht als Sehenswürdigkeit markiert.",
    };
  }

  const sightseeingTotalScore = buildTotalScore(core);
  const sightRelevanceType = pickRelevanceType(
    sightseeingTotalScore,
    core.uniquenessScore,
    core.architectureScore,
    core.historyScore
  );

  const visitModes = pickVisitModes({
    crowdRiskScore: core.crowdRiskScore,
    spontaneityScore: core.spontaneityScore,
    natureScore: core.natureScore,
    architectureScore: core.architectureScore,
    historyScore: core.historyScore,
    uniquenessScore: core.uniquenessScore,
    relevanceType: sightRelevanceType,
    signal,
  });

  return {
    ...core,
    sightseeingTotalScore,
    sightRelevanceType,
    sightVisitModePrimary: visitModes.primary,
    sightVisitModeSecondary: visitModes.secondary,
    bestVisitHint: buildVisitHint(sightRelevanceType, visitModes.primary, core.crowdRiskScore, core.calmScore),
    summaryWhyItMatches: buildSummary({
      relevance: sightRelevanceType,
      natureScore: core.natureScore,
      architectureScore: core.architectureScore,
      historyScore: core.historyScore,
      uniquenessScore: core.uniquenessScore,
      crowdRiskScore: core.crowdRiskScore,
    }),
  };
}
