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
  heroImageUrl?: string;
};

const CURATED_PRESET_DATA: Record<CuratedPresetKey, CuratedHighlightRow[]> = {
  "nievern-highlights": [
    { key: "deutsches-eck", name: "Deutsches Eck", lat: 50.36703, lng: 7.60650, category: "landmark", region: "koblenz", country: "Germany", description: "Berühmte Landmarke an der Landzunge am Zusammenfluss von Rhein und Mosel mit Kaiser-Wilhelm-Nationaldenkmal und großem Aussichtspunkt.", tags: ["rivers-confluence", "landmark", "national-monument", "major-viewpoint", "major-attraction"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Deutsches_Eck%2C_Koblenz.jpg" },
    { key: "festung-ehrenbreitstein", name: "Festung Ehrenbreitstein", lat: 50.36417, lng: 7.61564, category: "fortress", region: "koblenz", country: "Germany", description: "Große preußische Hauptfestung über Rhein und Mosel, ikonische Landmarke mit Festungsarchitektur und Panoramablick.", tags: ["fortress", "major-fortress", "landmark", "iconic", "major-attraction", "unesco-context"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Festung_Ehrenbreitstein.jpg" },
    { key: "seilbahn-koblenz", name: "Seilbahn Koblenz", lat: 50.36093, lng: 7.60756, category: "aerialway", region: "koblenz", country: "Germany", description: "Rheinseilbahn zwischen Konrad-Adenauer-Ufer und Festung Ehrenbreitstein.", tags: ["tourist-transport", "landmark", "rhine"] },
    { key: "altstadt-koblenz", name: "Altstadt Koblenz", lat: 50.35973, lng: 7.59644, category: "historic-quarter", region: "koblenz", country: "Germany", description: "Historisches Zentrum von Koblenz mit Altstadt-Gassen, Plätzen und bedeutenden Baudenkmalen als klarer Haupt-Anziehungspunkt. Als belastbarer Karten-Anker wird hier der Jesuitenplatz als zentraler, gut auffindbarer Altstadtpunkt verwendet, da die Altstadt selbst kein einzelnes punktförmiges Ziel ist.", tags: ["old-town", "historic-center", "historic-quarter", "monument-ensemble", "major-attraction"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/M%C3%BCnzplatz%2C_Koblenz.jpg" },
    { key: "schloss-stolzenfels", name: "Schloss Stolzenfels", lat: 50.30351, lng: 7.57138, category: "castle", region: "koblenz", country: "Germany", description: "Markantes Rhein-Schloss (Palace/Schloss) der Rheinromantik mit Aussichtslage über dem Tal.", tags: ["castle", "schloss", "palace", "landmark", "major-viewpoint"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Schloss_Stolzenfels.jpg" },
    { key: "kurfuerstliches-schloss-koblenz", name: "Kurfürstliches Schloss Koblenz", lat: 50.35183, lng: 7.60054, category: "palace", region: "koblenz", country: "Germany", description: "Klassizistisches Schloss am Rhein mit bedeutender Stadtbildwirkung.", tags: ["palace", "historic", "rhine"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Kurf%C3%BCrstliches_Schloss_Koblenz_2014.jpg" },
    { key: "marksburg", name: "Marksburg", lat: 50.27444, lng: 7.64173, category: "castle", region: "braubach", country: "Germany", description: "Ikonische mittelalterliche Höhenburg am Mittelrhein, als nahezu vollständig erhaltene Burganlage ein Hauptziel der Region.", tags: ["castle", "medieval-castle", "iconic-castle", "landmark", "major-attraction"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Marksburg.jpg" },
    { key: "abtei-maria-laach", name: "Abtei Maria Laach", lat: 50.41604, lng: 7.27445, category: "abbey", region: "maria-laach", country: "Germany", description: "Bedeutende romanische Benediktinerabtei mit Basilika und Klostertradition am Laacher See.", tags: ["abbey", "monastery", "basilica", "pilgrimage", "major-attraction"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Maria_Laach_Abtei.jpg" },
    { key: "burg-lahneck", name: "Burg Lahneck", lat: 50.31166, lng: 7.61843, category: "castle", region: "lahnstein", country: "Germany", description: "Mittelalterliche Burganlage oberhalb der Lahnmündung mit markantem Landmarken-Charakter.", tags: ["castle", "medieval-castle", "landmark", "major-viewpoint", "rhine"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Burg_Lahneck.jpg" },
    { key: "schloss-sayn", name: "Schloss Sayn", lat: 50.43739, lng: 7.57674, category: "palace", region: "bendorf", country: "Germany", description: "Neugotisches Schloss der Fürsten zu Sayn-Wittgenstein-Sayn.", tags: ["palace", "neo-gothic", "bendorf"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Schloss_Sayn.jpg" },
    { key: "basilika-st-kastor", name: "Basilika St. Kastor", lat: 50.36268, lng: 7.60500, category: "church", region: "koblenz", country: "Germany", description: "Eine der ältesten Kirchen von Koblenz direkt am Deutschen Eck.", tags: ["church", "romanesk", "historic"] },
    { key: "liebfrauenkirche-koblenz", name: "Liebfrauenkirche Koblenz", lat: 50.35927, lng: 7.59550, category: "church", region: "koblenz", country: "Germany", description: "Prägende Pfarrkirche in der Koblenzer Altstadt mit Zwiebeltürmen.", tags: ["church", "old-town", "landmark"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Liebfrauenkirche%2C_Koblenz.jpg" },
    { key: "florinskirche-koblenz", name: "Florinskirche Koblenz", lat: 50.36074, lng: 7.59641, category: "church", region: "koblenz", country: "Germany", description: "Historische Kirche am Florinsmarkt, Teil des markanten Altstadt-Ensembles.", tags: ["church", "historic-center"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Florinskirche%2C_Koblenz.jpg" },
    { key: "schaengelbrunnen", name: "Schängelbrunnen", lat: 50.3605, lng: 7.5959, category: "monument", region: "koblenz", country: "Germany", description: "Bekannter Koblenzer Brunnen am Rathaus mit der Schängel-Figur.", tags: ["monument", "old-town", "city-symbol"] },
    { key: "historiensaeule-koblenz", name: "Historiensäule Koblenz", lat: 50.35968, lng: 7.59634, category: "monument", region: "koblenz", country: "Germany", description: "Säulendenkmal mit Szenen aus der Koblenzer Stadtgeschichte.", tags: ["monument", "history", "old-town"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Historiens%C3%A4ule%2C_Koblenz.jpg" },
    { key: "jesuitenplatz", name: "Jesuitenplatz", lat: 50.35973, lng: 7.59644, category: "historic-square", region: "koblenz", country: "Germany", description: "Zentraler historischer Platz in der Altstadt, geprägt durch Rathaus und Jesuitenensemble.", tags: ["square", "historic-center", "old-town"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Jesuitenplatz%2C_Koblenz.jpg" },
    { key: "ludwig-museum-koblenz", name: "Ludwig Museum Koblenz", lat: 50.3626, lng: 7.6059, category: "museum", region: "koblenz", country: "Germany", description: "Renommiertes Museum für zeitgenössische Kunst direkt am Deutschen Eck.", tags: ["museum", "art", "deutsches-eck"] },
    { key: "mittelrhein-museum", name: "Mittelrhein-Museum", lat: 50.3564, lng: 7.5958, category: "museum", region: "koblenz", country: "Germany", description: "Bedeutendes Regionalmuseum im Forum Confluentes.", tags: ["museum", "mittelrhein", "history"] },
    { key: "db-museum-koblenz", name: "DB Museum Koblenz", lat: 50.3506, lng: 7.5884, category: "museum", region: "koblenz", country: "Germany", description: "Große Eisenbahn-Sammlung mit historischen Lokomotiven auf dem Moselweiß-Areal.", tags: ["museum", "railway", "technology"] },
    { key: "sayner-huette", name: "Sayner Hütte", lat: 50.4392, lng: 7.5762, category: "industrial-heritage", region: "bendorf", country: "Germany", description: "Industriedenkmal mit historischer Gießhalle und Besucherzentrum.", tags: ["industrial-heritage", "museum", "bendorf"] },
    { key: "garten-der-schmetterlinge-sayn", name: "Garten der Schmetterlinge Schloss Sayn", lat: 50.43661, lng: 7.57728, category: "park", region: "bendorf", country: "Germany", description: "Bekannte Schmetterlingshalle und Parkanlage im Schlosspark Sayn.", tags: ["park", "family-highlight", "sayn"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Garten_der_Schmetterlinge%2C_Sayn.jpg" },
    { key: "burg-rheineck", name: "Burg Rheineck", lat: 50.4633, lng: 7.2615, category: "castle", region: "bad-breisig", country: "Germany", description: "Markante Rheinburg bei Bad Breisig.", tags: ["castle", "rhine", "viewpoint"] },
    { key: "geysir-andernach", name: "Geysir Andernach", lat: 50.44686, lng: 7.45245, category: "natural-attraction", region: "andernach", country: "Germany", description: "Höchster Kaltwassergeysir der Welt als geothermisches Natur-Highlight und klarer Ausflugsmagnet bei Andernach.", tags: ["geysir", "geyser", "geothermal", "natural-attraction", "major-attraction"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Geysir_Andernach.jpg" },
    { key: "roemerbergwerk-meurin", name: "Römerbergwerk Meurin", lat: 50.3921, lng: 7.4103, category: "archaeological-site", region: "kretz", country: "Germany", description: "Freigelegtes antikes Tuffstein-Bergwerk mit Erlebniszentrum.", tags: ["roman", "archaeology", "museum"] },
    { key: "vierseenblick-boppard", name: "Vierseenblick Boppard", lat: 50.2287, lng: 7.5973, category: "viewpoint", region: "boppard", country: "Germany", description: "Berühmter Aussichtspunkt auf die Rheinschleifen bei Boppard.", tags: ["viewpoint", "rhine", "landscape"] },
    { key: "burg-rheinfels", name: "Burg Rheinfels", lat: 50.1452, lng: 7.7154, category: "castle-ruin", region: "st-goar", country: "Germany", description: "Große Burgruine oberhalb von St. Goar mit Festungsresten.", tags: ["ruins", "castle", "mittelrhein"] },
    { key: "niederwalddenkmal", name: "Niederwalddenkmal", lat: 49.9871, lng: 7.8981, category: "monument", region: "ruedesheim", country: "Germany", description: "Nationaldenkmal über Rüdesheim mit ikonischer Aussicht ins Rheintal.", tags: ["monument", "rhine", "landmark"] },
    { key: "kurpark-bad-ems", name: "Kurpark Bad Ems", lat: 50.3347, lng: 7.7158, category: "historic-park", region: "bad-ems", country: "Germany", description: "Historische Kuranlagen im UNESCO-Welterbe Great Spa Towns of Europe.", tags: ["spa-town", "park", "unesco"] },
    { key: "kurhaus-bad-ems", name: "Kurhaus Bad Ems", lat: 50.33552, lng: 7.71326, category: "historic-building", region: "bad-ems", country: "Germany", description: "Klassisches Kurhaus am Lahnufer, prägender Bau der Bäderarchitektur.", tags: ["spa-town", "historic", "architecture"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Kurhaus_Bad_Ems.jpg" },
    { key: "kloster-arnstein", name: "Kloster Arnstein", lat: 50.33488, lng: 7.86487, category: "monastery", region: "obernhof", country: "Germany", description: "Ehemaliges Prämonstratenserkloster auf einem Lahnfelsen nahe Obernhof.", tags: ["monastery", "lahn", "historic"] },
    { key: "burg-eltz", name: "Burg Eltz", lat: 50.20539, lng: 7.33660, category: "castle", region: "wierschem", country: "Germany", description: "International ikonische mittelalterliche Burg (Burg Eltz) im Elzbachtal, eines der bekanntesten Hauptziele der Region.", tags: ["castle", "medieval-castle", "iconic-castle", "landmark", "major-attraction"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Burg_Eltz.jpg" },
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
    heroImageUrl: row.heroImageUrl,
  }));
}

export function listCuratedPresetKeys(): string[] {
  return Object.keys(CURATED_PRESET_DATA);
}
