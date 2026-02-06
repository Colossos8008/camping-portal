/* eslint-disable no-console */

/**
 * Exportiert HVO/XTL Tankstellen aus der eFuelsNow Google-My-Maps Karte nach CSV.
 *
 * Quelle: Die eFuelsNow-Seite verlinkt eine Google-My-Maps Karte (mid=...).
 * Diese kann als KML exportiert werden und enthält alle Marker inkl. Koordinaten.
 *
 * Output-CSV kompatibel mit deinem Import:
 * placeName,placeTypeHint,lat,lng,plusCode,googleMapsUrl
 *
 * Usage:
 *   node scripts/hvo_xtl_export_de_from_efuelsnow_mymaps.mjs
 *   node scripts/hvo_xtl_export_de_from_efuelsnow_mymaps.mjs --include-blends
 *   node scripts/hvo_xtl_export_de_from_efuelsnow_mymaps.mjs --out data/import/custom.csv
 */

const args = new Set(process.argv.slice(2));
const getArgValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return v && !v.startsWith("--") ? v : null;
};

// eFuelsNow MyMaps "mid" – aus der eFuelsNow-Seite (siehe Link in Reiter 2 – Wichtige Infos)
const MYMAPS_MID = "1sL1dIiegNJiRlVzG6_QgnWuko1A6VuU";

// KML Export endpoint für Google My Maps
const KML_URL = `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(MYMAPS_MID)}&forcekml=1`;

// Default: nur "sicher" (HVO100/XTL), KEINE Blends
const includeBlends = args.has("--include-blends");

// Fixer Import-Ordner
const FIXED_OUT_DIR = "data/import";

// Default-Dateiname - versioniert - reproduzierbar - YYYY-MM-DD
const defaultOutPath = `${FIXED_OUT_DIR}/hvo_xtl_tankstellen_deutschland_vollstaendig_v1_${new Date()
  .toISOString()
  .slice(0, 10)}.csv`;

// Optionaler Override bleibt erlaubt (bricht keine bestehenden Workflows)
const outPath = getArgValue("--out") || defaultOutPath;

// Deutschland Bounding Box (großzügig)
const DE_BBOX = {
  minLat: 47.0,
  maxLat: 55.2,
  minLng: 5.5,
  maxLng: 15.7,
};

function inGermany(lat, lng) {
  return (
    lat >= DE_BBOX.minLat &&
    lat <= DE_BBOX.maxLat &&
    lng >= DE_BBOX.minLng &&
    lng <= DE_BBOX.maxLng
  );
}

function decodeXmlEntities(s) {
  return String(s ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'");
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (s.includes('"') || s.includes(",") || s.includes("\n") || s.includes("\r")) {
    return `"${s.replaceAll('"', '""')}"`;
  }
  return s;
}

function extractTag(block, tagName) {
  const re = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const m = block.match(re);
  return m ? decodeXmlEntities(m[1].trim()) : "";
}

function extractCoordinates(block) {
  // Typically: <Point><coordinates>lng,lat,0</coordinates></Point>
  const coords = extractTag(block, "coordinates");
  if (!coords) return null;
  const first = coords.split(/\s+/)[0];
  const parts = first.split(",");
  if (parts.length < 2) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function looksLikeSureHvoXtl(text) {
  const t = String(text ?? "").toLowerCase();

  // "sicher" = HVO100 oder XTL (DIN EN 15940), KEINE Blends
  const hasHvo100 = t.includes("hvo100");
  const hasXtl = t.includes("xtl");
  const hasEn15940 = t.includes("15940");

  // blend hints
  const hasBlend =
    t.includes("blend") ||
    t.includes("hvo20") ||
    t.includes("hvo30") ||
    t.includes("hvo50") ||
    t.includes("b7") ||
    t.includes("%") ||
    t.includes("beimisch");

  if (includeBlends) {
    // Dann nehmen wir alles, was irgendwie HVO/XTL erwähnt
    return hasHvo100 || hasXtl || hasEn15940 || t.includes("hvo");
  }

  // Default: nur „sicher“ – HVO100/XTL; explizite Blends vermeiden
  if (hasHvo100 || hasXtl || hasEn15940) return true;
  if (t.includes("hvo") && !hasBlend) return true;
  return false;
}

async function ensureOutDirExistsForFilePath(filePath) {
  const pathMod = await import("node:path");
  const fs = await import("node:fs/promises");

  const dir = pathMod.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
}

async function main() {
  console.log(`Fetching KML: ${KML_URL}`);
  const res = await fetch(KML_URL, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/vnd.google-earth.kml+xml,application/xml,text/xml,*/*",
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`KML fetch failed: ${res.status} ${res.statusText} - ${txt.slice(0, 300)}`);
  }

  const xml = await res.text();

  // Split into Placemark blocks
  const placemarks = xml.split(/<Placemark\b/i).slice(1).map((p) => "<Placemark" + p);
  console.log(`Placemark blocks: ${placemarks.length}`);

  const rows = [];
  const seen = new Set(); // dedupe by lat,lng,name

  for (const pm of placemarks) {
    const name = extractTag(pm, "name");
    const desc = extractTag(pm, "description");
    const coords = extractCoordinates(pm);

    if (!name || !coords) continue;

    const { lat, lng } = coords;

    // Country filter: Germany
    if (!inGermany(lat, lng)) continue;

    // Fuel filter: default sure HVO/XTL
    const textForCheck = `${name}\n${desc}`;
    if (!looksLikeSureHvoXtl(textForCheck)) continue;

    const key = `${name}__${lat.toFixed(6)}__${lng.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const googleMapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;

    rows.push({
      placeName: name,
      placeTypeHint: "HVO_TANKSTELLE",
      lat: lat.toFixed(6),
      lng: lng.toFixed(6),
      plusCode: "",
      googleMapsUrl,
    });
  }

  rows.sort((a, b) => a.placeName.localeCompare(b.placeName, "de"));

  const header = "placeName,placeTypeHint,lat,lng,plusCode,googleMapsUrl";
  const csvLines = [header];

  for (const r of rows) {
    csvLines.push(
      [
        csvEscape(r.placeName),
        r.placeTypeHint,
        r.lat,
        r.lng,
        r.plusCode,
        csvEscape(r.googleMapsUrl),
      ].join(",")
    );
  }

  await ensureOutDirExistsForFilePath(outPath);

  const fs = await import("node:fs/promises");
  await fs.writeFile(outPath, csvLines.join("\n"), "utf8");

  console.log(`OK - wrote ${rows.length} rows to: ${outPath}`);
  console.log(`CSV geschrieben nach: ${outPath}`);
  console.log(`Mode: ${includeBlends ? "include blends" : "HVO100/XTL only (default)"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
