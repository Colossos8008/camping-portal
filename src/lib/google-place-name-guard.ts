export type GuardedPlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

const GENERIC_TOKENS = new Set([
  "the",
  "and",
  "der",
  "die",
  "das",
  "de",
  "du",
  "des",
  "la",
  "le",
  "les",
  "of",
  "am",
  "an",
  "route",
  "viewpoint",
  "lookout",
  "im",
  "in",
  "bei",
  "zum",
  "zur",
  "camping",
  "campingplatz",
  "campground",
  "campgrounds",
  "campsite",
  "rv",
  "park",
  "aire",
  "wohnmobil",
  "wohnmobilstellplatz",
  "stellplatz",
  "camper",
  "motorhome",
  "stopover",
  "tankstelle",
  "fuel",
  "station",
  "hvo",
]);

const EXACT_GENERIC_NAMES: Record<GuardedPlaceType, Set<string>> = {
  CAMPINGPLATZ: new Set(["campingplatz", "campground", "campsite", "rv park"]),
  STELLPLATZ: new Set(["wohnmobilstellplatz", "stellplatz", "rv park", "motorhome stopover"]),
  SEHENSWUERDIGKEIT: new Set(),
  HVO_TANKSTELLE: new Set(["tankstelle", "fuel station", "hvo tankstelle"]),
};

function normalize(value: string): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeMeaningful(value: string): string[] {
  return normalize(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !GENERIC_TOKENS.has(token));
}

export function extractGooglePlaceName(raw: string): string | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;

  const patterns = [
    /matched Google Place '([^']+)'/i,
    /Google Places '([^']+)'/i,
    /Google Place ([^;]+?)(?:;|$)/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    const candidateName = String(match?.[1] ?? "").trim();
    if (candidateName) return candidateName;
  }

  return null;
}

export function isExactGenericGooglePlaceName(placeType: GuardedPlaceType, candidateName: string): boolean {
  const normalizedName = normalize(candidateName);
  if (!normalizedName) return false;
  return EXACT_GENERIC_NAMES[placeType].has(normalizedName);
}

export function isSuspiciousGenericGooglePlaceMatch(input: {
  placeName: string;
  placeType: GuardedPlaceType;
  candidateName?: string | null;
  reason?: string | null;
  source?: string | null;
}): boolean {
  const source = String(input.source ?? "").trim().toLowerCase();
  const reason = String(input.reason ?? "").trim();
  const googleLike = source === "google" || /google place/i.test(reason);
  if (!googleLike) return false;

  const candidateName = String(input.candidateName ?? extractGooglePlaceName(reason) ?? "").trim();
  if (!candidateName) return false;
  if (!isExactGenericGooglePlaceName(input.placeType, candidateName)) return false;

  return tokenizeMeaningful(input.placeName).length > 0;
}
