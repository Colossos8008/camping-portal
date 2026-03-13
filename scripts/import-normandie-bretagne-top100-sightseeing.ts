import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";
import { rateSightseeing } from "../src/lib/sightseeing-rating.ts";
import { discoverHeroCandidates } from "../src/lib/hero-candidates.ts";

type RegionName = "Normandie" | "Bretagne";

type CuratedSight = {
  name: string;
  query: string;
  region: RegionName;
  category: string;
  tags: string[];
  description: string;
};

type GooglePlaceSearchHit = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  types?: string[];
};

type ResolvedSight = CuratedSight & {
  lat: number;
  lng: number;
  googlePlaceId: string | null;
  formattedAddress: string | null;
  googleTypes: string[];
};

const GOOGLE_SEARCH_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const IMPORT_SOURCE = "curated-top100-fr";
const COUNTRY = "France";

function slugify(value: string): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function normalize(value: string): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenOverlap(a: string, b: string): number {
  const aa = new Set(normalize(a).split(" ").filter(Boolean));
  const bb = new Set(normalize(b).split(" ").filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let matches = 0;
  for (const token of aa) {
    if (bb.has(token)) matches += 1;
  }
  return matches / Math.max(aa.size, bb.size);
}

function pickGoogleApiKey(): string {
  const preferred = String(process.env.GOOGLE_PLACES_API_KEY ?? "").trim();
  if (preferred) return preferred;
  const fallback = String(process.env.GOOGLE_MAPS_API_KEY ?? "").trim();
  if (fallback) return fallback;
  throw new Error("Missing GOOGLE_PLACES_API_KEY / GOOGLE_MAPS_API_KEY");
}

async function searchGooglePlace(entry: CuratedSight, apiKey: string): Promise<ResolvedSight> {
  const res = await fetch(GOOGLE_SEARCH_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
      "x-goog-fieldmask": "places.id,places.displayName,places.formattedAddress,places.location,places.types",
    },
    body: JSON.stringify({
      textQuery: entry.query,
      languageCode: "fr",
      regionCode: "FR",
      maxResultCount: 5,
    }),
  });

  const raw = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`google search failed status=${res.status} query=${entry.query} body=${raw.slice(0, 300)}`);
  }

  const payload = (raw ? JSON.parse(raw) : {}) as { places?: GooglePlaceSearchHit[] };
  const places = Array.isArray(payload.places) ? payload.places : [];
  if (!places.length) {
    throw new Error(`no google result for query=${entry.query}`);
  }

  const ranked = places
    .map((hit) => {
      const name = String(hit.displayName?.text ?? "").trim();
      const address = String(hit.formattedAddress ?? "").trim();
      const text = `${name} ${address}`;
      const score =
        tokenOverlap(entry.name, text) * 100 +
        tokenOverlap(entry.query, text) * 70 +
        (normalize(address).includes(normalize(entry.region)) ? 20 : 0) +
        (normalize(address).includes("france") ? 8 : 0);
      return { hit, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = ranked[0]?.hit;
  const lat = Number(best?.location?.latitude);
  const lng = Number(best?.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new Error(`google result missing coordinates for query=${entry.query}`);
  }

  return {
    ...entry,
    lat,
    lng,
    googlePlaceId: String(best?.id ?? "").trim() || null,
    formattedAddress: String(best?.formattedAddress ?? "").trim() || null,
    googleTypes: Array.isArray(best?.types) ? best.types.filter((value) => typeof value === "string" && value.trim()) : [],
  };
}

async function upsertPlace(entry: ResolvedSight, apiKey: string) {
  const sightExternalId = `${IMPORT_SOURCE}:${slugify(entry.name)}`;
  const existing = await prisma.place.findFirst({
    where: {
      OR: [
        { sightExternalId },
        { name: entry.name, type: "SEHENSWUERDIGKEIT", sightRegion: entry.region, sightCountry: COUNTRY },
      ],
    },
    select: { id: true },
  });

  const rating = rateSightseeing({
    name: entry.name,
    type: "SEHENSWUERDIGKEIT",
    description: entry.description,
    category: entry.category,
    tags: [...entry.tags, ...entry.googleTypes],
    source: IMPORT_SOURCE,
    region: entry.region,
    country: COUNTRY,
    address: entry.formattedAddress ?? undefined,
  });

  const baseData = {
    name: entry.name,
    type: "SEHENSWUERDIGKEIT" as const,
    lat: entry.lat,
    lng: entry.lng,
    sightSource: IMPORT_SOURCE,
    sightExternalId,
    sightCategory: entry.category,
    sightDescription: entry.description,
    sightTags: [...new Set([...entry.tags, ...entry.googleTypes])],
    sightRegion: entry.region,
    sightCountry: COUNTRY,
    ...rating,
  };

  const place = existing
    ? await prisma.place.update({
        where: { id: existing.id },
        data: baseData,
        select: { id: true, name: true, heroImageUrl: true },
      })
    : await prisma.place.create({
        data: baseData,
        select: { id: true, name: true, heroImageUrl: true },
      });

  const heroCandidates = await discoverHeroCandidates(
    {
      id: place.id,
      name: entry.name,
      type: "SEHENSWUERDIGKEIT",
      lat: entry.lat,
      lng: entry.lng,
      heroImageUrl: place.heroImageUrl,
    },
    { googleKey: apiKey, limit: 8 }
  ).catch(() => []);

  const hero = heroCandidates[0] ?? null;
  const galleryUrls = [...new Set(heroCandidates.map((candidate) => String(candidate.url ?? "").trim()).filter(Boolean))].slice(0, 6);

  await prisma.place.update({
    where: { id: place.id },
    data: {
      heroImageUrl: hero?.url ?? place.heroImageUrl ?? null,
      heroScore: hero ? Math.round(hero.score) : null,
      heroReason: hero ? `Curated Normandie/Bretagne import: ${hero.reason}` : "Curated Normandie/Bretagne import without resolved hero candidate",
    },
  });

  await prisma.image.deleteMany({ where: { placeId: place.id } });
  if (galleryUrls.length) {
    await prisma.image.createMany({
      data: galleryUrls.map((url) => ({
        placeId: place.id,
        filename: url,
      })),
    });
  }

  return {
    id: place.id,
    name: entry.name,
    heroCount: galleryUrls.length,
    heroPicked: Boolean(hero?.url ?? place.heroImageUrl),
    totalScore: Math.round(rating.sightseeingTotalScore),
  };
}

const NORMANDIE: CuratedSight[] = [
  { name: "Mont-Saint-Michel", query: "Mont-Saint-Michel Normandie", region: "Normandie", category: "iconic-island-monastery", tags: ["iconic", "world heritage", "abbey", "medieval", "landmark"], description: "Ikonischer Klosterberg in der Bucht, UNESCO-Welterbe und eines der bekanntesten Wahrzeichen Frankreichs." },
  { name: "Abbaye du Mont-Saint-Michel", query: "Abbaye du Mont-Saint-Michel", region: "Normandie", category: "abbey", tags: ["abbey", "world heritage", "religious heritage", "history", "architecture"], description: "Berühmte Abtei mit spektakulärer Höhenlage und herausragender gotischer Architektur." },
  { name: "Mémorial de Caen", query: "Memorial de Caen", region: "Normandie", category: "memorial-museum", tags: ["memorial", "history", "world war ii", "museum"], description: "Eines der wichtigsten Geschichtsmuseen Frankreichs zum Zweiten Weltkrieg und zur Landung in der Normandie." },
  { name: "Château de Caen", query: "Chateau de Caen", region: "Normandie", category: "castle-fortress", tags: ["castle", "fortress", "medieval", "history"], description: "Große normannische Burganlage Wilhelms des Eroberers mit starkem Geschichtsbezug." },
  { name: "Abbaye aux Hommes", query: "Abbaye aux Hommes Caen", region: "Normandie", category: "abbey", tags: ["abbey", "religious heritage", "history", "architecture"], description: "Bedeutende romanische Klosteranlage in Caen mit engem Bezug zu Wilhelm dem Eroberer." },
  { name: "Abbaye aux Dames", query: "Abbaye aux Dames Caen", region: "Normandie", category: "abbey", tags: ["abbey", "religious heritage", "history", "architecture"], description: "Historische Abtei in Caen und ein wichtiger Baustein der normannischen Klosterlandschaft." },
  { name: "Tapisserie de Bayeux", query: "Musee de la Tapisserie de Bayeux", region: "Normandie", category: "museum", tags: ["museum", "medieval", "history", "iconic"], description: "Weltberühmte mittelalterliche Bildstickerei zur normannischen Eroberung Englands." },
  { name: "Cathédrale Notre-Dame de Bayeux", query: "Cathedrale Notre-Dame de Bayeux", region: "Normandie", category: "cathedral", tags: ["cathedral", "religious heritage", "history", "architecture"], description: "Monumentale Kathedrale mit großer historischer und architektonischer Bedeutung." },
  { name: "Omaha Beach", query: "Omaha Beach Normandie", region: "Normandie", category: "memorial-coast", tags: ["beach", "memorial", "world war ii", "history", "landmark"], description: "Berühmtester Landungsstrand des D-Day und zentraler Erinnerungsort der Normandie." },
  { name: "Cimetière américain de Colleville-sur-Mer", query: "Normandy American Cemetery Colleville-sur-Mer", region: "Normandie", category: "memorial", tags: ["memorial", "cemetery", "world war ii", "history"], description: "Eindrucksvoller Soldatenfriedhof oberhalb von Omaha Beach und bedeutender Gedenkort." },
  { name: "Pointe du Hoc", query: "Pointe du Hoc Normandie", region: "Normandie", category: "cliff-memorial", tags: ["cliff", "memorial", "world war ii", "history"], description: "Dramatische Klippenlandschaft und ikonischer D-Day-Schauplatz." },
  { name: "Musée du Débarquement Arromanches", query: "Musee du Debarquement Arromanches", region: "Normandie", category: "museum", tags: ["museum", "world war ii", "history", "landing"], description: "Zentrales Museum zur künstlichen Hafenanlage der alliierten Landung in Arromanches." },
  { name: "Arromanches 360", query: "Arromanches 360", region: "Normandie", category: "memorial-viewpoint", tags: ["memorial", "history", "world war ii", "panorama"], description: "Panoramastandort mit starkem D-Day-Bezug und weitem Blick über die Landungsküste." },
  { name: "Utah Beach Landing Museum", query: "Utah Beach Landing Museum", region: "Normandie", category: "museum", tags: ["museum", "world war ii", "history", "landing"], description: "Wichtiges Museum am Utah Beach zur amerikanischen Landung in der Normandie." },
  { name: "Airborne Museum Sainte-Mère-Église", query: "Airborne Museum Sainte Mere Eglise", region: "Normandie", category: "museum", tags: ["museum", "world war ii", "history", "airborne"], description: "Eines der bekanntesten Museen zur Luftlandung der Alliierten im Juni 1944." },
  { name: "Église de Sainte-Mère-Église", query: "Eglise Sainte Mere Eglise", region: "Normandie", category: "church", tags: ["church", "world war ii", "history", "landmark"], description: "Ikonische Kirche von Sainte-Mère-Église, eng verknüpft mit den Ereignissen der Luftlandung." },
  { name: "Pegasus Bridge", query: "Pegasus Bridge Normandie", region: "Normandie", category: "memorial-bridge", tags: ["bridge", "world war ii", "history", "landmark"], description: "Berühmte Brücke der ersten alliierten Kommandoaktion in der Nacht vor dem D-Day." },
  { name: "Falaises d'Étretat", query: "Falaises d'Etretat", region: "Normandie", category: "cliffs", tags: ["cliff", "coast", "panorama", "iconic", "natural attraction"], description: "Ikonische Kreidefelsen und eines der bekanntesten Naturmotive der Normandie." },
  { name: "Aiguille d'Étretat", query: "Aiguille Etretat", region: "Normandie", category: "coastal-landmark", tags: ["cliff", "coast", "landmark", "panorama"], description: "Berühmte Felsnadel vor Étretat und symbolisches Wahrzeichen der Alabasterküste." },
  { name: "Jardins d'Étretat", query: "Jardins d'Etretat", region: "Normandie", category: "garden-viewpoint", tags: ["garden", "panorama", "coast", "landmark"], description: "Panoramagärten oberhalb der Küste mit spektakulären Ausblicken auf Étretat." },
  { name: "Vieux Bassin Honfleur", query: "Vieux Bassin Honfleur", region: "Normandie", category: "historic-harbor", tags: ["historic quarter", "harbor", "architecture", "iconic"], description: "Malerischer alter Hafen von Honfleur mit dichtem Fachwerk- und Altstadtcharakter." },
  { name: "Église Sainte-Catherine de Honfleur", query: "Eglise Sainte Catherine Honfleur", region: "Normandie", category: "church", tags: ["church", "religious heritage", "architecture", "historic"], description: "Ungewöhnliche Holzkirche und eines der markantesten Bauwerke von Honfleur." },
  { name: "Pont de Normandie", query: "Pont de Normandie", region: "Normandie", category: "bridge-landmark", tags: ["bridge", "landmark", "architecture", "iconic"], description: "Großes Ingenieursbauwerk über die Seine-Mündung und modernes Wahrzeichen der Region." },
  { name: "Cathédrale Notre-Dame de Rouen", query: "Cathedrale Notre-Dame de Rouen", region: "Normandie", category: "cathedral", tags: ["cathedral", "religious heritage", "architecture", "history", "iconic"], description: "Berühmte gotische Kathedrale und eines der bedeutendsten Bauwerke Rouens." },
  { name: "Gros-Horloge Rouen", query: "Gros Horloge Rouen", region: "Normandie", category: "landmark-monument", tags: ["landmark", "historic quarter", "architecture", "iconic"], description: "Mittelalterliches Uhrtor und eines der bekanntesten Symbole der Rouener Altstadt." },
  { name: "Place du Vieux-Marché Rouen", query: "Place du Vieux Marche Rouen", region: "Normandie", category: "historic-square", tags: ["historic quarter", "history", "landmark"], description: "Historischer Platz im Herzen Rouens, eng mit Jeanne d’Arc verbunden." },
  { name: "Aître Saint-Maclou", query: "Aitre Saint-Maclou Rouen", region: "Normandie", category: "historic-site", tags: ["historic", "architecture", "history", "landmark"], description: "Außergewöhnlicher spätmittelalterlicher Komplex und einer der eindrucksvollsten Orte Rouens." },
  { name: "Abbaye de Jumièges", query: "Abbaye de Jumieges", region: "Normandie", category: "abbey-ruins", tags: ["abbey", "ruins", "history", "architecture", "iconic"], description: "Monumentale Klosterruine und eines der eindrucksvollsten mittelalterlichen Bauensembles der Normandie." },
  { name: "Église Saint-Joseph du Havre", query: "Eglise Saint Joseph Le Havre", region: "Normandie", category: "church-landmark", tags: ["church", "architecture", "landmark", "world heritage"], description: "Architektonische Ikone des wiederaufgebauten Le Havre und prägendes Wahrzeichen der Stadt." },
  { name: "MuMa Le Havre", query: "MuMa Le Havre", region: "Normandie", category: "museum", tags: ["museum", "art", "architecture"], description: "Bedeutendes Kunstmuseum am Hafen mit starker Verbindung zum Impressionismus." },
  { name: "Planches de Deauville", query: "Planches de Deauville", region: "Normandie", category: "seaside-landmark", tags: ["beach", "landmark", "iconic", "architecture"], description: "Berühmte Strandpromenade von Deauville und französische Ikone der Belle Époque-Seebäder." },
  { name: "Basilique Sainte-Thérèse de Lisieux", query: "Basilique Sainte Therese de Lisieux", region: "Normandie", category: "basilica", tags: ["basilica", "religious heritage", "pilgrimage", "landmark"], description: "Eine der wichtigsten Pilgerstätten Frankreichs mit markanter Monumentalarchitektur." },
  { name: "Château Gaillard", query: "Chateau Gaillard Les Andelys", region: "Normandie", category: "castle-ruins", tags: ["castle", "ruins", "history", "panorama"], description: "Spektakulär gelegene Burgruine hoch über der Seine und historischer Schlüsselort der Normandie." },
  { name: "Maison et jardins de Claude Monet", query: "Maison et jardins de Claude Monet Giverny", region: "Normandie", category: "garden-house", tags: ["garden", "art", "iconic", "landmark"], description: "Berühmtes Wohnhaus und Gartenensemble von Claude Monet in Giverny." },
  { name: "Musée des impressionnismes Giverny", query: "Musee des impressionnismes Giverny", region: "Normandie", category: "museum", tags: ["museum", "art", "impressionism"], description: "Wichtiger Anlaufpunkt für Impressionismus und Gartenkunst in Giverny." },
  { name: "Vieux-Moulin de Vernon", query: "Vieux Moulin Vernon", region: "Normandie", category: "historic-landmark", tags: ["landmark", "historic", "architecture"], description: "Charmantes Fachwerk-Wahrzeichen an der Seine und eines der bekanntesten Fotomotive von Vernon." },
  { name: "Roches d'Oëtre", query: "Roches d'Oetre", region: "Normandie", category: "viewpoint-nature", tags: ["viewpoint", "panorama", "nature", "cliff"], description: "Einer der schönsten Aussichtspunkte der Normandie mit weiten Blicken über die Suisse Normande." },
  { name: "Suisse Normande", query: "Suisse Normande", region: "Normandie", category: "natural-landscape", tags: ["nature", "valley", "panorama", "scenic"], description: "Markante Hügellandschaft mit Flusstälern, Felsen und weiten Panoramen." },
  { name: "Château Guillaume-le-Conquérant", query: "Chateau Guillaume le Conquerant Falaise", region: "Normandie", category: "castle", tags: ["castle", "history", "medieval", "iconic"], description: "Geburtsort Wilhelms des Eroberers und eine der bedeutendsten Burgen der Normandie." },
  { name: "Haras national du Pin", query: "Haras national du Pin", region: "Normandie", category: "historic-estate", tags: ["historic", "architecture", "landmark"], description: "Berühmtes Gestüt, oft als Versailles des Pferdes bezeichnet, mit klassischer Schloss- und Parkwirkung." },
  { name: "Cité médiévale de Domfront", query: "Cite medievale de Domfront", region: "Normandie", category: "historic-quarter", tags: ["historic quarter", "medieval", "history", "architecture"], description: "Mittelalterliche Höhenstadt mit Burgruine und geschlossenem Altstadtcharakter." },
  { name: "Bagnoles-de-l'Orne", query: "Bagnoles de l'Orne", region: "Normandie", category: "spa-town", tags: ["spa town", "historic park", "architecture", "landmark"], description: "Charmanter Kurort mit Belle-Époque-Architektur und klassischem Seepark." },
  { name: "Phare de Gatteville", query: "Phare de Gatteville", region: "Normandie", category: "lighthouse", tags: ["lighthouse", "coast", "landmark", "panorama"], description: "Einer der höchsten Leuchttürme Europas und markantes Küstenwahrzeichen des Cotentin." },
  { name: "Nez de Jobourg", query: "Nez de Jobourg", region: "Normandie", category: "cliff-headland", tags: ["cliff", "headland", "panorama", "coast", "natural attraction"], description: "Dramatisches Kap mit hohen Klippen und weitem Blick über den Ärmelkanal." },
  { name: "La Cité de la Mer", query: "La Cite de la Mer Cherbourg", region: "Normandie", category: "museum", tags: ["museum", "maritime", "history", "landmark"], description: "Großes maritimes Besucherzentrum in Cherbourg mit starkem Erlebnis- und Geschichtsbezug." },
  { name: "Île Tatihou", query: "Ile Tatihou", region: "Normandie", category: "island-fort", tags: ["island", "fortress", "coast", "history"], description: "Kleine Insel mit Vauban-Bezug, maritimer Geschichte und reizvoller Küstenlage." },
  { name: "Cap de la Hague", query: "Cap de la Hague", region: "Normandie", category: "headland", tags: ["headland", "coast", "panorama", "natural attraction"], description: "Raue und spektakuläre Küstenlandschaft im äußersten Nordwesten der Normandie." },
  { name: "Château de Carrouges", query: "Chateau de Carrouges", region: "Normandie", category: "castle", tags: ["castle", "architecture", "history"], description: "Elegantes Wasserschloss mit markanter Renaissance- und Backsteinarchitektur." },
  { name: "Basilique Notre-Dame de la Délivrande", query: "Basilique Notre Dame de la Delivrande", region: "Normandie", category: "basilica", tags: ["basilica", "religious heritage", "history", "architecture"], description: "Bedeutende Wallfahrtskirche der Normandie mit aufwendiger neugotischer Erscheinung." },
  { name: "Abbaye de Hambye", query: "Abbaye de Hambye", region: "Normandie", category: "abbey", tags: ["abbey", "history", "architecture", "ruins"], description: "Romantische Klosteranlage mit starker historischer Atmosphäre im normannischen Hinterland." },
];
const BRETAGNE: CuratedSight[] = [
  { name: "Saint-Malo Intra-Muros", query: "Saint Malo Intra Muros", region: "Bretagne", category: "historic-quarter", tags: ["historic quarter", "ramparts", "coast", "iconic"], description: "Berühmte ummauerte Hafenstadt und eines der ikonischsten Ziele der Bretagne." },
  { name: "Remparts de Saint-Malo", query: "Remparts de Saint Malo", region: "Bretagne", category: "ramparts", tags: ["ramparts", "fortress", "coast", "panorama"], description: "Mächtige Stadtmauern mit weitem Blick auf Meer, Strände und Altstadt." },
  { name: "Fort National Saint-Malo", query: "Fort National Saint Malo", region: "Bretagne", category: "fortress", tags: ["fortress", "coast", "history", "landmark"], description: "Vauban-Fort vor Saint-Malo und prägnantes Küstenmotiv." },
  { name: "Vieille ville de Dinan", query: "Vieille ville de Dinan", region: "Bretagne", category: "historic-quarter", tags: ["historic quarter", "medieval", "architecture", "iconic"], description: "Eine der schönsten mittelalterlichen Altstädte der Bretagne mit Fachwerk, Toren und Mauern." },
  { name: "Cap Fréhel", query: "Cap Frehel", region: "Bretagne", category: "headland", tags: ["headland", "cliff", "coast", "panorama", "iconic"], description: "Spektakuläres Kap mit hohen Klippen und weitem Blick über die Smaragdküste." },
  { name: "Fort La Latte", query: "Fort la Latte", region: "Bretagne", category: "fortress", tags: ["fortress", "castle", "coast", "panorama", "iconic"], description: "Dramatisch auf den Klippen gelegene Festung und eines der fotogensten Motive der Bretagne." },
  { name: "Île de Bréhat", query: "Ile de Brehat", region: "Bretagne", category: "island", tags: ["island", "coast", "scenic", "natural attraction"], description: "Berühmte Blumeninsel mit granitgeprägter Küstenlandschaft und maritimem Charme." },
  { name: "Abbaye de Beauport", query: "Abbaye de Beauport", region: "Bretagne", category: "abbey", tags: ["abbey", "coast", "history", "architecture"], description: "Küstennahe Abteiruine mit starker Atmosphäre und reizvoller Naturkulisse." },
  { name: "Côte de Granit Rose", query: "Cote de Granit Rose", region: "Bretagne", category: "coastal-landscape", tags: ["coast", "rocks", "panorama", "iconic", "natural attraction"], description: "Berühmte rosa Granitküste und eines der markantesten Naturpanoramen Frankreichs." },
  { name: "Phare de Ploumanac'h", query: "Phare de Ploumanach", region: "Bretagne", category: "lighthouse", tags: ["lighthouse", "coast", "rocks", "landmark"], description: "Berühmter Leuchtturm inmitten der rosa Granitfelsen von Ploumanac'h." },
  { name: "Sentier des Douaniers Ploumanac'h", query: "Sentier des Douaniers Ploumanach", region: "Bretagne", category: "coastal-trail", tags: ["coast", "panorama", "rocks", "scenic"], description: "Der schönste Küstenwanderweg der Rosa-Granit-Küste mit ständigem Meerblick." },
  { name: "Vallée des Saints", query: "Vallee des Saints Carnoet", region: "Bretagne", category: "monument-park", tags: ["monument", "landmark", "panorama", "unique"], description: "Außergewöhnlicher Skulpturenpark mit monumentalen Heiligenfiguren im bretonischen Hinterland." },
  { name: "Cairn de Barnenez", query: "Cairn de Barnenez", region: "Bretagne", category: "archaeological-site", tags: ["archaeological site", "megalith", "prehistoric", "history"], description: "Einer der bedeutendsten prähistorischen Monumentalbauten Europas." },
  { name: "Enclos paroissial de Saint-Thégonnec", query: "Enclos paroissial Saint Thegonnec", region: "Bretagne", category: "religious-complex", tags: ["church", "religious heritage", "history", "architecture"], description: "Berühmter bretonischer Pfarrbezirk mit reich ausgestatteter religiöser Architektur." },
  { name: "Océanopolis", query: "Oceanopolis Brest", region: "Bretagne", category: "museum", tags: ["museum", "maritime", "landmark"], description: "Großes Meereszentrum in Brest und einer der bekanntesten Familien- und Bildungsorte der Bretagne." },
  { name: "Château de Brest", query: "Chateau de Brest", region: "Bretagne", category: "castle-fortress", tags: ["castle", "fortress", "history", "landmark"], description: "Historische Festung am Hafen von Brest mit starkem maritimen Geschichtsbezug." },
  { name: "Pointe Saint-Mathieu", query: "Pointe Saint Mathieu", region: "Bretagne", category: "headland-ruins", tags: ["headland", "abbey ruins", "lighthouse", "panorama"], description: "Spektakuläres Kap mit Leuchtturm, Abteiruine und Küstenpanorama." },
  { name: "Phare du Petit Minou", query: "Phare du Petit Minou", region: "Bretagne", category: "lighthouse", tags: ["lighthouse", "coast", "bridge", "panorama"], description: "Fotogenes Leuchtturm-Motiv am Atlantikzugang vor Brest." },
  { name: "Presqu'île de Crozon", query: "Presqu'ile de Crozon", region: "Bretagne", category: "peninsula", tags: ["coast", "cliff", "panorama", "natural attraction"], description: "Eine der spektakulärsten Küstenlandschaften Frankreichs mit Kaps, Buchten und Steilklippen." },
  { name: "Pointe de Pen-Hir", query: "Pointe de Pen Hir", region: "Bretagne", category: "headland", tags: ["headland", "cliff", "panorama", "coast"], description: "Berühmtes Kap auf Crozon mit dramatischen Felsabbrüchen und weitem Meerblick." },
  { name: "Tas de Pois", query: "Tas de Pois Crozon", region: "Bretagne", category: "rock-formation", tags: ["rocks", "coast", "panorama", "natural attraction"], description: "Ikonische Felsnadeln vor der Pointe de Pen-Hir und eines der bekanntesten Bretagne-Motive." },
  { name: "Locronan", query: "Locronan Bretagne", region: "Bretagne", category: "historic-village", tags: ["historic quarter", "medieval", "architecture", "iconic"], description: "Außergewöhnlich gut erhaltenes Granitdorf und eines der schönsten historischen Ensembles der Bretagne." },
  { name: "Cathédrale Saint-Corentin de Quimper", query: "Cathedrale Saint Corentin Quimper", region: "Bretagne", category: "cathedral", tags: ["cathedral", "religious heritage", "history", "architecture"], description: "Große gotische Kathedrale und zentraler Wahrzeichenbau von Quimper." },
  { name: "Vieille ville de Quimper", query: "Vieille ville de Quimper", region: "Bretagne", category: "historic-quarter", tags: ["historic quarter", "architecture", "landmark"], description: "Charmante Altstadt mit Fachwerk, Flussläufen und starkem bretonischem Charakter." },
  { name: "Ville Close de Concarneau", query: "Ville Close Concarneau", region: "Bretagne", category: "fortified-old-town", tags: ["fortress", "historic quarter", "harbor", "iconic"], description: "Berühmte befestigte Altstadtinsel in Concarneau und Top-Sehenswürdigkeit an der Südbretagne." },
  { name: "Musée de Pont-Aven", query: "Musee de Pont Aven", region: "Bretagne", category: "museum", tags: ["museum", "art", "historic"], description: "Wichtiges Kunstmuseum in der berühmten Künstlerstadt Pont-Aven." },
  { name: "Pointe du Raz", query: "Pointe du Raz", region: "Bretagne", category: "headland", tags: ["headland", "cliff", "panorama", "coast", "iconic"], description: "Legendäres Kap am Ende Europas und eine der emblematischsten Naturattraktionen der Bretagne." },
  { name: "Baie des Trépassés", query: "Baie des Trepasses", region: "Bretagne", category: "bay", tags: ["bay", "coast", "panorama", "scenic"], description: "Berühmte Bucht zwischen Pointe du Raz und Pointe du Van mit dramatischer Szenerie." },
  { name: "Phare d'Eckmühl", query: "Phare d'Eckmuhl", region: "Bretagne", category: "lighthouse", tags: ["lighthouse", "coast", "landmark", "panorama"], description: "Monumentaler Leuchtturm bei Penmarch und eines der bekanntesten Küstenzeichen der Bretagne." },
  { name: "Alignements de Carnac", query: "Alignements de Carnac", region: "Bretagne", category: "megalith-site", tags: ["megalith", "menhir", "prehistoric", "history", "iconic"], description: "Weltberühmte Steinreihen und eine der bedeutendsten prähistorischen Stätten Europas." },
  { name: "Tumulus Saint-Michel Carnac", query: "Tumulus Saint Michel Carnac", region: "Bretagne", category: "archaeological-site", tags: ["archaeological site", "prehistoric", "history", "panorama"], description: "Monumentaler Grabhügel mit archäologischer Bedeutung und weitem Blick über Carnac." },
  { name: "Golfe du Morbihan", query: "Golfe du Morbihan", region: "Bretagne", category: "bay-landscape", tags: ["bay", "islands", "panorama", "natural attraction"], description: "Berühmter bretonischer Inselgolf mit einzigartiger Landschafts- und Inselkulisse." },
  { name: "Vieille ville de Vannes", query: "Vieille ville de Vannes", region: "Bretagne", category: "historic-quarter", tags: ["historic quarter", "architecture", "ramparts", "iconic"], description: "Beliebte Altstadt mit Toren, Fachwerk und Mauern am Golf von Morbihan." },
  { name: "Château de Suscinio", query: "Chateau de Suscinio", region: "Bretagne", category: "castle", tags: ["castle", "history", "architecture", "landmark"], description: "Eindrucksvolle herzögliche Burg nahe der Küste und eines der Top-Schlösser der Bretagne." },
  { name: "Rochefort-en-Terre", query: "Rochefort en Terre", region: "Bretagne", category: "historic-village", tags: ["historic quarter", "architecture", "landmark", "iconic"], description: "Berühmtes Bilderbuchdorf und eines der schönsten historischen Orte Frankreichs." },
  { name: "Château de Josselin", query: "Chateau de Josselin", region: "Bretagne", category: "castle", tags: ["castle", "history", "architecture", "iconic"], description: "Großes Schloss mit markanten Türmen direkt am Kanal und bedeutender historischer Präsenz." },
  { name: "Forêt de Brocéliande", query: "Foret de Broceliande", region: "Bretagne", category: "legendary-forest", tags: ["forest", "legend", "nature", "scenic"], description: "Mythenreiche Waldlandschaft der Artussagen und eine der bekanntesten Naturkulissen der Bretagne." },
  { name: "Tombe de Merlin", query: "Tombe de Merlin Paimpont", region: "Bretagne", category: "legend-site", tags: ["legend", "forest", "landmark", "unique"], description: "Legendärer Ort in Brocéliande mit starkem Mythos- und Erzählwert." },
  { name: "Basilique Sainte-Anne-d'Auray", query: "Basilique Sainte Anne d'Auray", region: "Bretagne", category: "basilica", tags: ["basilica", "pilgrimage", "religious heritage", "landmark"], description: "Wichtigste Wallfahrtsstätte der Bretagne und großer religiöser Erinnerungsort." },
  { name: "Belle-Île-en-Mer", query: "Belle Ile en Mer", region: "Bretagne", category: "island", tags: ["island", "coast", "panorama", "iconic"], description: "Große Atlantikinsel mit rauen Klippen, Buchten und starkem Bretagne-Charakter." },
  { name: "Citadelle Vauban de Palais", query: "Citadelle Vauban Palais Belle Ile", region: "Bretagne", category: "fortress", tags: ["fortress", "history", "coast", "landmark"], description: "Markante Zitadelle am Hafen von Le Palais und historisches Herz von Belle-Île." },
  { name: "Aiguilles de Port-Coton", query: "Aiguilles de Port Coton", region: "Bretagne", category: "rock-formation", tags: ["rocks", "coast", "panorama", "natural attraction"], description: "Berühmte Felsformationen auf Belle-Île und eines der schönsten Küstenpanoramen der Bretagne." },
  { name: "Presqu'île de Quiberon", query: "Presqu'ile de Quiberon", region: "Bretagne", category: "peninsula", tags: ["coast", "cliff", "panorama", "natural attraction"], description: "Beliebte Halbinsel mit wilder Côte Sauvage und klassischer Atlantikszenerie." },
  { name: "Cairn de Gavrinis", query: "Cairn de Gavrinis", region: "Bretagne", category: "archaeological-site", tags: ["archaeological site", "megalith", "prehistoric", "history"], description: "Wichtige megalithische Grabstätte auf einer Insel im Golf von Morbihan." },
  { name: "Parlement de Bretagne", query: "Parlement de Bretagne Rennes", region: "Bretagne", category: "landmark-building", tags: ["landmark", "architecture", "history"], description: "Prächtiges Parlamentsgebäude und einer der wichtigsten Repräsentationsbauten der Bretagne." },
  { name: "Centre historique de Rennes", query: "Centre historique de Rennes", region: "Bretagne", category: "historic-quarter", tags: ["historic quarter", "architecture", "landmark"], description: "Lebendiges historisches Zentrum mit Fachwerk und starkem Stadtbildcharakter." },
  { name: "Huelgoat Forest", query: "Foret de Huelgoat", region: "Bretagne", category: "forest-boulders", tags: ["forest", "rocks", "nature", "scenic"], description: "Mystische Waldlandschaft mit riesigen Felsblöcken, Höhlen und Legendenmotiven." },
  { name: "Cap d'Erquy", query: "Cap Erquy Bretagne", region: "Bretagne", category: "headland", tags: ["headland", "coast", "heathland", "panorama"], description: "Farbenprächtiges Kap mit Heideflächen und herrlichen Blicken auf die Nordküste." },
  { name: "Pointe du Grouin", query: "Pointe du Grouin Cancale", region: "Bretagne", category: "headland", tags: ["headland", "coast", "panorama", "scenic"], description: "Beliebter Aussichtspunkt zwischen Cancale und Saint-Malo mit weitem Blick aufs Meer." },
  { name: "Fort du Taureau", query: "Fort du Taureau", region: "Bretagne", category: "sea-fortress", tags: ["fortress", "island", "coast", "history"], description: "Seefestung in der Bucht von Morlaix und eindrucksvoller historischer Küstenort." },
  { name: "Abbaye de Daoulas", query: "Abbaye de Daoulas", region: "Bretagne", category: "abbey", tags: ["abbey", "history", "garden", "architecture"], description: "Historische Abtei mit reizvoller Garten- und Klosteratmosphäre im Finistère." },
  { name: "Phare de l'Île Vierge", query: "Phare de l'Ile Vierge", region: "Bretagne", category: "lighthouse", tags: ["lighthouse", "coast", "landmark", "iconic"], description: "Ikonischer Leuchtturm an der wilden Nordwestküste der Bretagne." },
  { name: "Le Conquet", query: "Le Conquet", region: "Bretagne", category: "historic-harbor", tags: ["harbor", "coast", "historic"], description: "Charmanter Hafenort am äußersten Westen der Bretagne und guter Küstenstopp." },
  { name: "Pointe du Van", query: "Pointe du Van", region: "Bretagne", category: "headland", tags: ["headland", "cliff", "panorama", "coast"], description: "Raues Kap mit kleiner Kapelle und großem Atlantikblick, oft als stillere Schwester der Pointe du Raz beschrieben." },
  { name: "Château de Fougères", query: "Chateau de Fougeres", region: "Bretagne", category: "castle-fortress", tags: ["castle", "fortress", "history", "medieval"], description: "Eine der größten mittelalterlichen Festungen Europas am Rand der Bretagne." },
];
const TOP_100 = [...NORMANDIE, ...BRETAGNE.slice(0, 50)];

function parseNumberArg(argv: string[], name: string): number | null {
  const hit = argv.find((value) => value.startsWith(`${name}=`));
  if (!hit) return null;
  const parsed = Number(hit.slice(name.length + 1));
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : null;
}

function parseLimitArg(argv: string[]): number | null {
  return parseNumberArg(argv, "--limit");
}

function parseOffsetArg(argv: string[]): number {
  const parsed = parseNumberArg(argv, "--offset");
  return parsed ? parsed - 1 : 0;
}

async function main() {
  if (TOP_100.length < 100) {
    throw new Error(`Expected at least 100 curated sights, got ${TOP_100.length}`);
  }

  const apiKey = pickGoogleApiKey();
  const limit = parseLimitArg(process.argv.slice(2));
  const offset = parseOffsetArg(process.argv.slice(2));
  const sliced = offset > 0 ? TOP_100.slice(offset) : TOP_100;
  const worklist = typeof limit === "number" ? sliced.slice(0, limit) : sliced;
  const results: Array<{ id: number; name: string; heroCount: number; heroPicked: boolean; totalScore: number }> = [];
  const failures: Array<{ name: string; reason: string }> = [];

  for (const [index, sight] of worklist.entries()) {
    const label = `[${index + 1}/${worklist.length}] ${sight.name}`;
    try {
      console.log(`${label} resolving`);
      const resolved = await searchGooglePlace(sight, apiKey);
      const saved = await upsertPlace(resolved, apiKey);
      results.push(saved);
      console.log(`${label} imported id=${saved.id} score=${saved.totalScore} hero=${saved.heroPicked ? "yes" : "no"} images=${saved.heroCount}`);
    } catch (error) {
      const reason = String(error instanceof Error ? error.message : error);
      failures.push({ name: sight.name, reason });
      console.warn(`${label} failed: ${reason}`);
    }
  }

  console.log("");
  console.log(`import-normandie-bretagne-top100-sightseeing: imported ${results.length}/${worklist.length}`);
  if (failures.length) {
    console.log("failures:");
    for (const failure of failures) {
      console.log(`- ${failure.name}: ${failure.reason}`);
    }
  }
}

main()
  .catch((error) => {
    console.error("import-normandie-bretagne-top100-sightseeing: failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
