export type GeoPoint = { lat: number; lng: number; source: "CSV_LAT_LNG" | "PLUS_CODE" | "MAPS_URL" };

export function parseNumber(s: string | undefined | null): number | null {
  const v = String(s ?? "").trim();
  if (!v) return null;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function extractLatLngFromUrl(url: string): { lat: number; lng: number } | null {
  const u = String(url ?? "");
  // Pattern 1: /@lat,lng,zoom
  {
    const m = u.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  }

  // Pattern 2: !3dLAT!4dLNG
  {
    const m = u.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  }

  // Pattern 3: ll=lat,lng
  {
    const m = u.match(/[?&]ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (m) return { lat: Number(m[1]), lng: Number(m[2]) };
  }

  return null;
}

export async function resolveLatLngFromMapsUrl(googleMapsUrl: string): Promise<{ lat: number; lng: number } | null> {
  const startUrl = String(googleMapsUrl ?? "").trim();
  if (!startUrl) return null;

  // Follow redirects and try to parse the final URL
  try {
    const res = await fetch(startUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0",
        "Accept": "text/html,application/xhtml+xml",
      },
    });

    // First try final URL
    const finalUrl = res.url;
    const fromFinal = extractLatLngFromUrl(finalUrl);
    if (fromFinal) return fromFinal;

    // Then try response body (limited)
    const html = await res.text();
    const fromHtml = extractLatLngFromUrl(html);
    if (fromHtml) return fromHtml;

    return null;
  } catch {
    return null;
  }
}
