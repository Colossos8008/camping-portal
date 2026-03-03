import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type HeroAction = "created" | "updated" | "skipped" | "error" | "would-create" | "would-update";

type HeroResult = {
  placeId: string;
  placeName: string;
  action: HeroAction;
  chosenUrl?: string;
  source?: "wikimedia";
  reason?: string;
};

type WikimediaCandidate = {
  title: string;
  url: string;
  width?: number;
  height?: number;
};

type PlaceRecord = {
  id: number;
  name: string;
  heroImageUrl: string | null;
};

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const FETCH_TIMEOUT_MS = 12000;
const CONCURRENCY = 4;

const BAD_FILENAME_HINTS = ["logo", "icon", "map", "flag", "coat", "emblem"];

function parseBody(value: unknown): { limit: number; force: boolean; dryRun: boolean } {
  if (!value || typeof value !== "object") {
    return { limit: DEFAULT_LIMIT, force: false, dryRun: false };
  }

  const raw = value as Record<string, unknown>;
  const limitValue = typeof raw.limit === "number" ? Math.floor(raw.limit) : DEFAULT_LIMIT;
  const force = raw.force === true;
  const dryRun = raw.dryRun === true;

  return {
    limit: Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(limitValue) ? limitValue : DEFAULT_LIMIT)),
    force,
    dryRun,
  };
}

async function fetchJson<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeFileTitle(raw: string): string {
  const cleaned = raw.trim().replace(/^File:/i, "").replaceAll("_", " ");
  return `File:${cleaned}`;
}

function isLikelyDecorative(filename: string): boolean {
  const lower = filename.toLowerCase();
  return BAD_FILENAME_HINTS.some((hint) => lower.includes(hint));
}

function scoreCandidate(candidate: WikimediaCandidate): number {
  const lower = candidate.title.toLowerCase();
  let score = 0;

  if (candidate.width && candidate.width >= 1200) {
    score += 5;
  } else if (candidate.width && candidate.width >= 900) {
    score += 2;
  }

  if (candidate.width && candidate.height && candidate.height > 0) {
    const ratio = candidate.width / candidate.height;
    if (ratio >= 1.2 && ratio <= 2.2) {
      score += 4;
    } else if (ratio > 1.0 && ratio < 2.6) {
      score += 1;
    }
  }

  if (isLikelyDecorative(lower)) {
    score -= 10;
  }

  return score;
}

async function findPageIdBySearch(placeName: string): Promise<number | null> {
  type SearchResponse = {
    query?: {
      search?: Array<{
        pageid?: number;
      }>;
    };
  };

  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", placeName);
  url.searchParams.set("format", "json");
  url.searchParams.set("utf8", "1");
  url.searchParams.set("srlimit", "5");
  url.searchParams.set("origin", "*");

  const data = await fetchJson<SearchResponse>(url.toString());
  const best = data.query?.search?.[0];
  return best?.pageid ?? null;
}

async function fetchRepresentativeFileTitle(pageId: number): Promise<string | null> {
  type PageImagesResponse = {
    query?: {
      pages?: Record<
        string,
        {
          pageimage?: string;
        }
      >;
    };
  };

  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "pageimages");
  url.searchParams.set("pageids", String(pageId));
  url.searchParams.set("piprop", "name");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const data = await fetchJson<PageImagesResponse>(url.toString());
  const page = data.query?.pages?.[String(pageId)];
  if (!page?.pageimage) {
    return null;
  }

  return normalizeFileTitle(page.pageimage);
}

async function fetchPageImageTitles(pageId: number): Promise<string[]> {
  type ImagesResponse = {
    query?: {
      pages?: Record<
        string,
        {
          images?: Array<{
            title?: string;
          }>;
        }
      >;
    };
  };

  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("prop", "images");
  url.searchParams.set("imlimit", "50");
  url.searchParams.set("pageids", String(pageId));
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const data = await fetchJson<ImagesResponse>(url.toString());
  const images = data.query?.pages?.[String(pageId)]?.images ?? [];

  return images
    .map((img) => img.title)
    .filter((title): title is string => typeof title === "string" && /^File:/i.test(title))
    .map((title) => normalizeFileTitle(title));
}

async function resolveCommonsImage(fileTitle: string): Promise<WikimediaCandidate | null> {
  type CommonsResponse = {
    query?: {
      pages?: Record<
        string,
        {
          imageinfo?: Array<{
            url?: string;
            width?: number;
            height?: number;
          }>;
          missing?: boolean;
        }
      >;
    };
  };

  const url = new URL("https://commons.wikimedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("titles", fileTitle);
  url.searchParams.set("prop", "imageinfo");
  url.searchParams.set("iiprop", "url|size");
  url.searchParams.set("format", "json");
  url.searchParams.set("origin", "*");

  const data = await fetchJson<CommonsResponse>(url.toString());
  const pages = data.query?.pages;
  if (!pages) {
    return null;
  }

  for (const page of Object.values(pages)) {
    if (page.missing) {
      continue;
    }

    const info = page.imageinfo?.[0];
    if (!info?.url) {
      continue;
    }

    return {
      title: fileTitle,
      url: info.url,
      width: info.width,
      height: info.height,
    };
  }

  return null;
}

async function findHeroFromWikimedia(placeName: string): Promise<{ candidate: WikimediaCandidate | null; reason?: string }> {
  const pageId = await findPageIdBySearch(placeName);
  if (!pageId) {
    return { candidate: null, reason: "No Wikipedia page found" };
  }

  const candidates: WikimediaCandidate[] = [];

  const representativeTitle = await fetchRepresentativeFileTitle(pageId);
  if (representativeTitle && !isLikelyDecorative(representativeTitle)) {
    const representative = await resolveCommonsImage(representativeTitle);
    if (representative) {
      candidates.push(representative);
    }
  }

  if (candidates.length === 0) {
    const titles = await fetchPageImageTitles(pageId);
    const uniqueTitles = Array.from(new Set(titles));

    for (const title of uniqueTitles) {
      if (isLikelyDecorative(title)) {
        continue;
      }

      const resolved = await resolveCommonsImage(title);
      if (resolved) {
        candidates.push(resolved);
      }

      if (candidates.length >= 10) {
        break;
      }
    }
  }

  if (candidates.length === 0) {
    return { candidate: null, reason: "No suitable Wikimedia Commons image" };
  }

  const best = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a))[0];
  return { candidate: best };
}

async function runWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(values.length);
  let cursor = 0;

  async function next() {
    for (;;) {
      const current = cursor;
      cursor += 1;

      if (current >= values.length) {
        return;
      }

      out[current] = await worker(values[current], current);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => next()));
  return out;
}

export async function POST(req: Request) {
  try {
    const body = parseBody(await req.json().catch(() => ({})));

    const places = (await prisma.place.findMany({
      take: body.limit,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        name: true,
        heroImageUrl: true,
      },
    })) as PlaceRecord[];

    const counts = { created: 0, updated: 0, skipped: 0, errors: 0 };

    const results = await runWithConcurrency(places, CONCURRENCY, async (place): Promise<HeroResult> => {
      if (place.heroImageUrl && !body.force) {
        counts.skipped += 1;
        return {
          placeId: String(place.id),
          placeName: place.name,
          action: "skipped",
          chosenUrl: place.heroImageUrl,
          source: "wikimedia",
          reason: "heroImageUrl already set",
        };
      }

      try {
        const found = await findHeroFromWikimedia(place.name);
        if (!found.candidate) {
          counts.skipped += 1;
          return {
            placeId: String(place.id),
            placeName: place.name,
            action: "skipped",
            source: "wikimedia",
            reason: found.reason ?? "No image found",
          };
        }

        const isUpdate = Boolean(place.heroImageUrl);
        const chosenUrl = found.candidate.url;

        if (body.dryRun) {
          if (isUpdate) {
            counts.updated += 1;
            return {
              placeId: String(place.id),
              placeName: place.name,
              action: "would-update",
              chosenUrl,
              source: "wikimedia",
              reason: "Dry run",
            };
          }

          counts.created += 1;
          return {
            placeId: String(place.id),
            placeName: place.name,
            action: "would-create",
            chosenUrl,
            source: "wikimedia",
            reason: "Dry run",
          };
        }

        await prisma.place.update({
          where: { id: place.id },
          data: { heroImageUrl: chosenUrl },
        });

        if (isUpdate) {
          counts.updated += 1;
          return {
            placeId: String(place.id),
            placeName: place.name,
            action: "updated",
            chosenUrl,
            source: "wikimedia",
          };
        }

        counts.created += 1;
        return {
          placeId: String(place.id),
          placeName: place.name,
          action: "created",
          chosenUrl,
          source: "wikimedia",
        };
      } catch (error: any) {
        counts.errors += 1;
        return {
          placeId: String(place.id),
          placeName: place.name,
          action: "error",
          source: "wikimedia",
          reason: error?.message ?? "Unexpected error",
        };
      }
    });

    return NextResponse.json({ counts, results }, { status: 200 });
  } catch (error: any) {
    return NextResponse.json(
      {
        counts: { created: 0, updated: 0, skipped: 0, errors: 1 },
        results: [],
        error: error?.message ?? "Unexpected error",
      },
      { status: 500 }
    );
  }
}
