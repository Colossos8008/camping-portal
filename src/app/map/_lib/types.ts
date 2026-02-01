// src/app/map/_lib/types.ts
export type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

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

  images?: PlaceImage[];
  thumbnailImageId?: number | null;

  // optional - wird in page.tsx berechnet wenn myPos gesetzt
  distanceKm?: number | null;
};

export type SortMode = "SCORE" | "ALPHA" | "DIST";
