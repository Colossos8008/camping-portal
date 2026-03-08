const HERO_DEBUG_POI_NAMES = new Set([
  "Festung Ehrenbreitstein",
  "Marksburg",
  "Burg Lahneck",
  "Kurhaus Bad Ems",
  "Schloss Sayn",
]);

export function isHeroDebugPoiName(name: string | null | undefined): boolean {
  return HERO_DEBUG_POI_NAMES.has(String(name ?? "").trim());
}

export function getHeroDebugPoiNames(): string[] {
  return Array.from(HERO_DEBUG_POI_NAMES.values());
}

