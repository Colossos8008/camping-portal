/* eslint-disable no-console */

/**
 * Exportiert HVO100 / XTL Tankstellen aus
 * - eFuelsNow Google-My-Maps KML
 * - plus optional hvo100.team (falls dort eine MyMaps mid eingebettet ist)
 *
 * Schnell - Regionfilter primär via Bounding-Boxes (ohne Reverse-Geocode)
 * Optional - Reverse-Geocode nur zum Verifizieren (kleine Restmenge)
 *
 * Output-CSV kompatibel mit deinem Import:
 * placeName,placeTypeHint,lat,lng,plusCode,googleMapsUrl
 *
 * Usage:
 *   node scripts/hvo_xtl_export_region_from_efuelsnow_and_hvo100team.mjs
 *   node scripts/hvo_xtl_export_region_from_efuelsnow_and_hvo100team.mjs --out data/import/custom.csv
 *   node scripts/hvo_xtl_export_region_from_efuelsnow_and_hvo100team.mjs --include-blends
 *   node scripts/hvo_xtl_export_region_from_efuelsnow_and_hvo100team.mjs --verify-geocode --geocode-limit 800
 */

const args = new Set(process.argv.slice(2));
const getArgValue = (flag) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return v && !v.startsWith("--") ? v : null;
};

// eFuelsNow MyMaps mid
const EFN_MID = "1sL1dIiegNJiRlVzG6_QgnWuko1A6VuU";
const EFN_KML_URL = `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(EFN_MID)}&forcekml=1`;

// hvo100.team page that may embed a MyMaps mid
const HVO100_TEAM_PAGE_URL = "https://hvo100.team/hvo-tankstellen-karte/";

// Default only sure HVO100/XTL - no blends
const includeBlends = args.has("--include-blends");

// Default NO reverse geocode (fast). Optional verification:
const verifyGeocode = args.has("--verify-geocode");
const geocodeLimit = Number(getArgValue("--geocode-limit") ?? "800");
const effectiveGeocodeLimit = Number.isFinite(geocodeLimit) ? Math.max(0, geocodeLimit) : 800;

// Output
const FIXED_OUT_DIR = "data/import";
const defaultOutPath = `${FIXED_OUT_DIR}/hvo100_xtl_rlp_saar_benelux_fr_v1_${new Date()
  .toISOString()
  .slice(0, 10)}.csv`;
const outPath = getArgValue("--out") || defaultOutPath;

// Cache for reverse geocoding to avoid rate limits
const GEO_CACHE_PATH = "data/cache/hvo_reverse_geocode_cache_v2.json";

// ---------- Region filter via bounding boxes ----------
// NOTE: Bounding-Boxes sind absichtlich etwas großzügig. Das ist schnell und bringt die Menge runter.
// Optional danach --verify-geocode nutzen, um “false positives” rauszuwerfen.

const BBOXES = {
  // RLP grob
  RLP: { minLat: 49.0, maxLat: 50.95, minLng: 5.9, maxLng: 8.55 },
  // Saarland grob
  SAAR: { minLat: 49.05, maxLat: 49.70, minLng: 6.35, maxLng: 7.45 },

  // Benelux
  LUX: { minLat: 49.35, maxLat: 50.30, minLng: 5.70, maxLng: 6.60 },
  BE: { minLat: 49.45, maxLat: 51.55, minLng: 2.50, maxLng: 6.50 },
  NL: { minLat: 50.70, maxLat: 53.60, minLng: 3.20, maxLng: 7.30 },

  // Frankreich (Nord/Ost + als “großzügig”, weil du es als Region willst)
  // Wenn dir das zu viel ist, kann man Frankreich enger auf Grenzregion ziehen.
  FR: { minLat: 42.0, maxLat: 51.5, minLng: -5.5, maxLng: 8.5 },
};

function inBox(lat, lng, b) {
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

function inTargetRegionFast(lat, lng) {
  return (
    inBox(lat, lng, BBOXES.RLP) ||
    inBox(lat, lng, BBOXES.SAAR) ||
    inBox(lat, lng, BBOXES.LUX) ||
    inBox(lat, lng, BBOXES.BE) ||
    inBox(lat, lng, BBOXES.NL) ||
    inBox(lat, lng, BBOXES.FR)
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

  const hasHvo100 = t.includes("hvo100");
  const hasXtl = t.includes("xtl");
  const hasEn15940 = t.includes("15940");

  const hasBlend =
    t.includes("blend") ||
    t.includes("hvo20") ||
    t.includes("hvo30") ||
    t.includes("hvo50") ||
    t.includes("b7") ||
    t.includes("%") ||
    t.includes("beimisch");

  if (includeBlends) {
    return hasHvo100 || hasXtl || hasEn15940 || t.includes("hvo");
  }

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

async function ensureCacheDir() {
  const pathMod = await import("node:path");
  const fs = await import("node:fs/promises");
  const dir = pathMod.dirname(GEO_CACHE_PATH);
  await fs.mkdir(dir, { recursive: true });
}

async function loadGeoCache() {
  const fs = await import("node:fs/promises");
  await ensureCacheDir();
  try {
    const raw = await fs.readFile(GEO_CACHE_PATH, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

async function saveGeoCache(cache) {
  const fs = await import("node:fs/promises");
  await ensureCacheDir();
  await fs.writeFile(GEO_CACHE_PATH, JSON.stringify(cache, null, 2), "utf8");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function cacheKey(lat, lng) {
  return `${lat.toFixed(6)},${lng.toFixed(6)}`;
}

async function reverseGeocodeNominatim(lat, lng, cache) {
  const key = cacheKey(lat, lng);
  if (cache[key]) return cache[key];

  // gentle
  await sleep(1100);

  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
    lat
  )}&lon=${encodeURIComponent(lng)}&zoom=10&addressdetails=1`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      "User-Agent": "camping-portal-hvo-export/2.0 (personal use)",
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Reverse geocode failed: ${res.status} ${res.statusText} - ${txt.slice(0, 200)}`);
  }

  const json = await res.json();
  const addr = json?.address ?? {};
  const countryCode = String(addr?.country_code ?? "").toLowerCase();
  const state = String(addr?.state ?? "");

  const out = { countryCode, state };
  cache[key] = out;
  return out;
}

async function discoverMyMapsMidFromHtml(url) {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0", Accept: "text/html,*/*" },
    });
    if (!res.ok) return null;
    const html = await res.text();

    const patterns = [
      /[?&]mid=([a-zA-Z0-9_\-]+)/g,
      /"mid"\s*:\s*"([a-zA-Z0-9_\-]+)"/g,
      /maps\/d\/viewer\?mid=([a-zA-Z0-9_\-]+)/g,
      /maps\/d\/u\/\d+\/view\?mid=([a-zA-Z0-9_\-]+)/g,
    ];

    for (const re of patterns) {
      let m;
      while ((m = re.exec(html)) !== null) {
        const mid = m[1];
        if (mid && mid.length >= 10) return mid;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchKml(url) {
  console.log(`Fetching KML: ${url}`);
  const res = await fetch(url, {
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

  return await res.text();
}

function parsePlacemarks(xml) {
  return xml.split(/<Placemark\b/i).slice(1).map((p) => "<Placemark" + p);
}

function googleMapsUrl(lat, lng) {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

async function main() {
  // 1) KML urls + dedupe by MID
  const kmlUrls = [];
  kmlUrls.push({ source: "eFuelsNow", mid: EFN_MID, url: EFN_KML_URL });

  const hvoMid = await discoverMyMapsMidFromHtml(HVO100_TEAM_PAGE_URL);
  if (hvoMid) {
    if (hvoMid === EFN_MID) {
      console.log(`hvo100.team mid == eFuelsNow mid (${hvoMid}) - dedupe - only fetch once`);
    } else {
      const url = `https://www.google.com/maps/d/kml?mid=${encodeURIComponent(hvoMid)}&forcekml=1`;
      kmlUrls.push({ source: "hvo100.team", mid: hvoMid, url });
      console.log(`hvo100.team - discovered MyMaps mid: ${hvoMid}`);
    }
  } else {
    console.log("hvo100.team - no MyMaps mid discovered - continuing with eFuelsNow only");
  }

  const rows = [];
  const seen = new Set(); // dedupe by rounded lat,lng + normalized name

  for (const kml of kmlUrls) {
    const xml = await fetchKml(kml.url);
    const placemarks = parsePlacemarks(xml);
    console.log(`${kml.source} - Placemark blocks: ${placemarks.length}`);

    let kept = 0;
    let scanned = 0;

    for (const pm of placemarks) {
      scanned++;
      if (scanned % 2000 === 0) {
        console.log(`${kml.source} - scanned ${scanned}/${placemarks.length} - kept so far ${kept}`);
      }

      const name = extractTag(pm, "name");
      const desc = extractTag(pm, "description");
      const coords = extractCoordinates(pm);
      if (!name || !coords) continue;

      const { lat, lng } = coords;

      // FAST region filter first
      if (!inTargetRegionFast(lat, lng)) continue;

      const textForCheck = `${name}\n${desc}`;
      if (!looksLikeSureHvoXtl(textForCheck)) continue;

      const key = `${name.trim().toLowerCase()}__${lat.toFixed(6)}__${lng.toFixed(6)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      kept++;
      rows.push({
        placeName: name.trim(),
        placeTypeHint: "HVO_TANKSTELLE",
        lat: lat.toFixed(6),
        lng: lng.toFixed(6),
        plusCode: "",
        googleMapsUrl: googleMapsUrl(lat, lng),
      });
    }

    console.log(`${kml.source} - DONE - scanned ${scanned} - kept ${kept}`);
  }

  // 2) Optional: verify by reverse geocode (limited)
  if (verifyGeocode) {
    console.log(`verify-geocode enabled - limit ${effectiveGeocodeLimit} (others remain as-is)`);
    const geoCache = await loadGeoCache();

    // take first N for verification (stable order by name later)
    const sample = rows.slice(0, effectiveGeocodeLimit);
    let ok = 0;

    for (let i = 0; i < sample.length; i++) {
      const r = sample[i];
      const lat = Number(r.lat);
      const lng = Number(r.lng);
      const rc = await reverseGeocodeNominatim(lat, lng, geoCache);
      const cc = rc.countryCode;
      const state = rc.state;

      const allowed =
        cc === "fr" || cc === "be" || cc === "nl" || cc === "lu" || (cc === "de" && (state === "Rheinland-Pfalz" || state === "Saarland"));

      if (allowed) ok++;
      else {
        // mark as not allowed
        r._drop = true;
      }

      if ((i + 1) % 50 === 0) console.log(`verify-geocode progress ${i + 1}/${sample.length} - allowed ${ok}`);
    }

    // drop only those we verified as outside
    const before = rows.length;
    const filtered = rows.filter((r) => !r._drop);
    rows.length = 0;
    rows.push(...filtered);
    await saveGeoCache(geoCache);
    console.log(`verify-geocode - removed ${before - rows.length} of verified sample (rest unchanged)`);
  }

  rows.sort((a, b) => a.placeName.localeCompare(b.placeName, "de"));

  const header = "placeName,placeTypeHint,lat,lng,plusCode,googleMapsUrl";
  const csvLines = [header];
  for (const r of rows) {
    csvLines.push([csvEscape(r.placeName), r.placeTypeHint, r.lat, r.lng, r.plusCode, csvEscape(r.googleMapsUrl)].join(","));
  }

  await ensureOutDirExistsForFilePath(outPath);

  const fs = await import("node:fs/promises");
  await fs.writeFile(outPath, csvLines.join("\n"), "utf8");

  console.log(`OK - wrote ${rows.length} rows to: ${outPath}`);
  console.log(`Mode - ${includeBlends ? "include blends" : "HVO100/XTL only (default)"}`);
  console.log(`verify-geocode - ${verifyGeocode ? `enabled (limit ${effectiveGeocodeLimit})` : "disabled (fast bbox filter)"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});