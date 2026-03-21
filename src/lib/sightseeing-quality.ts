import { createClient } from "@supabase/supabase-js";
import { prisma } from "@/lib/prisma";
import { buildGooglePhotoMediaUrl, extractGooglePhotoResourceName } from "@/lib/hero-image";
import { rateSightseeing } from "@/lib/sightseeing-rating";
import { POST as heroAutofillPost } from "@/app/api/admin/hero-autofill/route";
import { discoverHeroCandidates, type PlaceType as HeroCandidatePlaceType } from "@/lib/hero-candidates";

export type QualityPlaceType = "CAMPINGPLATZ" | "STELLPLATZ" | "HVO_TANKSTELLE" | "SEHENSWUERDIGKEIT";

type PlaceRow = {
  id: number;
  name: string;
  type: QualityPlaceType;
  lat: number;
  lng: number;
  heroImageUrl: string | null;
  heroReason: string | null;
  heroScore: number | null;
  sightDescription: string | null;
  sightCategory: string | null;
  sightTags: string[];
  sightRegion: string | null;
  sightCountry: string | null;
};

type Override = {
  description: string;
  heroImageUrl?: string;
  heroReason?: string;
  heroScore?: number;
  category?: string;
  tags?: string[];
  region?: string;
  country?: string;
};

export type SightseeingQualityFailure = {
  id: number;
  name: string;
  type: QualityPlaceType;
  descriptionOk: boolean;
  descriptionLength: number;
  heroOk: boolean;
  heroStatus: number | null;
  heroLocation: string | null;
  heroContentType: string | null;
  heroUsedPlaceholder: string | null;
  thumbnailImageId: number | null;
  heroImageUrl: string | null;
};

export type SightseeingQualityReport = {
  placeType: QualityPlaceType;
  checkedAt: string;
  total: number;
  passed: number;
  failed: number;
  counts: {
    missingDescription: number;
    brokenHero: number;
  };
  failures: SightseeingQualityFailure[];
};

type RemoteAsset = {
  bytes: Uint8Array;
  contentType: string;
  sourceUrl: string;
  sourceLabel: string;
};

const DESCRIPTION_MIN_LENGTH = 48;
const MAX_ATTEMPTS = 3;
const HERO_AUTOFILL_BATCH_SIZE = 25;
const SUPABASE_BUCKET = "place-images";

const OVERRIDES: Record<number, Override> = {
  1507: {
    description:
      "Privater Referenz- und Ausgangspunkt im Mittelrheintal, vor allem als persoenlicher Basisort und organisatorischer Startpunkt relevant, nicht als klassische Sehenswuerdigkeit.",
    category: "personal-base",
    tags: ["personal", "base", "reference point"],
    region: "Mittelrhein",
    country: "Deutschland",
  },
  1584: {
    description:
      "Dramatische Fels- und Brandungskueste auf der Halbinsel Quiberon mit rauen Atlantikpanoramen, Wanderwegen und besonders starker Naturkulisse.",
    category: "coastal-cliffs",
    tags: ["coast", "cliffs", "panorama", "atlantic", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1585: {
    description:
      "Spektakulaeres Kap am Suedende der Presqu'ile de Crozon mit weiten Blicken ueber Heide, Klippen und offene Atlantikkueste.",
    category: "headland-viewpoint",
    tags: ["headland", "coast", "cliffs", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1586: {
    description:
      "Historische ummauerte Altstadtinsel von Concarneau mit engen Gassen, maritimem Flair und markanten Festungsanlagen direkt am Hafen.",
    category: "historic-quarter",
    tags: ["historic quarter", "fortifications", "harbor", "architecture", "history"],
    region: "Bretagne",
    country: "France",
  },
  1587: {
    description:
      "Wilde, vom Atlantik gepraegte Kuestenlandschaft mit Felsen, Brandung und offenen Aussichtspunkten, besonders eindrucksvoll bei klarer Sicht und bewegter See.",
    heroImageUrl: "https://www.guide-charente-maritime.com/_bibli/annonces/12706/hd/cote-sauvage.jpg",
    heroReason: "Quality repair on 2026-03-20: selected stable coastal image for Cote Sauvage to replace placeholder hero.",
    heroScore: 72,
    category: "coastal-landscape",
    tags: ["coast", "atlantic", "panorama", "waves", "nature"],
    region: "Nouvelle-Aquitaine",
    country: "France",
  },
  1588: {
    description:
      "Beruehmter D-Day-Landungsstrand in der Normandie mit weitem Kuestenraum und starkem historischem Bezug zur alliierten Invasion von 1944.",
    category: "memorial-coast",
    tags: ["beach", "world war ii", "history", "memorial", "landmark"],
    region: "Normandie",
    country: "France",
  },
  1589: {
    description:
      "Eindrucksvoller Soldatenfriedhof oberhalb der Landungskueste mit klarer Achse, weitem Meerblick und grosser Gedenk- und Geschichtswirkung.",
    category: "memorial",
    tags: ["cemetery", "world war ii", "history", "memorial", "landmark"],
    region: "Normandie",
    country: "France",
  },
  1590: {
    description:
      "Ikonischer Leuchtturm aus rosa Granit in Ploumanac'h, eingebettet in die markante Felslandschaft der Cote de Granit Rose.",
    category: "lighthouse",
    tags: ["lighthouse", "coast", "pink granite", "landmark", "panorama"],
    region: "Bretagne",
    country: "France",
  },
  1591: {
    description:
      "Beruehmter Kuestenort an der Cote de Granit Rose mit bizarren rosa Granitfelsen, kleinen Buchten und einem der markantesten Kuestenbilder der Bretagne.",
    category: "coastal-landscape",
    tags: ["pink granite", "coast", "panorama", "landmark", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1592: {
    description:
      "Aussichtskap an der Presqu'ile de Crozon mit markantem Felsbogen, steilen Klippen und weitem Blick ueber die wilde Kueste.",
    category: "headland-viewpoint",
    tags: ["headland", "cliffs", "rock arch", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1593: {
    description:
      "Kuestenaussichtspunkt bei Saint-Hernot auf der Halbinsel Crozon mit tuerkisfarbenem Wasser, steilen Haengen und Blick auf die Ile Vierge.",
    heroImageUrl: "https://www.bretagne.com/sites/default/files/post/TopBM_Saint_Hernot_Guillaudeau.jpg",
    heroReason: "Quality repair on 2026-03-20: selected stable regional tourism image for Pointe de Saint-Hernot - Ile Vierge.",
    heroScore: 70,
    category: "viewpoint",
    tags: ["viewpoint", "coast", "turquoise water", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1594: {
    description:
      "Panoramapunkt an der Cote Sauvage von Quiberon mit offenen Blicken ueber Brandung, Felsformationen und die raue Atlantikkueste.",
    category: "viewpoint",
    tags: ["viewpoint", "coast", "atlantic", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1595: {
    description:
      "Markantes Kap im Finistere mit dramatischer Steilkueste, weitem Atlantikblick und einer der eindrucksvollsten Kuestenkulissen der Bretagne.",
    category: "headland-viewpoint",
    tags: ["headland", "cliffs", "atlantic", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1596: {
    description:
      "Charaktervolle Altstadt von Pont-Aven mit Granithaeusern, Bruecken ueber den Aven und starkem Bezug zur Kuenstlergeschichte des Ortes.",
    category: "historic-quarter",
    tags: ["old town", "architecture", "history", "river", "art"],
    region: "Bretagne",
    country: "France",
  },
  1597: {
    description:
      "Lebendiger Hafenbereich von Concarneau mit maritimer Atmosphaere, Blick auf die Ville Close und engem Bezug zur historischen Seestadt.",
    category: "historic-harbor",
    tags: ["harbor", "maritime", "historic quarter", "architecture", "coast"],
    region: "Bretagne",
    country: "France",
  },
  1598: {
    description:
      "Malerischer Hafen von Pont-Aven am Flusslauf des Aven mit ruhiger Uferstimmung, Bruecken und typischem Bretagne-Ortsbild.",
    category: "harbor-riverside",
    tags: ["harbor", "river", "architecture", "village", "scenic"],
    region: "Bretagne",
    country: "France",
  },
  1599: {
    description:
      "Kuestenhalbinsel bei Tregastel mit rosa Granitfelsen, Rundweg und abwechslungsreichen Blicken auf Meer, Buchten und Felsformationen.",
    heroImageUrl: "https://www.bouger-voyager.com/wp-content/uploads/2023/02/renote-ile.jpg",
    heroReason: "Quality repair on 2026-03-20: selected stable editorial photo for Presqu'ile Renote to replace placeholder hero.",
    heroScore: 71,
    category: "coastal-peninsula",
    tags: ["peninsula", "pink granite", "coast", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1600: {
    description:
      "Szenische Kuestenstrasse entlang der wilden Atlantikkueste mit wiederkehrenden Aussichtspunkten auf Brandung, Felsen und offene See.",
    category: "scenic-route",
    tags: ["scenic route", "coast", "atlantic", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1601: {
    description:
      "Beruehmter Kuestenwanderweg entlang der Rosa-Granit-Kueste mit Felsformationen, Meerblick und besonders starken Aussenperspektiven.",
    category: "coastal-trail",
    tags: ["trail", "coast", "pink granite", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1602: {
    description:
      "Aussichtspunkt an der Pointe du Raz mit Blick auf den Phare de la Vieille, offene See und eine der dramatischsten Kuestenszenen im Finistere.",
    category: "viewpoint",
    tags: ["viewpoint", "lighthouse", "coast", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
};

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
}

function requiresDescription(placeType: QualityPlaceType): boolean {
  return placeType === "SEHENSWUERDIGKEIT";
}

export function parseQualityPlaceType(raw: string | null | undefined): QualityPlaceType | null {
  const normalized = clean(raw).toUpperCase();
  if (
    normalized === "CAMPINGPLATZ" ||
    normalized === "STELLPLATZ" ||
    normalized === "HVO_TANKSTELLE" ||
    normalized === "SEHENSWUERDIGKEIT"
  ) {
    return normalized;
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => clean(value)).filter(Boolean)));
}

function getSupabaseServerClient() {
  const url = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
  const apiKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  if (!url) throw new Error("Missing Supabase URL env");
  if (!apiKey) throw new Error("Missing Supabase API key env");

  return createClient(url, apiKey, {
    auth: { persistSession: false },
  });
}

function extensionFromContentType(contentType: string, sourceUrl: string): string {
  const normalized = clean(contentType).toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("jpeg") || normalized.includes("jpg")) return "jpg";

  const match = clean(sourceUrl).match(/\.([a-z0-9]{3,4})(?:$|[?#])/i);
  return match?.[1]?.toLowerCase() || "jpg";
}

async function fetchImageWithRetries(
  url: string,
  options?: { headers?: Record<string, string>; label?: string; retries?: number }
): Promise<RemoteAsset | null> {
  const retries = Math.max(1, options?.retries ?? 3);

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 20000);
      const response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: {
          Accept: "image/*,*/*;q=0.8",
          "User-Agent": "camping-portal-sightseeing-quality/1.0",
          ...(options?.headers ?? {}),
        },
      });
      if (timeout) clearTimeout(timeout);

      const contentType = clean(response.headers.get("content-type")).toLowerCase();
      if (response.ok && contentType.startsWith("image/")) {
        return {
          bytes: new Uint8Array(await response.arrayBuffer()),
          contentType: contentType.split(";")[0] || "image/jpeg",
          sourceUrl: url,
          sourceLabel: options?.label ?? url,
        };
      }

      if (attempt < retries && (response.status === 429 || response.status >= 500)) {
        await sleep(1500 * attempt);
        continue;
      }

      return null;
    } catch {
      if (timeout) clearTimeout(timeout);
      if (attempt < retries) {
        await sleep(1000 * attempt);
        continue;
      }
      return null;
    }
  }

  return null;
}

async function fetchCurrentHeroAsset(place: PlaceRow): Promise<RemoteAsset | null> {
  const raw = clean(place.heroImageUrl);
  if (!raw) return null;

  const googlePhotoResource = extractGooglePhotoResourceName(raw);
  if (googlePhotoResource) {
    const apiKey = clean(process.env.GOOGLE_PLACES_API_KEY || process.env.GOOGLE_MAPS_API_KEY);
    if (!apiKey) return null;
    const url = new URL(buildGooglePhotoMediaUrl(googlePhotoResource, 1600));
    url.searchParams.set("key", apiKey);
    return fetchImageWithRetries(url.toString(), {
      headers: { "X-Goog-Api-Key": apiKey },
      label: `existing-google-hero:${place.id}`,
      retries: 2,
    });
  }

  return fetchImageWithRetries(raw, {
    label: `existing-hero:${place.id}`,
    retries: /wikimedia/i.test(raw) ? 4 : 3,
  });
}

async function discoverReplacementAsset(baseUrl: string, place: PlaceRow): Promise<RemoteAsset | null> {
  for (const reloadRound of [0, 1, 2, 3]) {
    const response = await fetch(`${baseUrl}/api/places/${place.id}/hero-candidates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 12, reloadRound }),
      cache: "no-store",
    }).catch(() => null);

    if (!response?.ok) continue;

    const payload = (await response.json().catch(() => null)) as
      | { candidates?: Array<{ source?: string; url?: string; reason?: string }> }
      | null;
    const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];

    for (const candidate of candidates) {
      const url = clean(candidate.url);
      const source = clean(candidate.source).toLowerCase();
      if (!url || source === "google") continue;

      const asset = await fetchImageWithRetries(url, {
        label: clean(candidate.reason) || `candidate:${place.id}`,
        retries: /wikimedia/i.test(url) ? 4 : 3,
      });
      if (asset) return asset;
    }
  }

  return null;
}

function toHeroCandidatePlaceInput(place: PlaceRow): {
  id: number;
  name: string;
  type: HeroCandidatePlaceType;
  lat: number;
  lng: number;
  heroImageUrl: string | null;
} {
  return {
    id: place.id,
    name: place.name,
    type: place.type as HeroCandidatePlaceType,
    lat: place.lat,
    lng: place.lng,
    heroImageUrl: place.heroImageUrl,
  };
}

async function discoverReplacementAssetWithoutGoogle(place: PlaceRow): Promise<RemoteAsset | null> {
  for (const reloadRound of [0, 1, 2, 3, 4, 5]) {
    const candidates = await discoverHeroCandidates(toHeroCandidatePlaceInput(place), {
      googleKey: "",
      limit: 12,
      explorationLevel: reloadRound >= 4 ? 4 : reloadRound >= 2 ? 3 : 2,
      reloadRound,
    }).catch(() => []);

    for (const candidate of candidates) {
      if (candidate.source === "google") continue;
      const asset = await fetchImageWithRetries(candidate.url, {
        label: candidate.reason || `${candidate.source}:${place.id}`,
        retries: /wikimedia/i.test(candidate.url) ? 4 : 3,
      });
      if (asset) return asset;
    }
  }

  return null;
}

async function cacheHeroAsset(baseUrl: string, place: PlaceRow): Promise<boolean> {
  const asset =
    (await fetchCurrentHeroAsset(place)) ??
    (await discoverReplacementAssetWithoutGoogle(place)) ??
    (await discoverReplacementAsset(baseUrl, place));
  if (!asset) return false;

  const supabase = getSupabaseServerClient();
  const extension = extensionFromContentType(asset.contentType, asset.sourceUrl);
  const objectKey = `places/${place.id}/auto-hero-${Date.now()}.${extension}`;
  const upload = await supabase.storage.from(SUPABASE_BUCKET).upload(objectKey, asset.bytes, {
    contentType: asset.contentType,
    upsert: false,
  });

  if (upload.error) {
    throw new Error(`Supabase upload failed for place ${place.id}: ${upload.error.message}`);
  }

  const image = await prisma.image.create({
    data: {
      placeId: place.id,
      filename: objectKey,
    },
  });

  await prisma.place.update({
    where: { id: place.id },
    data: {
      thumbnailImageId: image.id,
      heroImageUrl: null,
      heroReason: `Cached local hero asset on ${new Date().toISOString().slice(0, 10)} from ${asset.sourceLabel}`,
    },
  });

  return true;
}

function inferCountry(place: PlaceRow, override?: Override): string {
  if (override?.country) return override.country;
  if (clean(place.sightCountry)) return clean(place.sightCountry);
  if (place.id === 1507 || place.lng > 3) return "Deutschland";
  return "France";
}

function inferRegion(place: PlaceRow, override?: Override): string | null {
  if (override?.region) return override.region;
  if (clean(place.sightRegion)) return clean(place.sightRegion);
  if (place.id === 1507) return "Mittelrhein";
  if (place.lat >= 48.9) return "Normandie";
  if (place.id === 1587) return "Nouvelle-Aquitaine";
  return "Bretagne";
}

function inferCategory(place: PlaceRow, override?: Override): string | null {
  if (override?.category) return override.category;
  if (clean(place.sightCategory)) return clean(place.sightCategory);

  const name = place.name.toLowerCase();
  if (name.includes("cemetery")) return "memorial";
  if (name.includes("beach")) return "memorial-coast";
  if (name.includes("phare")) return "lighthouse";
  if (name.includes("viewpoint")) return "viewpoint";
  if (name.includes("sentier")) return "coastal-trail";
  if (name.includes("route")) return "scenic-route";
  if (name.includes("port")) return "harbor";
  if (name.includes("ville close") || name.includes("altstadt")) return "historic-quarter";
  if (name.includes("pointe") || name.includes("cap")) return "headland-viewpoint";
  if (name.includes("cote") || name.includes("klippen")) return "coastal-landscape";
  return null;
}

function inferTags(place: PlaceRow, description: string, category: string | null, override?: Override): string[] {
  const base = [...(Array.isArray(place.sightTags) ? place.sightTags : []), ...(override?.tags ?? [])];
  const text = `${place.name} ${description} ${category ?? ""}`.toLowerCase();
  const tags = [...base];

  if (text.includes("coast") || text.includes("kueste") || text.includes("atlantik")) tags.push("coast");
  if (text.includes("panorama") || text.includes("blick")) tags.push("panorama");
  if (text.includes("cliff") || text.includes("klippe") || text.includes("steilkueste")) tags.push("cliffs");
  if (text.includes("lighthouse") || text.includes("leuchtturm") || text.includes("phare")) tags.push("lighthouse");
  if (text.includes("harbor") || text.includes("hafen") || text.includes("port")) tags.push("harbor");
  if (text.includes("altstadt") || text.includes("historic") || text.includes("ville close")) tags.push("historic quarter");
  if (text.includes("world war ii") || text.includes("d-day")) tags.push("world war ii");
  if (text.includes("memorial") || text.includes("gedenk")) tags.push("memorial");
  if (text.includes("trail") || text.includes("wander")) tags.push("trail");
  if (text.includes("route") || text.includes("strasse")) tags.push("scenic route");

  return unique(tags);
}

async function fetchPlacesByType(placeType: QualityPlaceType): Promise<PlaceRow[]> {
  return (await prisma.place.findMany({
    where: { type: placeType },
    select: {
      id: true,
      name: true,
      type: true,
      lat: true,
      lng: true,
      heroImageUrl: true,
      heroReason: true,
      heroScore: true,
      sightDescription: true,
      sightCategory: true,
      sightTags: true,
      sightRegion: true,
      sightCountry: true,
      thumbnailImageId: true,
    },
    orderBy: { id: "asc" },
  })) as Array<PlaceRow & { thumbnailImageId: number | null }>;
}

async function verifyHero(baseUrl: string, placeId: number) {
  const first = await fetch(`${baseUrl}/api/places/${placeId}/hero`, {
    method: "GET",
    redirect: "manual",
    cache: "no-store",
  }).catch(() => null);

  if (!first) {
    return { ok: false, status: null, location: null, contentType: null, usedPlaceholder: null };
  }

  const status = first.status;
  const location = clean(first.headers.get("location")) || null;
  const contentType = clean(first.headers.get("content-type")) || null;
  const usedPlaceholder = clean(first.headers.get("x-hero-used-placeholder")) || null;

  if (usedPlaceholder === "1") {
    return { ok: false, status, location, contentType, usedPlaceholder };
  }

  if (status >= 300 && status < 400) {
    if (!location || /hero-placeholder/i.test(location)) {
      return { ok: false, status, location, contentType, usedPlaceholder };
    }

    const next = await fetch(location, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "camping-portal-admin-quality-report/1.0",
      },
    }).catch(() => null);

    const nextType = clean(next?.headers.get("content-type")) || null;
    return {
      ok: Boolean(next?.ok) && nextType != null && nextType.toLowerCase().startsWith("image/"),
      status,
      location,
      contentType: nextType,
      usedPlaceholder,
    };
  }

  return {
    ok: first.ok && contentType != null && contentType.toLowerCase().startsWith("image/"),
    status,
    location,
    contentType,
    usedPlaceholder,
  };
}

export async function generatePlaceQualityReport(
  baseUrl: string,
  placeType: QualityPlaceType
): Promise<SightseeingQualityReport> {
  const places = await prisma.place.findMany({
    where: { type: placeType },
    select: {
      id: true,
      name: true,
      type: true,
      sightDescription: true,
      heroImageUrl: true,
      thumbnailImageId: true,
    },
    orderBy: { id: "asc" },
  });

  const failures: SightseeingQualityFailure[] = [];

  for (const place of places) {
    const description = clean(place.sightDescription);
    const descriptionLength = description.length;
    const descriptionOk = requiresDescription(placeType) ? descriptionLength >= DESCRIPTION_MIN_LENGTH : true;
    const hero = await verifyHero(baseUrl, place.id);

    if (!descriptionOk || !hero.ok) {
      failures.push({
        id: place.id,
        name: place.name,
        type: place.type as QualityPlaceType,
        descriptionOk,
        descriptionLength,
        heroOk: hero.ok,
        heroStatus: hero.status,
        heroLocation: hero.location,
        heroContentType: hero.contentType,
        heroUsedPlaceholder: hero.usedPlaceholder,
        thumbnailImageId: place.thumbnailImageId ?? null,
        heroImageUrl: clean(place.heroImageUrl) || null,
      });
    }
  }

  const missingDescription = failures.filter((item) => !item.descriptionOk).length;
  const brokenHero = failures.filter((item) => !item.heroOk).length;

  return {
    placeType,
    checkedAt: new Date().toISOString(),
    total: places.length,
    passed: places.length - failures.length,
    failed: failures.length,
    counts: {
      missingDescription,
      brokenHero,
    },
    failures,
  };
}

async function repairSightseeingMetadata(): Promise<Map<number, PlaceRow>> {
  const places = await fetchPlacesByType("SEHENSWUERDIGKEIT");

  for (const place of places) {
    const override = OVERRIDES[place.id];
    const currentDescription = clean(place.sightDescription);
    const description = currentDescription || override?.description || "";
    if (!description) continue;

    const category = inferCategory(place, override);
    const region = inferRegion(place, override);
    const country = inferCountry(place, override);
    const tags = inferTags(place, description, category, override);
    const rating = rateSightseeing({
      name: place.name,
      type: "SEHENSWUERDIGKEIT",
      description,
      category: category ?? undefined,
      tags,
      source: undefined,
      region: region ?? undefined,
      country,
    });

    await prisma.place.update({
      where: { id: place.id },
      data: {
        sightDescription: description,
        sightCategory: category,
        sightTags: tags,
        sightRegion: region,
        sightCountry: country,
        heroImageUrl: clean(place.heroImageUrl) || override?.heroImageUrl || null,
        heroReason:
          clean(place.heroImageUrl) || override?.heroImageUrl
            ? clean(place.heroReason) || clean(override?.heroReason) || place.heroReason || null
            : place.heroReason,
        heroScore:
          clean(place.heroImageUrl) || override?.heroImageUrl
            ? place.heroScore ?? override?.heroScore ?? rating.sightseeingTotalScore
            : place.heroScore,
        natureScore: rating.natureScore,
        architectureScore: rating.architectureScore,
        historyScore: rating.historyScore,
        uniquenessScore: rating.uniquenessScore,
        spontaneityScore: rating.spontaneityScore,
        calmScore: rating.calmScore,
        sightseeingTotalScore: rating.sightseeingTotalScore,
        sightRelevanceType: rating.sightRelevanceType,
        sightVisitModePrimary: rating.sightVisitModePrimary,
        sightVisitModeSecondary: rating.sightVisitModeSecondary,
        crowdRiskScore: rating.crowdRiskScore,
        bestVisitHint: rating.bestVisitHint,
        summaryWhyItMatches: rating.summaryWhyItMatches,
      },
    });
  }

  return new Map(places.map((place) => [place.id, place]));
}

async function refillFailedHeroImagesByType(
  baseUrl: string,
  placeType: QualityPlaceType,
  placeIds: number[]
): Promise<void> {
  const disableGoogleForRepair = placeType === "CAMPINGPLATZ" || placeType === "STELLPLATZ";

  if (disableGoogleForRepair) {
    return;
  }

  for (let index = 0; index < placeIds.length; index += HERO_AUTOFILL_BATCH_SIZE) {
    const batch = placeIds.slice(index, index + HERO_AUTOFILL_BATCH_SIZE);
    const params = new URLSearchParams({
      ids: batch.join(","),
      force: "1",
    });

    const request = new Request(`${baseUrl}/api/admin/hero-autofill?${params.toString()}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        types: [placeType],
        maxCandidatesPerPlace: 12,
        provider: "auto",
      }),
    });
    const response = await heroAutofillPost(request);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Hero autofill failed for ${placeType} batch ${batch.join(",")}: HTTP ${response.status}${body ? ` - ${body.slice(0, 400)}` : ""}`);
    }
  }
}

function clonePlaceForCaching(place: PlaceRow): PlaceRow {
  return { ...place, sightTags: Array.isArray(place.sightTags) ? [...place.sightTags] : [] };
}

function mergeLatestPlaces(
  current: Map<number, PlaceRow>,
  places: PlaceRow[]
): Map<number, PlaceRow> {
  const next = new Map(current);
  for (const place of places) {
    next.set(place.id, clonePlaceForCaching(place));
  }
  return next;
}

export async function generateSightseeingQualityReport(baseUrl: string): Promise<SightseeingQualityReport> {
  return generatePlaceQualityReport(baseUrl, "SEHENSWUERDIGKEIT");
}

export async function runPlaceQualityRepair(
  baseUrl: string,
  placeType: QualityPlaceType,
  maxAttempts = MAX_ATTEMPTS
): Promise<SightseeingQualityReport> {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const before = await generatePlaceQualityReport(baseUrl, placeType);
    if (before.failed === 0) {
      return before;
    }

    let placesById =
      placeType === "SEHENSWUERDIGKEIT"
        ? await repairSightseeingMetadata()
        : new Map((await fetchPlacesByType(placeType)).map((place) => [place.id, clonePlaceForCaching(place)]));
    const failedHeroIds = before.failures.filter((failure) => !failure.heroOk).map((failure) => failure.id);
    if (failedHeroIds.length > 0) {
      await refillFailedHeroImagesByType(baseUrl, placeType, failedHeroIds);
    }

    let after = await generatePlaceQualityReport(baseUrl, placeType);
    if (after.failed === 0) {
      return after;
    }

    placesById = mergeLatestPlaces(placesById, await fetchPlacesByType(placeType));
    const stillBrokenHeroIds = after.failures.filter((failure) => !failure.heroOk).map((failure) => failure.id);
    for (const placeId of stillBrokenHeroIds) {
      const place = placesById.get(placeId);
      if (!place) continue;
      await cacheHeroAsset(baseUrl, place).catch(() => false);
    }

    after = await generatePlaceQualityReport(baseUrl, placeType);
    if (after.failed === 0) {
      return after;
    }

    if (attempt === maxAttempts) {
      const remainingIds = after.failures.slice(0, 12).map((failure) => failure.id).join(",");
      throw new Error(
        `${placeType} quality check still failing after ${maxAttempts} attempts. ` +
          `Remaining failed=${after.failed}, brokenHero=${after.counts.brokenHero}, missingDescription=${after.counts.missingDescription}` +
          (remainingIds ? `, sampleIds=${remainingIds}` : "")
      );
    }
  }

  throw new Error(`${placeType} quality repair aborted unexpectedly.`);
}

export async function runSightseeingQualityRepair(baseUrl: string, maxAttempts = MAX_ATTEMPTS): Promise<SightseeingQualityReport> {
  return runPlaceQualityRepair(baseUrl, "SEHENSWUERDIGKEIT", maxAttempts);
}
