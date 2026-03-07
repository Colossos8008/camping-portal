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
  archaeoMegalith: number;
  strongCoastView: number;
  strongBuiltLandmark: number;
  uniquenessStrong: number;
  fortification: number;
  heavyMemorial: number;
  genericMemorial: number;
  lighthouse: number;
  castlePalace: number;
  religiousHeritage: number;
  historicQuarter: number;
  landmarkMonument: number;
  geothermal: number;
  hasKnowledgeRefs: boolean;
};

const NATURE_SIGNAL_WORDS = [
  "cliff", "cliffs", "coast", "coastal", "bay", "headland", "rock", "rocks", "forest", "dune", "dunes", "viewpoint", "panorama", "panoramic", "natural site", "waterfall", "valley", "gorge", "geologic", "geological", "nature reserve", "estuary", "lighthouse setting", "geyser", "geysir", "geothermal", "natural attraction", "natural-attraction", "kaltwassergeysir",
];

const ARCHITECTURE_SIGNAL_WORDS = [
  "abbey", "cathedral", "basilica", "church", "fortress", "citadel", "castle", "ramparts", "medieval town", "old town", "historic center", "historic quarter", "lighthouse", "half-timbered", "bridge", "monument", "chapel", "priory", "burg", "schloss", "festung", "altstadt", "basilika", "kloster", "abtei", "denkmal",
];

const HISTORY_SIGNAL_WORDS = [
  "memorial", "national monument", "battlefield", "heritage", "historic", "archaeological", "megalithic", "dolmen", "menhir", "ancient", "medieval", "listed monument", "remembrance", "historic quarter", "old town", "historic center", "historisches zentrum", "altstadt", "denkmal", "nationaldenkmal", "mittelalter",
];

const UNIQUENESS_SIGNAL_WORDS = [
  "iconic", "exceptional", "unique", "unesco", "emblematic", "remarkable", "spectacular", "famous landmark", "major attraction", "river confluence", "rivers confluence", "headland", "geysir", "geyser", "geothermal", "pilgrimage", "icon", "ikonisch",
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

const ARCHAEO_MEGALITH_SIGNAL_WORDS = [
  "archaeological_site", "archaeological site", "megalith", "megalithic", "dolmen", "menhir", "passage_grave", "passage grave", "prehistoric", "historic:archaeological_site", "historic:civilization:prehistoric",
];

const STRONG_COAST_VIEW_SIGNAL_WORDS = [
  "viewpoint", "point de vue", "panorama", "panoramic", "baie", "bay", "anse", "pointe", "cap", "cliff", "coast", "coastal", "headland", "lighthouse setting", "phare",
];

const STRONG_BUILT_LANDMARK_SIGNAL_WORDS = [
  "lighthouse", "phare", "fort", "fortress", "citadel", "castle", "ruins", "abbey", "cathedral", "ramparts", "memorial", "burg", "schloss", "festung", "abtei", "kloster", "basilika", "denkmal", "landmark",
];

const UNIQUENESS_STRONG_SIGNAL_WORDS = [
  "archaeological_site", "archaeological site", "megalith", "dolmen", "menhir", "passage_grave", "passage grave", "lighthouse", "phare", "fort", "fortress", "citadel", "ruins", "emblematic", "iconic", "remarkable", "medieval castle", "iconic castle", "major fortress", "national monument", "historic quarter", "rivers confluence", "geysir", "geyser", "geothermal",
];

const FORTIFICATION_SIGNAL_WORDS = [
  "fort", "fortress", "citadel", "bastion", "battery", "ruins", "ramparts", "casemate", "military fortification", "defensive structure", "burg", "festung", "castle", "medieval castle", "fortification",
];

const CASTLE_PALACE_SIGNAL_WORDS = ["castle", "burg", "schloss", "palace", "medieval castle", "iconic castle"];
const RELIGIOUS_HERITAGE_SIGNAL_WORDS = ["abbey", "abtei", "monastery", "kloster", "basilica", "basilika", "pilgrimage"];
const HISTORIC_QUARTER_SIGNAL_WORDS = ["historic quarter", "old town", "historic center", "historisches zentrum", "altstadt", "medieval town"];
const LANDMARK_MONUMENT_SIGNAL_WORDS = ["landmark", "monument", "national monument", "denkmal", "nationaldenkmal", "river confluence", "rivers confluence", "major viewpoint", "headland"];
const GEOTHERMAL_SIGNAL_WORDS = ["geysir", "geyser", "geothermal", "cold-water geyser", "natural attraction", "natural-attraction", "kaltwassergeysir"];

const GENERIC_MEMORIAL_SIGNAL_WORDS = [
  "memorial", "monument", "commemoration", "war memorial",
];

const HEAVY_MEMORIAL_SIGNAL_WORDS = [
  "deportation", "remembrance", "resistance", "holocaust", "occupation",
];

const LIGHTHOUSE_SIGNAL_WORDS = [
  "lighthouse", "phare", "beacon", "seamark", "coastal lighthouse",
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeForSignalMatching(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function hasSignalMatch(haystack: string, signal: string): boolean {
  const normalizedSignal = normalizeForSignalMatching(signal).trim();
  if (!normalizedSignal) return false;

  const parts = normalizedSignal.split(/\s+/).map(escapeRegex).filter(Boolean);
  if (parts.length === 0) return false;

  const corePattern = parts.length === 1 ? parts[0] : parts.join("[^\\p{L}\\p{N}]+");
  const regex = new RegExp(`(?:^|[^\\p{L}\\p{N}])${corePattern}(?:$|[^\\p{L}\\p{N}])`, "u");
  return regex.test(haystack);
}

function countSignals(haystack: string, words: string[]): number {
  const normalizedHaystack = normalizeForSignalMatching(haystack);
  let hits = 0;
  for (const word of words) {
    if (hasSignalMatch(normalizedHaystack, word)) hits += 1;
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
  const normalizedText = normalizeForSignalMatching(text);
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
    archaeoMegalith: countSignals(text, ARCHAEO_MEGALITH_SIGNAL_WORDS),
    strongCoastView: countSignals(text, STRONG_COAST_VIEW_SIGNAL_WORDS),
    strongBuiltLandmark: countSignals(text, STRONG_BUILT_LANDMARK_SIGNAL_WORDS),
    uniquenessStrong: countSignals(text, UNIQUENESS_STRONG_SIGNAL_WORDS),
    fortification: countSignals(text, FORTIFICATION_SIGNAL_WORDS),
    heavyMemorial: countSignals(text, HEAVY_MEMORIAL_SIGNAL_WORDS),
    genericMemorial: countSignals(text, GENERIC_MEMORIAL_SIGNAL_WORDS),
    lighthouse: countSignals(text, LIGHTHOUSE_SIGNAL_WORDS),
    castlePalace: countSignals(text, CASTLE_PALACE_SIGNAL_WORDS),
    religiousHeritage: countSignals(text, RELIGIOUS_HERITAGE_SIGNAL_WORDS),
    historicQuarter: countSignals(text, HISTORIC_QUARTER_SIGNAL_WORDS),
    landmarkMonument: countSignals(text, LANDMARK_MONUMENT_SIGNAL_WORDS),
    geothermal: countSignals(text, GEOTHERMAL_SIGNAL_WORDS),
    hasKnowledgeRefs: hasSignalMatch(normalizedText, "wikidata") || hasSignalMatch(normalizedText, "wikipedia"),
  };
}

function calculateCoreScores(sig: SignalBucket): Omit<SightseeingRatingResult, "sightseeingTotalScore" | "sightRelevanceType" | "sightVisitModePrimary" | "sightVisitModeSecondary" | "bestVisitHint" | "summaryWhyItMatches"> {
  const natureScore = toFiveScale(
    sig.nature * 1.1 + sig.strongCoastView * 0.8 + sig.lighthouse * 0.25 - sig.negative * 0.6 + (sig.weather > 0 ? 0.4 : 0) + (sig.strongCoastView >= 2 ? 0.4 : 0)
  );
  const architectureScore = toFiveScale(
    sig.architecture * 1.2 +
      sig.strongBuiltLandmark * 0.9 +
      sig.fortification * 1.1 +
      sig.castlePalace * 1.05 +
      sig.religiousHeritage * 0.8 +
      sig.historicQuarter * 0.8 +
      sig.lighthouse * 0.9 -
      sig.negative * 0.8 +
      (sig.outside > 0 ? 0.3 : 0) +
      (sig.strongBuiltLandmark >= 2 ? 0.5 : 0) +
      (sig.fortification >= 2 ? 0.7 : 0) +
      (sig.castlePalace > 0 && sig.fortification > 0 ? 0.45 : 0)
  );
  const historyScore = toFiveScale(
    sig.history * 1.2 +
      sig.archaeoMegalith * 1.3 +
      sig.strongBuiltLandmark * 0.4 +
      sig.fortification * 1.05 +
      sig.religiousHeritage * 0.95 +
      sig.historicQuarter * 0.9 +
      sig.landmarkMonument * 0.6 +
      sig.genericMemorial * 0.45 +
      sig.heavyMemorial * 1.35 +
      (sig.lighthouse > 0 && sig.history > 0 ? 0.4 : 0) -
      sig.negative * 0.7 +
      (sig.archaeoMegalith >= 2 ? 0.7 : 0) +
      (sig.heavyMemorial >= 2 ? 0.8 : 0) +
      (sig.historicQuarter > 0 && sig.landmarkMonument > 0 ? 0.5 : 0)
  );
  const uniquenessScore = toFiveScale(
    sig.uniqueness * 1.6 +
      sig.uniquenessStrong * 1.0 +
      sig.archaeoMegalith * 1.2 +
      sig.fortification * 0.85 +
      sig.castlePalace * 0.95 +
      sig.religiousHeritage * 0.65 +
      sig.historicQuarter * 0.7 +
      sig.landmarkMonument * 1.0 +
      sig.geothermal * 1.35 +
      sig.lighthouse * 0.75 +
      sig.heavyMemorial * 1.1 +
      sig.genericMemorial * 0.15 +
      (sig.architecture + sig.history >= 3 ? 0.8 : 0) +
      (sig.fortification > 0 && sig.strongCoastView > 0 ? 0.8 : 0) +
      (sig.lighthouse > 0 && sig.strongCoastView > 0 ? 0.9 : 0) +
      (sig.geothermal > 0 && sig.nature > 0 ? 0.8 : 0) +
      (sig.heavyMemorial > 0 && sig.history >= 2 ? 0.8 : 0) +
      (sig.uniqueness >= 2 ? 1.2 : 0) +
      (sig.hasKnowledgeRefs && (sig.archaeoMegalith > 0 || sig.uniquenessStrong > 0) ? 0.9 : 0) -
      sig.negative * 0.6
  );

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
  if (uniquenessScore >= 4.0 && architectureScore >= 3.9 && historyScore >= 3.2) return "ICON";
  if (uniquenessScore >= 3.3 && architectureScore >= 2.8 && historyScore >= 2.2) return "GOOD_MATCH";
  if (historyScore >= 3.5 && uniquenessScore >= 2.8) return "GOOD_MATCH";
  if (uniquenessScore >= 3.8 && historyScore >= 3.4) return "GOOD_MATCH";
  if (architectureScore >= 3.6 && uniquenessScore >= 3.2) return "GOOD_MATCH";
  if (historyScore >= 4.0 && total >= 46) return "GOOD_MATCH";
  if (architectureScore >= 2.8 && historyScore >= 2.4 && uniquenessScore >= 2.2) return "OPTIONAL";
  if (uniquenessScore >= 3.2 && (architectureScore >= 2.6 || historyScore >= 2.8)) return "OPTIONAL";
  if (uniquenessScore >= 4.2 && total >= 36) return "OPTIONAL";
  if (uniquenessScore >= 2.8 && (architectureScore >= 2.2 || historyScore >= 2.2)) return "OPTIONAL";
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
  const strongHistoricCandidate = input.signal.archaeoMegalith > 0 && input.historyScore >= 3.8 && input.uniquenessScore >= 3.2;
  const strongViewpointCandidate = input.signal.strongCoastView > 0 && input.natureScore >= 3.6;
  const landmarkDestinationCandidate = input.signal.landmarkMonument > 0 && input.uniquenessScore >= 3.3;
  const geothermalDestinationCandidate = input.signal.geothermal > 0 && input.natureScore >= 2.2 && input.uniquenessScore >= 3.2;
  const lighthouseCandidate = input.signal.lighthouse > 0 && input.signal.strongCoastView > 0;
  const coastalFortCandidate = input.signal.fortification > 0 && input.signal.strongCoastView > 0;

  let primary: SightVisitMode = "EASY_STOP";

  if (input.crowdRiskScore >= 3.5 || input.signal.crowd > 0) primary = "SMART_WINDOW";
  else if (mainDestinationCandidate || strongHistoricCandidate || landmarkDestinationCandidate || geothermalDestinationCandidate) primary = "MAIN_DESTINATION";
  else if ((lighthouseCandidate || coastalFortCandidate) && input.uniquenessScore >= 2.8 && input.architectureScore >= 3) primary = "OUTSIDE_BEST";
  else if (strongViewpointCandidate || (input.natureScore >= 3.5 && input.signal.weather > 0)) primary = "WEATHER_WINDOW";
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

function buildVisitHint(
  relevance: SightRelevanceType,
  visitPrimary: SightVisitMode,
  visitSecondary: SightVisitMode | null,
  crowdRiskScore: number,
  calmScore: number
): string {
  if (visitPrimary === "SMART_WINDOW") {
    if (relevance === "ICON" && visitSecondary === "OUTSIDE_BEST") {
      return "Ikonischer Spot trotz Andrang: früh/spät besuchen; Außenwirkung und Silhouette sind oft stärker als der Kernbesuch.";
    }
    return relevance === "ICON"
      ? "Ikonischer Spot trotz Andrang: früh/spät besuchen und Wartezeiten gezielt umgehen."
      : "Zeitfenster planen: früh morgens oder am späten Nachmittag ist meist deutlich entspannter.";
  }
  if (visitPrimary === "WEATHER_WINDOW") {
    if (visitSecondary === "OUTSIDE_BEST") {
      return "Sichtfenster nutzen: bei klaren Bedingungen wirken Außenperspektive und Silhouette am stärksten.";
    }
    return "Wetter und Sicht prüfen: bei klaren Bedingungen ist der Ort deutlich eindrucksvoller.";
  }
  if (visitPrimary === "MAIN_DESTINATION") {
    if (visitSecondary === "OUTSIDE_BEST") {
      return "Als Hauptstopp einplanen und Außenperspektiven mitnehmen: Silhouette/Distanz wirken oft am stärksten.";
    }
    return "Als Hauptstopp einplanen: der Ort lohnt mehr als nur einen kurzen Fotostopp.";
  }
  if (visitSecondary === "OUTSIDE_BEST") {
    return "Kurzstopp gut möglich; Außenwirkung und Distanzperspektive sind oft stärker als der Kernbesuch.";
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
    bestVisitHint: buildVisitHint(sightRelevanceType, visitModes.primary, visitModes.secondary, core.crowdRiskScore, core.calmScore),
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
