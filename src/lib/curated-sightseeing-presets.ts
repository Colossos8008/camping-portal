import type { SightseeingCandidate } from "./sightseeing-seed-import.ts";

type CuratedPresetKey = "nievern-highlights";

type CuratedHighlightRow = {
  key: string;
  name: string;
  lat: number;
  lng: number;
  category: string;
  region: string;
  country: string;
  description?: string;
  tags?: string[];
};

const CURATED_PRESET_DATA: Record<CuratedPresetKey, CuratedHighlightRow[]> = {
  "nievern-highlights": [
    { key: "deutsches-eck", name: "Deutsches Eck", lat: 50.3645, lng: 7.6066, category: "landmark", region: "koblenz", country: "Germany", description: "Berühmte Landzunge am Zusammenfluss von Rhein und Mosel mit Kaiser-Wilhelm-Denkmal.", tags: ["rivers:rhine-moselle", "landmark", "historic"] },
    { key: "festung-ehrenbreitstein", name: "Festung Ehrenbreitstein", lat: 50.369, lng: 7.6136, category: "fortress", region: "koblenz", country: "Germany", description: "Große preußische Festungsanlage über dem Rhein mit markanter Aussicht.", tags: ["fortress", "unesco-context", "museum"] },
    { key: "seilbahn-koblenz", name: "Seilbahn Koblenz", lat: 50.3594, lng: 7.6072, category: "aerialway", region: "koblenz", country: "Germany", description: "Rheinseilbahn zwischen Konrad-Adenauer-Ufer und Festung Ehrenbreitstein.", tags: ["tourist-transport", "landmark", "rhine"] },
    { key: "altstadt-koblenz", name: "Altstadt Koblenz", lat: 50.3609, lng: 7.5933, category: "historic-quarter", region: "koblenz", country: "Germany", description: "Historischer Stadtkern mit Plätzen, Gassen und vielen Baudenkmalen.", tags: ["old-town", "historic-center"] },
    { key: "schloss-stolzenfels", name: "Schloss Stolzenfels", lat: 50.3029, lng: 7.5723, category: "castle", region: "koblenz", country: "Germany", description: "Romantisches Rhein-Schloss oberhalb von Stolzenfels.", tags: ["castle", "rhine-romanticism"] },
    { key: "kurfuerstliches-schloss-koblenz", name: "Kurfürstliches Schloss Koblenz", lat: 50.3537, lng: 7.599, category: "palace", region: "koblenz", country: "Germany", description: "Klassizistisches Schloss am Rhein mit bedeutender Stadtbildwirkung.", tags: ["palace", "historic", "rhine"] },
    { key: "marksburg", name: "Marksburg", lat: 50.2746, lng: 7.6409, category: "castle", region: "braubach", country: "Germany", description: "Einzige nie zerstörte Höhenburg am Mittelrhein.", tags: ["castle", "mittelrhein", "landmark"] },
    { key: "abtei-maria-laach", name: "Abtei Maria Laach", lat: 50.4084, lng: 7.2729, category: "abbey", region: "maria-laach", country: "Germany", description: "Romanische Benediktinerabtei am Laacher See.", tags: ["abbey", "romanesk", "laacher-see"] },
    { key: "burg-lahneck", name: "Burg Lahneck", lat: 50.3012, lng: 7.6171, category: "castle", region: "lahnstein", country: "Germany", description: "Mittelalterliche Burg hoch über der Lahnmündung.", tags: ["castle", "lahn", "rhine"] },
    { key: "schloss-sayn", name: "Schloss Sayn", lat: 50.4372, lng: 7.5776, category: "palace", region: "bendorf", country: "Germany", description: "Neugotisches Schloss der Fürsten zu Sayn-Wittgenstein-Sayn.", tags: ["palace", "neo-gothic", "bendorf"] },
    { key: "basilika-st-kastor", name: "Basilika St. Kastor", lat: 50.3624, lng: 7.6041, category: "church", region: "koblenz", country: "Germany", description: "Eine der ältesten Kirchen von Koblenz direkt am Deutschen Eck.", tags: ["church", "romanesk", "historic"] },
    { key: "liebfrauenkirche-koblenz", name: "Liebfrauenkirche Koblenz", lat: 50.3599, lng: 7.5948, category: "church", region: "koblenz", country: "Germany", description: "Prägende Pfarrkirche in der Koblenzer Altstadt mit Zwiebeltürmen.", tags: ["church", "old-town", "landmark"] },
    { key: "florinskirche-koblenz", name: "Florinskirche Koblenz", lat: 50.3603, lng: 7.5955, category: "church", region: "koblenz", country: "Germany", description: "Historische Kirche am Florinsmarkt, Teil des markanten Altstadt-Ensembles.", tags: ["church", "historic-center"] },
    { key: "schaengelbrunnen", name: "Schängelbrunnen", lat: 50.3605, lng: 7.5959, category: "monument", region: "koblenz", country: "Germany", description: "Bekannter Koblenzer Brunnen am Rathaus mit der Schängel-Figur.", tags: ["monument", "old-town", "city-symbol"] },
    { key: "historiensaeule-koblenz", name: "Historiensäule Koblenz", lat: 50.3598, lng: 7.5965, category: "monument", region: "koblenz", country: "Germany", description: "Säulendenkmal mit Szenen aus der Koblenzer Stadtgeschichte.", tags: ["monument", "history", "old-town"] },
    { key: "jesuitenplatz", name: "Jesuitenplatz", lat: 50.3598, lng: 7.5958, category: "historic-square", region: "koblenz", country: "Germany", description: "Zentraler historischer Platz in der Altstadt, geprägt durch Rathaus und Jesuitenensemble.", tags: ["square", "historic-center", "old-town"] },
    { key: "ludwig-museum-koblenz", name: "Ludwig Museum Koblenz", lat: 50.3626, lng: 7.6059, category: "museum", region: "koblenz", country: "Germany", description: "Renommiertes Museum für zeitgenössische Kunst direkt am Deutschen Eck.", tags: ["museum", "art", "deutsches-eck"] },
    { key: "mittelrhein-museum", name: "Mittelrhein-Museum", lat: 50.3564, lng: 7.5958, category: "museum", region: "koblenz", country: "Germany", description: "Bedeutendes Regionalmuseum im Forum Confluentes.", tags: ["museum", "mittelrhein", "history"] },
    { key: "db-museum-koblenz", name: "DB Museum Koblenz", lat: 50.3506, lng: 7.5884, category: "museum", region: "koblenz", country: "Germany", description: "Große Eisenbahn-Sammlung mit historischen Lokomotiven auf dem Moselweiß-Areal.", tags: ["museum", "railway", "technology"] },
    { key: "sayner-huette", name: "Sayner Hütte", lat: 50.4392, lng: 7.5762, category: "industrial-heritage", region: "bendorf", country: "Germany", description: "Industriedenkmal mit historischer Gießhalle und Besucherzentrum.", tags: ["industrial-heritage", "museum", "bendorf"] },
    { key: "garten-der-schmetterlinge-sayn", name: "Garten der Schmetterlinge Schloss Sayn", lat: 50.4367, lng: 7.5772, category: "park", region: "bendorf", country: "Germany", description: "Bekannte Schmetterlingshalle und Parkanlage im Schlosspark Sayn.", tags: ["park", "family-highlight", "sayn"] },
    { key: "burg-rheineck", name: "Burg Rheineck", lat: 50.4633, lng: 7.2615, category: "castle", region: "bad-breisig", country: "Germany", description: "Markante Rheinburg bei Bad Breisig.", tags: ["castle", "rhine", "viewpoint"] },
    { key: "geysir-andernach", name: "Geysir Andernach", lat: 50.4336, lng: 7.4005, category: "natural-attraction", region: "andernach", country: "Germany", description: "Höchster Kaltwassergeysir der Welt im Naturschutzgebiet Namedyer Werth.", tags: ["geysir", "natural", "andernach"] },
    { key: "roemerbergwerk-meurin", name: "Römerbergwerk Meurin", lat: 50.3921, lng: 7.4103, category: "archaeological-site", region: "kretz", country: "Germany", description: "Freigelegtes antikes Tuffstein-Bergwerk mit Erlebniszentrum.", tags: ["roman", "archaeology", "museum"] },
    { key: "vierseenblick-boppard", name: "Vierseenblick Boppard", lat: 50.2287, lng: 7.5973, category: "viewpoint", region: "boppard", country: "Germany", description: "Berühmter Aussichtspunkt auf die Rheinschleifen bei Boppard.", tags: ["viewpoint", "rhine", "landscape"] },
    { key: "burg-rheinfels", name: "Burg Rheinfels", lat: 50.1452, lng: 7.7154, category: "castle-ruin", region: "st-goar", country: "Germany", description: "Große Burgruine oberhalb von St. Goar mit Festungsresten.", tags: ["ruins", "castle", "mittelrhein"] },
    { key: "niederwalddenkmal", name: "Niederwalddenkmal", lat: 49.9871, lng: 7.8981, category: "monument", region: "ruedesheim", country: "Germany", description: "Nationaldenkmal über Rüdesheim mit ikonischer Aussicht ins Rheintal.", tags: ["monument", "rhine", "landmark"] },
    { key: "kurpark-bad-ems", name: "Kurpark Bad Ems", lat: 50.3347, lng: 7.7158, category: "historic-park", region: "bad-ems", country: "Germany", description: "Historische Kuranlagen im UNESCO-Welterbe Great Spa Towns of Europe.", tags: ["spa-town", "park", "unesco"] },
    { key: "kurhaus-bad-ems", name: "Kurhaus Bad Ems", lat: 50.3357, lng: 7.7153, category: "historic-building", region: "bad-ems", country: "Germany", description: "Klassisches Kurhaus am Lahnufer, prägender Bau der Bäderarchitektur.", tags: ["spa-town", "historic", "architecture"] },
    { key: "kloster-arnstein", name: "Kloster Arnstein", lat: 50.3354, lng: 7.8662, category: "monastery", region: "obernhof", country: "Germany", description: "Ehemaliges Prämonstratenserkloster auf einem Lahnfelsen nahe Obernhof.", tags: ["monastery", "lahn", "historic"] },
    { key: "burg-eltz", name: "Burg Eltz", lat: 50.2003, lng: 7.3366, category: "castle", region: "wierschem", country: "Germany", description: "International bekannte Märchenburg im Elzbachtal.", tags: ["castle", "landmark", "moselle-region"] },
  ],
};

export function getCuratedPresetCandidates(preset: string): SightseeingCandidate[] {
  const key = preset.toLowerCase() as CuratedPresetKey;
  const rows = CURATED_PRESET_DATA[key];
  if (!rows) {
    throw new Error(`Unknown curated preset: ${preset}. Allowed: ${Object.keys(CURATED_PRESET_DATA).join(" | ")}`);
  }

  return rows.map((row) => ({
    sourceId: `curated:${key}:${row.key}`,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    category: row.category,
    tags: [
      `preset:${key}`,
      ...(row.tags ?? []),
    ],
    source: "curated-preset",
    sourceRegion: row.region,
    country: row.country,
    reason: row.description ?? `Curated highlight preset ${key}`,
  }));
}

export function listCuratedPresetKeys(): string[] {
  return Object.keys(CURATED_PRESET_DATA);
}
