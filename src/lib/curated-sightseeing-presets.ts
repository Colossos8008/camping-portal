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
  canonicalSource?: string;
  canonicalSourceId?: string;
  wikidataId?: string;
  coordinateSource?: string;
  coordinateConfidence?: number;
  coordinateMode?: string;
  reviewState?: string;
  sourceNotes?: string;
  anchorNote?: string;
};

const CURATED_PRESET_DATA: Record<CuratedPresetKey, CuratedHighlightRow[]> = {
  "nievern-highlights": [
    { key: "deutsches-eck", name: "Deutsches Eck", lat: 50.367088, lng: 7.606152, category: "landmark", region: "koblenz", country: "Germany", description: "Berühmte Landmarke an der Landzunge am Zusammenfluss von Rhein und Mosel mit Kaiser-Wilhelm-Nationaldenkmal und großem Aussichtspunkt.", tags: ["rivers-confluence", "landmark", "national-monument", "major-viewpoint", "major-attraction"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Deutsches_Eck_Koblenz.jpg", coordinateMode: "VIEWPOINT", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q698646 | google=missing | osm=osm:node/29160745", wikidataId: "Q698646", canonicalSource: "wikidata", canonicalSourceId: "Q698646" },
    { key: "festung-ehrenbreitstein", name: "Festung Ehrenbreitstein", lat: 50.365253, lng: 7.613802, category: "fortress", region: "koblenz", country: "Germany", description: "Große preußische Hauptfestung über Rhein und Mosel, ikonische Landmarke mit Festungsarchitektur und Panoramablick.", tags: ["fortress", "major-fortress", "landmark", "iconic", "major-attraction", "unesco-context"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Festung_Ehrenbreitstein.jpg", coordinateMode: "COMPLEX_SITE", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q1438023 | google=missing | osm=osm:way/41737967", wikidataId: "Q1438023", canonicalSource: "wikidata", canonicalSourceId: "Q1438023" },
    { key: "seilbahn-koblenz", name: "Seilbahn Koblenz", lat: 50.36093, lng: 7.60756, category: "aerialway", region: "koblenz", country: "Germany", description: "Rheinseilbahn zwischen Konrad-Adenauer-Ufer und Festung Ehrenbreitstein.", tags: ["tourist-transport", "landmark", "rhine"] },
    { key: "altstadt-koblenz", name: "Altstadt Koblenz", lat: 50.358938, lng: 7.595986, category: "historic-quarter", region: "koblenz", country: "Germany", description: "Historisches Zentrum von Koblenz mit Altstadt-Gassen, Plätzen und bedeutenden Baudenkmalen als klarer Haupt-Anziehungspunkt. Als belastbarer Karten-Anker wird hier der Jesuitenplatz als zentraler, gut auffindbarer Altstadtpunkt verwendet, da die Altstadt selbst kein einzelnes punktförmiges Ziel ist.", tags: ["old-town", "historic-center", "historic-quarter", "monument-ensemble", "major-attraction"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/M%C3%BCnzplatz_Koblenz_2015.jpg", coordinateMode: "AREA_ANCHOR", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q1045186 | google=missing | osm=osm:way/34401166 | anchor=Altstadt ist eine Fläche; als stabiler Ankerpunkt wird Jesuitenplatz genutzt (kein Fake-Exaktpunkt).", anchorNote: "Altstadt ist eine Fläche; als stabiler und sichtbarer Anker wird das Platzzentrum Jesuitenplatz genutzt.", wikidataId: "Q1045186", canonicalSource: "wikidata", canonicalSourceId: "Q1045186" },
    { key: "schloss-stolzenfels", name: "Schloss Stolzenfels", lat: 50.303626, lng: 7.571243, category: "castle", region: "koblenz", country: "Germany", description: "Markantes Rhein-Schloss (Palace/Schloss) der Rheinromantik mit Aussichtslage über dem Tal.", tags: ["castle", "schloss", "palace", "landmark", "major-viewpoint"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Schloss_Stolzenfels.jpg", coordinateMode: "COMPLEX_SITE", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q694322 | google=missing | osm=osm:way/100863980", wikidataId: "Q694322", canonicalSource: "wikidata", canonicalSourceId: "Q694322" },
    { key: "kurfuerstliches-schloss-koblenz", name: "Kurfürstliches Schloss Koblenz", lat: 50.350853, lng: 7.603035, category: "palace", region: "koblenz", country: "Germany", description: "Klassizistisches Schloss am Rhein mit bedeutender Stadtbildwirkung.", tags: ["palace", "historic", "rhine"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Kurf%C3%BCrstliches_Schloss_Koblenz.jpg", coordinateMode: "COMPLEX_SITE", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q2309636 | google=missing | osm=osm:way/38920860", wikidataId: "Q2309636", canonicalSource: "wikidata", canonicalSourceId: "Q2309636" },
    { key: "marksburg", name: "Marksburg", lat: 50.274444, lng: 7.641706, category: "castle", region: "braubach", country: "Germany", description: "Ikonische mittelalterliche Höhenburg am Mittelrhein, als nahezu vollständig erhaltene Burganlage ein Hauptziel der Region.", tags: ["castle", "medieval-castle", "iconic-castle", "landmark", "major-attraction"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Marksburg.jpg", coordinateMode: "COMPLEX_SITE", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q689959 | google=missing | osm=osm:way/131570312", wikidataId: "Q689959", canonicalSource: "wikidata", canonicalSourceId: "Q689959" },
    { key: "abtei-maria-laach", name: "Abtei Maria Laach", lat: 50.41604, lng: 7.27445, category: "abbey", region: "maria-laach", country: "Germany", description: "Bedeutende romanische Benediktinerabtei mit Basilika und Klostertradition am Laacher See.", tags: ["abbey", "monastery", "basilica", "pilgrimage", "major-attraction"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Abtei_Maria_Laach.jpg" },
    { key: "burg-lahneck", name: "Burg Lahneck", lat: 50.311813, lng: 7.618236, category: "castle", region: "lahnstein", country: "Germany", description: "Mittelalterliche Burganlage oberhalb der Lahnmündung mit markantem Landmarken-Charakter.", tags: ["castle", "medieval-castle", "landmark", "major-viewpoint", "rhine"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Burg_Lahneck.jpg", coordinateMode: "COMPLEX_SITE", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q1011657 | google=missing | osm=osm:way/136573940", wikidataId: "Q1011657", canonicalSource: "wikidata", canonicalSourceId: "Q1011657" },
    { key: "schloss-sayn", name: "Schloss Sayn", lat: 50.437428, lng: 7.576671, category: "palace", region: "bendorf", country: "Germany", description: "Neugotisches Schloss der Fürsten zu Sayn-Wittgenstein-Sayn.", tags: ["palace", "neo-gothic", "bendorf"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Schloss_Sayn.jpg", coordinateMode: "COMPLEX_SITE", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q2246760 | google=missing | osm=osm:way/65464883", wikidataId: "Q2246760", canonicalSource: "wikidata", canonicalSourceId: "Q2246760" },
    { key: "basilika-st-kastor", name: "Basilika St. Kastor", lat: 50.362227399999995, lng: 7.6044446, category: "church", region: "koblenz", country: "Germany", description: "Eine der ältesten Kirchen von Koblenz direkt am Deutschen Eck.", tags: ["church", "romanesk", "historic"] },
    { key: "liebfrauenkirche-koblenz", name: "Liebfrauenkirche Koblenz", lat: 50.35979, lng: 7.59574, category: "church", region: "koblenz", country: "Germany", description: "Prägende Pfarrkirche in der Koblenzer Altstadt mit Zwiebeltürmen.", tags: ["church", "old-town", "landmark"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Liebfrauenkirche_Koblenz_2013.jpg", coordinateMode: "EXACT", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q1821008 | google=missing | osm=osm:way/153896915", wikidataId: "Q1821008", canonicalSource: "wikidata", canonicalSourceId: "Q1821008" },
    { key: "florinskirche-koblenz", name: "Florinskirche Koblenz", lat: 50.36019, lng: 7.59628, category: "church", region: "koblenz", country: "Germany", description: "Historische Kirche am Florinsmarkt, Teil des markanten Altstadt-Ensembles.", tags: ["church", "historic-center"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Florinskirche_Koblenz.jpg", coordinateMode: "EXACT", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q1428776 | google=missing | osm=osm:way/106344917", wikidataId: "Q1428776", canonicalSource: "wikidata", canonicalSourceId: "Q1428776" },
    { key: "schaengelbrunnen", name: "Schängelbrunnen", lat: 50.36027, lng: 7.59645, category: "monument", region: "koblenz", country: "Germany", description: "Bekannter Koblenzer Brunnen am Rathaus mit der Schängel-Figur.", tags: ["monument", "old-town", "city-symbol"] },
    { key: "historiensaeule-koblenz", name: "Historiensäule Koblenz", lat: 50.35993, lng: 7.59599, category: "monument", region: "koblenz", country: "Germany", description: "Säulendenkmal mit Szenen aus der Koblenzer Stadtgeschichte.", tags: ["monument", "history", "old-town"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Historiens%C3%A4ule_Koblenz_2011.jpg", coordinateMode: "EXACT", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q1585197 | google=missing | osm=osm:node/3787909778", wikidataId: "Q1585197", canonicalSource: "wikidata", canonicalSourceId: "Q1585197" },
    { key: "jesuitenplatz", name: "Jesuitenplatz", lat: 50.358938, lng: 7.595986, category: "historic-square", region: "koblenz", country: "Germany", description: "Zentraler historischer Platz in der Altstadt, geprägt durch Rathaus und Jesuitenensemble.", tags: ["square", "historic-center", "old-town"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Jesuitenplatz_Koblenz_2012.jpg", coordinateMode: "AREA_ANCHOR", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q61788631 | google=missing | osm=osm:way/34401166", wikidataId: "Q61788631", canonicalSource: "wikidata", canonicalSourceId: "Q61788631" },
    { key: "ludwig-museum-koblenz", name: "Ludwig Museum Koblenz", lat: 50.3627774, lng: 7.605001699999999, category: "museum", region: "koblenz", country: "Germany", description: "Renommiertes Museum für zeitgenössische Kunst direkt am Deutschen Eck.", tags: ["museum", "art", "deutsches-eck"] },
    { key: "mittelrhein-museum", name: "Mittelrhein-Museum", lat: 50.3564, lng: 7.5958, category: "museum", region: "koblenz", country: "Germany", description: "Bedeutendes Regionalmuseum im Forum Confluentes.", tags: ["museum", "mittelrhein", "history"] },
    { key: "db-museum-koblenz", name: "DB Museum Koblenz", lat: 50.3506, lng: 7.5884, category: "museum", region: "koblenz", country: "Germany", description: "Große Eisenbahn-Sammlung mit historischen Lokomotiven auf dem Moselweiß-Areal.", tags: ["museum", "railway", "technology"] },
    { key: "sayner-huette", name: "Sayner Hütte", lat: 50.4392, lng: 7.5762, category: "industrial-heritage", region: "bendorf", country: "Germany", description: "Industriedenkmal mit historischer Gießhalle und Besucherzentrum.", tags: ["industrial-heritage", "museum", "bendorf"] },
    { key: "garten-der-schmetterlinge-sayn", name: "Garten der Schmetterlinge Schloss Sayn", lat: 50.436574, lng: 7.577309, category: "park", region: "bendorf", country: "Germany", description: "Bekannte Schmetterlingshalle und Parkanlage im Schlosspark Sayn.", tags: ["park", "family-highlight", "sayn"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Garten_der_Schmetterlinge_Sayn.jpg", coordinateMode: "EXACT", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q55257790 | google=missing | osm=osm:way/48838749", wikidataId: "Q55257790", canonicalSource: "wikidata", canonicalSourceId: "Q55257790" },
    { key: "burg-rheineck", name: "Burg Rheineck", lat: 50.4633, lng: 7.2615, category: "castle", region: "bad-breisig", country: "Germany", description: "Markante Rheinburg bei Bad Breisig.", tags: ["castle", "rhine", "viewpoint"] },
    { key: "geysir-andernach", name: "Geysir Andernach", lat: 50.434896, lng: 7.404471, category: "natural-attraction", region: "andernach", country: "Germany", description: "Höchster Kaltwassergeysir der Welt als geothermisches Natur-Highlight und klarer Ausflugsmagnet bei Andernach.", tags: ["geysir", "geyser", "geothermal", "natural-attraction", "major-attraction"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Geysir_Andernach.jpg", coordinateMode: "VIEWPOINT", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q699893 | google=missing | osm=osm:node/2604143031 | anchor=Besuchspunkt (Visitor-/Boots-Start) statt Objektpunkt in der Naturschutzfläche.", wikidataId: "Q699893", canonicalSource: "wikidata", canonicalSourceId: "Q699893" },
    { key: "roemerbergwerk-meurin", name: "Römerbergwerk Meurin", lat: 50.3921, lng: 7.4103, category: "archaeological-site", region: "kretz", country: "Germany", description: "Freigelegtes antikes Tuffstein-Bergwerk mit Erlebniszentrum.", tags: ["roman", "archaeology", "museum"] },
    { key: "vierseenblick-boppard", name: "Vierseenblick Boppard", lat: 50.2287, lng: 7.5973, category: "viewpoint", region: "boppard", country: "Germany", description: "Berühmter Aussichtspunkt auf die Rheinschleifen bei Boppard.", tags: ["viewpoint", "rhine", "landscape"] },
    { key: "burg-rheinfels", name: "Burg Rheinfels", lat: 50.1452, lng: 7.7154, category: "castle-ruin", region: "st-goar", country: "Germany", description: "Große Burgruine oberhalb von St. Goar mit Festungsresten.", tags: ["ruins", "castle", "mittelrhein"] },
    { key: "niederwalddenkmal", name: "Niederwalddenkmal", lat: 49.9871, lng: 7.8981, category: "monument", region: "ruedesheim", country: "Germany", description: "Nationaldenkmal über Rüdesheim mit ikonischer Aussicht ins Rheintal.", tags: ["monument", "rhine", "landmark"] },
    { key: "kurpark-bad-ems", name: "Kurpark Bad Ems", lat: 50.3347, lng: 7.7158, category: "historic-park", region: "bad-ems", country: "Germany", description: "Historische Kuranlagen im UNESCO-Welterbe Great Spa Towns of Europe.", tags: ["spa-town", "park", "unesco"] },
    { key: "kurhaus-bad-ems", name: "Kurhaus Bad Ems", lat: 50.335515, lng: 7.713234, category: "historic-building", region: "bad-ems", country: "Germany", description: "Klassisches Kurhaus am Lahnufer, prägender Bau der Bäderarchitektur.", tags: ["spa-town", "historic", "architecture"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Kurhaus_Bad_Ems.jpg", coordinateMode: "EXACT", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q19865440 | google=missing | osm=osm:way/36908904", wikidataId: "Q19865440", canonicalSource: "wikidata", canonicalSourceId: "Q19865440" },
    { key: "kloster-arnstein", name: "Kloster Arnstein", lat: 50.33488, lng: 7.86487, category: "monastery", region: "obernhof", country: "Germany", description: "Ehemaliges Prämonstratenserkloster auf einem Lahnfelsen nahe Obernhof.", tags: ["monastery", "lahn", "historic"] },
    { key: "burg-eltz", name: "Burg Eltz", lat: 50.205422, lng: 7.336593, category: "castle", region: "wierschem", country: "Germany", description: "International ikonische mittelalterliche Burg (Burg Eltz) im Elzbachtal, eines der bekanntesten Hauptziele der Region.", tags: ["castle", "medieval-castle", "iconic-castle", "landmark", "major-attraction"], heroImageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Burg_Eltz.jpg", coordinateMode: "COMPLEX_SITE", coordinateSource: "nominatim-osm", coordinateConfidence: 0.70, reviewState: "MANUAL_REVIEW", sourceNotes: "wikidata=Q668160 | google=missing | osm=osm:way/27019170", wikidataId: "Q668160", canonicalSource: "wikidata", canonicalSourceId: "Q668160" },
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
    canonicalSource: row.canonicalSource,
    canonicalSourceId: row.canonicalSourceId,
    wikidataId: row.wikidataId,
    coordinateSource: row.coordinateSource,
    coordinateConfidence: row.coordinateConfidence,
    coordinateMode: row.coordinateMode,
    suggestedReviewState: row.reviewState,
    suggestedReviewReason: [row.sourceNotes, row.anchorNote].filter(Boolean).join(" | ") || undefined,
  }));
}

export function listCuratedPresetKeys(): string[] {
  return Object.keys(CURATED_PRESET_DATA);
}
