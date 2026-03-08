const HERO_DEBUG_POI_NAMES = new Set([
  "Festung Ehrenbreitstein",
  "Marksburg",
  "Burg Lahneck",
  "Kurhaus Bad Ems",
  "Schloss Sayn",
]);

const HERO_DEBUG_POI_IDS = new Set([1353, 1330, 1355, 1350, 1333]);

export function isHeroDebugPoiName(name: string | null | undefined): boolean {
  return HERO_DEBUG_POI_NAMES.has(String(name ?? "").trim());
}

export function getHeroDebugPoiNames(): string[] {
  return Array.from(HERO_DEBUG_POI_NAMES.values());
}

export function isHeroDebugPoiId(id: number | null | undefined): boolean {
  return HERO_DEBUG_POI_IDS.has(Number(id));
}
