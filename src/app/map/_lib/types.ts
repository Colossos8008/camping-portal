export type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

export type TSHaltung = "DNA" | "EXPLORER";

export type TS21Source = "AI" | "USER";
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
  thumbnailImageId?: number | null;

  // optional - wird in page.tsx berechnet wenn myPos gesetzt
  distanceKm?: number | null;
};

export type SortMode = "SCORE" | "ALPHA" | "DIST";