export type HeroUrlValidationResult = {
  ok: boolean;
  status: number | null;
  contentType: string | null;
  finalUrl: string | null;
  error?: string;
};

function normalizeContentType(contentType: string | null): string {
  return String(contentType ?? "").toLowerCase().trim();
}

export function isValidHeroResponse(response: Response): { ok: boolean; contentType: string | null } {
  const contentType = response.headers.get("content-type");
  const normalized = normalizeContentType(contentType);
  if (!response.ok) return { ok: false, contentType };
  if (!normalized.startsWith("image/")) return { ok: false, contentType };
  if (normalized.startsWith("text/html") || normalized.includes("application/xhtml")) {
    return { ok: false, contentType };
  }
  return { ok: true, contentType };
}

export async function validateHeroUrl(url: string): Promise<HeroUrlValidationResult> {
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "image/*,*/*;q=0.8",
        "User-Agent": "camping-portal/curated-hero-validator",
      },
      cache: "no-store",
    });

    const { ok, contentType } = isValidHeroResponse(response);

    return {
      ok,
      status: response.status,
      contentType,
      finalUrl: response.url,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      contentType: null,
      finalUrl: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

