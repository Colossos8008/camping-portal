import "dotenv/config";

import { createClient } from "@supabase/supabase-js";
import { prisma } from "../src/lib/prisma.ts";
import { buildGooglePhotoMediaUrl, extractGooglePhotoResourceName } from "../src/lib/hero-image.ts";
import { rateSightseeing } from "../src/lib/sightseeing-rating.ts";

type PlaceRow = {
  id: number;
  name: string;
  type: "SEHENSWUERDIGKEIT";
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

type VerifyFailure = {
  id: number;
  name: string;
  descriptionOk: boolean;
  heroOk: boolean;
  heroStatus: number | null;
  heroLocation: string | null;
  heroContentType: string | null;
  heroUsedPlaceholder: string | null;
};

type RemoteAsset = {
  bytes: Uint8Array;
  contentType: string;
  sourceUrl: string;
  sourceLabel: string;
};

const BASE_URL = String(process.env.SIGHTSEEING_QUALITY_BASE_URL ?? "http://127.0.0.1:3000").replace(/\/+$/, "");
const DESCRIPTION_MIN_LENGTH = 48;
const MAX_ATTEMPTS = 3;
const SUPABASE_BUCKET = "place-images";

const OVERRIDES: Record<number, Override> = {
  1507: {
    description:
      "Privater Referenz- und Ausgangspunkt im Mittelrheintal, vor allem als persönlicher Basisort und organisatorischer Startpunkt relevant, nicht als klassische Sehenswürdigkeit.",
    category: "personal-base",
    tags: ["personal", "base", "reference point"],
    region: "Mittelrhein",
    country: "Deutschland",
  },
  1584: {
    description:
      "Dramatische Fels- und Brandungsküste auf der Halbinsel Quiberon mit rauen Atlantikpanoramen, Wanderwegen und besonders starker Naturkulisse.",
    category: "coastal-cliffs",
    tags: ["coast", "cliffs", "panorama", "atlantic", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1585: {
    description:
      "Spektakuläres Kap am Südende der Presqu'île de Crozon mit weiten Blicken über Heide, Klippen und offene Atlantikküste.",
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
      "Wilde, vom Atlantik geprägte Küstenlandschaft mit Felsen, Brandung und offenen Aussichtspunkten, besonders eindrucksvoll bei klarer Sicht und bewegter See.",
    heroImageUrl: "https://www.guide-charente-maritime.com/_bibli/annonces/12706/hd/cote-sauvage.jpg",
    heroReason: "Quality repair on 2026-03-20: selected stable coastal image for Côte Sauvage to replace placeholder hero.",
    heroScore: 72,
    category: "coastal-landscape",
    tags: ["coast", "atlantic", "panorama", "waves", "nature"],
    region: "Nouvelle-Aquitaine",
    country: "France",
  },
  1588: {
    description:
      "Berühmter D-Day-Landungsstrand in der Normandie mit weitem Küstenraum und starkem historischem Bezug zur alliierten Invasion von 1944.",
    category: "memorial-coast",
    tags: ["beach", "world war ii", "history", "memorial", "landmark"],
    region: "Normandie",
    country: "France",
  },
  1589: {
    description:
      "Eindrucksvoller Soldatenfriedhof oberhalb der Landungsküste mit klarer Achse, weitem Meerblick und großer Gedenk- und Geschichtswirkung.",
    category: "memorial",
    tags: ["cemetery", "world war ii", "history", "memorial", "landmark"],
    region: "Normandie",
    country: "France",
  },
  1590: {
    description:
      "Ikonischer Leuchtturm aus rosa Granit in Ploumanac'h, eingebettet in die markante Felslandschaft der Côte de Granit Rose.",
    category: "lighthouse",
    tags: ["lighthouse", "coast", "pink granite", "landmark", "panorama"],
    region: "Bretagne",
    country: "France",
  },
  1591: {
    description:
      "Berühmter Küstenort an der Côte de Granit Rose mit bizarren rosa Granitfelsen, kleinen Buchten und einem der markantesten Küstenbilder der Bretagne.",
    category: "coastal-landscape",
    tags: ["pink granite", "coast", "panorama", "landmark", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1592: {
    description:
      "Aussichtskap an der Presqu'île de Crozon mit markantem Felsbogen, steilen Klippen und weitem Blick über die wilde Küste.",
    category: "headland-viewpoint",
    tags: ["headland", "cliffs", "rock arch", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1593: {
    description:
      "Küstenaussichtspunkt bei Saint-Hernot auf der Halbinsel Crozon mit türkisfarbenem Wasser, steilen Hängen und Blick auf die Île Vierge.",
    heroImageUrl: "https://www.bretagne.com/sites/default/files/post/TopBM_Saint_Hernot_Guillaudeau.jpg",
    heroReason: "Quality repair on 2026-03-20: selected stable regional tourism image for Pointe de Saint-Hernot - Île Vierge.",
    heroScore: 70,
    category: "viewpoint",
    tags: ["viewpoint", "coast", "turquoise water", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1594: {
    description:
      "Panoramapunkt an der Côte Sauvage von Quiberon mit offenen Blicken über Brandung, Felsformationen und die raue Atlantikküste.",
    category: "viewpoint",
    tags: ["viewpoint", "coast", "atlantic", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1595: {
    description:
      "Markantes Kap im Finistère mit dramatischer Steilküste, weitem Atlantikblick und einer der eindrucksvollsten Küstenkulissen der Bretagne.",
    category: "headland-viewpoint",
    tags: ["headland", "cliffs", "atlantic", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1596: {
    description:
      "Charaktervolle Altstadt von Pont-Aven mit Granithäusern, Brücken über den Aven und starkem Bezug zur Künstlergeschichte des Ortes.",
    category: "historic-quarter",
    tags: ["old town", "architecture", "history", "river", "art"],
    region: "Bretagne",
    country: "France",
  },
  1597: {
    description:
      "Lebendiger Hafenbereich von Concarneau mit maritimer Atmosphäre, Blick auf die Ville Close und engem Bezug zur historischen Seestadt.",
    category: "historic-harbor",
    tags: ["harbor", "maritime", "historic quarter", "architecture", "coast"],
    region: "Bretagne",
    country: "France",
  },
  1598: {
    description:
      "Malerischer Hafen von Pont-Aven am Flusslauf des Aven mit ruhiger Uferstimmung, Brücken und typischem Bretagne-Ortsbild.",
    category: "harbor-riverside",
    tags: ["harbor", "river", "architecture", "village", "scenic"],
    region: "Bretagne",
    country: "France",
  },
  1599: {
    description:
      "Küstenhalbinsel bei Trégastel mit rosa Granitfelsen, Rundweg und abwechslungsreichen Blicken auf Meer, Buchten und Felsformationen.",
    heroImageUrl: "https://www.bouger-voyager.com/wp-content/uploads/2023/02/renote-ile.jpg",
    heroReason: "Quality repair on 2026-03-20: selected stable editorial photo for Presqu'île Renote to replace placeholder hero.",
    heroScore: 71,
    category: "coastal-peninsula",
    tags: ["peninsula", "pink granite", "coast", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1600: {
    description:
      "Szenische Küstenstraße entlang der wilden Atlantikküste mit wiederkehrenden Aussichtspunkten auf Brandung, Felsen und offene See.",
    category: "scenic-route",
    tags: ["scenic route", "coast", "atlantic", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1601: {
    description:
      "Berühmter Küstenwanderweg entlang der Rosa-Granit-Küste mit Felsformationen, Meerblick und besonders starken Außenperspektiven.",
    category: "coastal-trail",
    tags: ["trail", "coast", "pink granite", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
  1602: {
    description:
      "Aussichtspunkt an der Pointe du Raz mit Blick auf den Phare de la Vieille, offene See und eine der dramatischsten Küstenszenen im Finistère.",
    category: "viewpoint",
    tags: ["viewpoint", "lighthouse", "coast", "panorama", "nature"],
    region: "Bretagne",
    country: "France",
  },
};

function clean(value: string | null | undefined): string {
  return String(value ?? "").trim();
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
    return fetchImageWithRetries(buildGooglePhotoMediaUrl(googlePhotoResource, 1600), {
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

async function discoverReplacementAsset(place: PlaceRow): Promise<RemoteAsset | null> {
  for (const reloadRound of [0, 1, 2, 3]) {
    const response = await fetch(`${BASE_URL}/api/places/${place.id}/hero-candidates`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 12, reloadRound }),
    }).catch(() => null);

    if (!response?.ok) continue;

    const payload = (await response.json().catch(() => null)) as
      | { candidates?: Array<{ source?: string; url?: string; reason?: string }> }
      | null;
    const candidates = Array.isArray(payload?.candidates) ? payload!.candidates! : [];

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

async function cacheHeroAsset(place: PlaceRow): Promise<boolean> {
  const asset = (await fetchCurrentHeroAsset(place)) ?? (await discoverReplacementAsset(place));
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
      heroReason: `Cached local hero asset on 2026-03-20 from ${asset.sourceLabel}`,
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
  if (name.includes("côte") || name.includes("klippen")) return "coastal-landscape";
  return null;
}

function inferTags(place: PlaceRow, description: string, category: string | null, override?: Override): string[] {
  const base = [...(Array.isArray(place.sightTags) ? place.sightTags : []), ...(override?.tags ?? [])];
  const text = `${place.name} ${description} ${category ?? ""}`.toLowerCase();
  const tags = [...base];

  if (text.includes("coast") || text.includes("küste") || text.includes("atlantik")) tags.push("coast");
  if (text.includes("panorama") || text.includes("blick")) tags.push("panorama");
  if (text.includes("cliff") || text.includes("klippe") || text.includes("steilküste")) tags.push("cliffs");
  if (text.includes("lighthouse") || text.includes("leuchtturm") || text.includes("phare")) tags.push("lighthouse");
  if (text.includes("harbor") || text.includes("hafen") || text.includes("port")) tags.push("harbor");
  if (text.includes("altstadt") || text.includes("historic") || text.includes("ville close")) tags.push("historic quarter");
  if (text.includes("world war ii") || text.includes("d-day")) tags.push("world war ii");
  if (text.includes("memorial") || text.includes("gedenk")) tags.push("memorial");
  if (text.includes("trail") || text.includes("wander")) tags.push("trail");
  if (text.includes("route") || text.includes("straße")) tags.push("scenic route");

  return unique(tags);
}

async function verifyHero(placeId: number): Promise<{ ok: boolean; status: number | null; location: string | null; contentType: string | null; usedPlaceholder: string | null }> {
  const url = `${BASE_URL}/api/places/${placeId}/hero`;

  try {
    const first = await fetch(url, { method: "GET", redirect: "manual" });
    const status = first.status;
    const location = clean(first.headers.get("location")) || null;
    const contentType = clean(first.headers.get("content-type")) || null;
    const usedPlaceholder = clean(first.headers.get("x-hero-used-placeholder")) || null;

    if (usedPlaceholder === "1") {
      return { ok: false, status, location, contentType, usedPlaceholder };
    }

    if (status >= 300 && status < 400) {
      if (location && /hero-placeholder/i.test(location)) {
        return { ok: false, status, location, contentType, usedPlaceholder };
      }

      if (!location) {
        return { ok: false, status, location, contentType, usedPlaceholder };
      }

      const next = await fetch(location, { method: "GET", redirect: "follow" });
      const nextType = clean(next.headers.get("content-type")) || null;
      return {
        ok: next.ok && nextType != null && nextType.toLowerCase().startsWith("image/"),
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
  } catch {
    return { ok: false, status: null, location: null, contentType: null, usedPlaceholder: null };
  }
}

async function verifyAll(): Promise<{ total: number; failures: VerifyFailure[] }> {
  const places = await prisma.place.findMany({
    where: { type: "SEHENSWUERDIGKEIT" },
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
    },
    orderBy: { id: "asc" },
  });

  const failures: VerifyFailure[] = [];
  for (const place of places as PlaceRow[]) {
    const description = clean(place.sightDescription);
    const descriptionOk = description.length >= DESCRIPTION_MIN_LENGTH;
    const hero = await verifyHero(place.id);
    if (!descriptionOk || !hero.ok) {
      failures.push({
        id: place.id,
        name: place.name,
        descriptionOk,
        heroOk: hero.ok,
        heroStatus: hero.status,
        heroLocation: hero.location,
        heroContentType: hero.contentType,
        heroUsedPlaceholder: hero.usedPlaceholder,
      });
    }
  }

  return { total: places.length, failures };
}

async function repairFailures(): Promise<void> {
  const places = (await prisma.place.findMany({
    where: { type: "SEHENSWUERDIGKEIT" },
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
    },
    orderBy: { id: "asc" },
  })) as PlaceRow[];

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

    const nextHeroImageUrl = clean(place.heroImageUrl) || override?.heroImageUrl || null;
    const nextHeroReason = nextHeroImageUrl
      ? clean(place.heroReason) || clean(override?.heroReason) || place.heroReason || null
      : place.heroReason;

    const updateData = {
      sightDescription: description,
      sightCategory: category,
      sightTags: tags,
      sightRegion: region,
      sightCountry: country,
      heroImageUrl: nextHeroImageUrl,
      heroReason: nextHeroReason,
      heroScore: nextHeroImageUrl ? place.heroScore ?? override?.heroScore ?? rating.sightseeingTotalScore : place.heroScore,
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
    } as const;

    await prisma.place.update({
      where: { id: place.id },
      data: updateData,
    });
  }

  const verification = await verifyAll();
  const heroFailures = verification.failures.filter((failure) => !failure.heroOk);
  for (const failure of heroFailures) {
    const place = places.find((entry) => entry.id === failure.id);
    if (!place) continue;
    await cacheHeroAsset(place).catch(() => false);
  }
}

async function main(): Promise<void> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const before = await verifyAll();
    console.log(`Attempt ${attempt}: total=${before.total} failures=${before.failures.length}`);
    if (before.failures.length === 0) {
      return;
    }

    console.log(JSON.stringify(before.failures, null, 2));
    await repairFailures();

    const after = await verifyAll();
    console.log(`After repair ${attempt}: failures=${after.failures.length}`);
    if (after.failures.length === 0) {
      return;
    }

    if (attempt === MAX_ATTEMPTS) {
      console.error(JSON.stringify(after.failures, null, 2));
      throw new Error(`Sightseeing quality check still failing after ${MAX_ATTEMPTS} attempts.`);
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
