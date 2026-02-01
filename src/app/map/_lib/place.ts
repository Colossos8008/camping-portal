// src/app/map/_lib/place.ts
import { Place, PlaceType } from "./types";

export const PLACE_TYPE_LABEL: Record<PlaceType, string> = {
  CAMPINGPLATZ: "Campingplatz",
  STELLPLATZ: "Stellplatz",
  SEHENSWUERDIGKEIT: "Sehenswürdigkeit",
  HVO_TANKSTELLE: "HVO-Tankstelle",
};

export const PLACE_TYPE_ORDER: PlaceType[] = [
  "CAMPINGPLATZ",
  "STELLPLATZ",
  "SEHENSWUERDIGKEIT",
  "HVO_TANKSTELLE",
];

export const PLACE_TYPES_WITH_RATING: PlaceType[] = [
  "CAMPINGPLATZ",
  "STELLPLATZ",
];

/**
 * Normalisiert /api/places Response
 * – robust gegen leere, fehlerhafte oder alte Daten
 * – entfernt keine Features
 */
export function safePlacesFromApi(input: any): Place[] {
  const raw = Array.isArray(input?.places)
    ? input.places
    : Array.isArray(input)
    ? input
    : [];

  return raw
    .map((p: any) => {
      if (
        typeof p?.id !== "number" ||
        typeof p?.lat !== "number" ||
        typeof p?.lng !== "number"
      ) {
        return null;
      }

      const type: PlaceType =
        p.type === "CAMPINGPLATZ" ||
        p.type === "STELLPLATZ" ||
        p.type === "SEHENSWUERDIGKEIT" ||
        p.type === "HVO_TANKSTELLE"
          ? p.type
          : "CAMPINGPLATZ";

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
        images: Array.isArray(p.images) ? p.images : [],
        thumbnailImageId:
          typeof p.thumbnailImageId === "number"
            ? p.thumbnailImageId
            : null,
      } as Place;
    })
    .filter(Boolean) as Place[];
}
