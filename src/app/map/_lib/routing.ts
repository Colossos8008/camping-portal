export type RoutePoint = {
  lat: number;
  lng: number;
};

export type RoutedLeg = {
  distanceKm: number | null;
  durationMinutes: number;
  polyline: RoutePoint[];
};

export function parseGoogleDurationMinutes(value: string | null | undefined) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;

  const seconds = Number(raw.endsWith("s") ? raw.slice(0, -1) : raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds / 60));
}

export function decodeGooglePolyline(encoded: string | null | undefined): RoutePoint[] {
  const source = String(encoded ?? "");
  if (!source) return [];

  const points: RoutePoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < source.length) {
    let result = 0;
    let shift = 0;
    let byte = 0;

    do {
      byte = source.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < source.length);

    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    result = 0;
    shift = 0;

    do {
      byte = source.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20 && index < source.length);

    const deltaLng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += deltaLng;

    points.push({
      lat: lat / 1e5,
      lng: lng / 1e5,
    });
  }

  return points;
}
