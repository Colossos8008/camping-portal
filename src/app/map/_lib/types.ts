export type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

export type TSHaltung = "DNA" | "EXPLORER";

export type TS21Source = "AI" | "USER";

export type SightRelevanceType = "ICON" | "STRONG_MATCH" | "GOOD_MATCH" | "OPTIONAL" | "LOW_MATCH";
export type SightVisitMode = "EASY_STOP" | "SMART_WINDOW" | "OUTSIDE_BEST" | "MAIN_DESTINATION" | "WEATHER_WINDOW";
export type TS21Value = "S" | "O" | "X";
export type TS21Scores = Record<string, TS21Value>;

export type PlaceTS2 = {
  id: number;
  placeId: number;
  haltung: TSHaltung;
  note: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PlaceTS21 = {
  id: number;
  placeId: number;
  activeSource: TS21Source;
  ai: TS21Scores;
  user: TS21Scores;
  note: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PlaceImage = {
  id: number;
  placeId?: number;
  filename: string;
  createdAt?: string;
  updatedAt?: string;
};

export type Place = {
  id: number;
  name: string;
  type: PlaceType;
  lat: number;
  lng: number;

  dogAllowed: boolean;
  sanitary: boolean;
  yearRound: boolean;
  onlineBooking: boolean;
  gastronomy: boolean;

  ratingDetail?: any | null;

  ts2?: PlaceTS2 | null;
  ts21?: PlaceTS21 | null;

  images?: PlaceImage[];
  heroImageUrl?: string | null;
  thumbnailImageId?: number | null;

  natureScore?: number | null;
  architectureScore?: number | null;
  historyScore?: number | null;
  uniquenessScore?: number | null;
  spontaneityScore?: number | null;
  calmScore?: number | null;
  sightseeingTotalScore?: number | null;
  sightRelevanceType?: SightRelevanceType | null;
  sightVisitModePrimary?: SightVisitMode | null;
  sightVisitModeSecondary?: SightVisitMode | null;
  crowdRiskScore?: number | null;
  bestVisitHint?: string | null;
  summaryWhyItMatches?: string | null;

  // optional - wird in page.tsx berechnet wenn myPos gesetzt
  distanceKm?: number | null;
};

export type SortMode = "SCORE" | "ALPHA" | "DIST";