// src/app/map/_lib/geo.ts
function toRad(x: number) {
  return (x * Math.PI) / 180;
}

export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function formatDistanceKm(km: number | null | undefined) {
  if (typeof km !== "number" || !Number.isFinite(km)) return null;
  return km < 10 ? `${km.toFixed(1)} km` : `${km.toFixed(0)} km`;
}

export function estimateDriveMinutesFromKm(km: number | null | undefined) {
  if (typeof km !== "number" || !Number.isFinite(km) || km <= 0) return 0;
  const adjustedKm = km * 1.18;
  return Math.max(1, Math.round((adjustedKm / 72) * 60));
}

export function formatDriveDuration(minutes: number | null | undefined) {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return "0 min";
  const wholeMinutes = Math.round(minutes);
  const hours = Math.floor(wholeMinutes / 60);
  const restMinutes = wholeMinutes % 60;
  if (hours <= 0) return `${restMinutes} min`;
  if (restMinutes === 0) return `${hours} h`;
  return `${hours} h ${restMinutes} min`;
}
