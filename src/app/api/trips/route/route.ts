import { NextRequest, NextResponse } from "next/server";
import { decodeGooglePolyline, parseGoogleDurationMinutes, type RoutePoint, type RoutedLeg } from "@/app/map/_lib/routing";

export const runtime = "nodejs";

const GOOGLE_ROUTES_API_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const MAX_POINTS_PER_REQUEST = 27;

function isValidPoint(value: unknown): value is RoutePoint {
  return (
    typeof value === "object" &&
    value != null &&
    Number.isFinite(Number((value as { lat?: unknown }).lat)) &&
    Number.isFinite(Number((value as { lng?: unknown }).lng))
  );
}

function toWaypoint(point: RoutePoint) {
  return {
    location: {
      latLng: {
        latitude: point.lat,
        longitude: point.lng,
      },
    },
  };
}

function appendPolyline(target: RoutePoint[], nextPoints: RoutePoint[]) {
  if (!nextPoints.length) return;
  if (!target.length) {
    target.push(...nextPoints);
    return;
  }

  const last = target[target.length - 1];
  const first = nextPoints[0];
  const isDuplicate = last != null && first != null && last.lat === first.lat && last.lng === first.lng;
  target.push(...(isDuplicate ? nextPoints.slice(1) : nextPoints));
}

async function computeChunk(points: RoutePoint[], apiKey: string): Promise<{ legs: RoutedLeg[]; polyline: RoutePoint[] }> {
  const origin = points[0];
  const destination = points[points.length - 1];
  const intermediates = points.slice(1, -1);

  const res = await fetch(GOOGLE_ROUTES_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline,routes.polyline.encodedPolyline",
    },
    body: JSON.stringify({
      origin: toWaypoint(origin),
      destination: toWaypoint(destination),
      intermediates: intermediates.map(toWaypoint),
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_UNAWARE",
      polylineQuality: "OVERVIEW",
      polylineEncoding: "ENCODED_POLYLINE",
      languageCode: "de-DE",
      units: "METRIC",
    }),
    cache: "no-store",
  });

  if (!res.ok) {
    const details = await res.text().catch(() => "");
    throw new Error(details || `Google Routes API returned ${res.status}`);
  }

  const json = (await res.json().catch(() => null)) as {
    routes?: Array<{
      legs?: Array<{ distanceMeters?: number; duration?: string; polyline?: { encodedPolyline?: string } }>;
      polyline?: { encodedPolyline?: string };
    }>;
  } | null;

  const route = Array.isArray(json?.routes) ? json?.routes[0] : null;
  const rawLegs = Array.isArray(route?.legs) ? route.legs : [];
  const legs = rawLegs.map((leg) => ({
    distanceKm: Number.isFinite(Number(leg?.distanceMeters)) ? Number(leg!.distanceMeters) / 1000 : null,
    durationMinutes: parseGoogleDurationMinutes(leg?.duration),
    polyline: decodeGooglePolyline(leg?.polyline?.encodedPolyline),
  }));

  return {
    legs,
    polyline: decodeGooglePolyline(route?.polyline?.encodedPolyline),
  };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_MAPS_API_KEY fehlt" }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const points = Array.isArray((body as { points?: unknown[] } | null)?.points)
    ? ((body as { points: unknown[] }).points.filter(isValidPoint).map((point) => ({
        lat: Number(point.lat),
        lng: Number(point.lng),
      })) as RoutePoint[])
    : [];

  if (points.length < 2) {
    return NextResponse.json({ error: "Mindestens zwei Punkte erforderlich" }, { status: 400 });
  }

  try {
    const allLegs: RoutedLeg[] = [];
    const fullPolyline: RoutePoint[] = [];

    for (let index = 0; index < points.length - 1; index += MAX_POINTS_PER_REQUEST - 1) {
      const chunk = points.slice(index, Math.min(points.length, index + MAX_POINTS_PER_REQUEST));
      const result = await computeChunk(chunk, apiKey);
      allLegs.push(...result.legs);
      appendPolyline(fullPolyline, result.polyline);
    }

    return NextResponse.json({
      legs: allLegs,
      polyline: fullPolyline,
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? String(error) }, { status: 502 });
  }
}
