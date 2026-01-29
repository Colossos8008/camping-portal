// src/app/map/_lib/place.ts
import type { Place, PlaceType } from "./types";

export function safePlacesFromApi(data: any): Place[] {
  const arr = Array.isArray(data) ? data : Array.isArray(data?.places) ? data.places : [];
  return arr
    .map((p: any) => ({
      id: Number(p.id),
      name: String(p.name ?? ""),
      type: (p.type ?? "CAMPINGPLATZ") as PlaceType,
      lat: Number(p.lat),
      lng: Number(p.lng),

      dogAllowed: !!p.dogAllowed,
      sanitary: !!p.sanitary,
      yearRound: !!p.yearRound,
      onlineBooking: !!p.onlineBooking,
      gastronomy: !!p.gastronomy,

      ratingDetail: (p.ratingDetail ?? null) as any | null,

      images: Array.isArray(p.images) ? p.images : [],
      thumbnailImageId: p.thumbnailImageId ?? null,

      distanceKm: null,
    }))
    .filter((p: Place) => Number.isFinite(p.id) && Number.isFinite(p.lat) && Number.isFinite(p.lng));
}
