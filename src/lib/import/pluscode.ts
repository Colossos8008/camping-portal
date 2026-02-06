// Minimal Open Location Code (Plus Code) decoder for lat/lon center.
// Supports full codes and short codes with locality suffix (e.g. "8MPR+HH Fachbach").
// For short codes we only strip the locality text - we DO NOT reconstruct missing area prefix.
// => Therefore: for reliable decoding in MVP v1, require a FULL plus code (e.g. "9F3M8MPR+HH").
// If only short code is provided, we return null and the importer reports an error.

const SEPARATOR = "+";
const SEPARATOR_POSITION = 8;
const PADDING_CHAR = "0";
const CODE_ALPHABET = "23456789CFGHJMPQRVWX";
const ENCODING_BASE = CODE_ALPHABET.length; // 20
const LAT_MAX = 90;
const LNG_MAX = 180;

// Pair resolutions in degrees for each pair position.
const PAIR_RESOLUTIONS = [20, 1, 0.05, 0.0025, 0.000125];

export type DecodedPlusCode = {
  lat: number;
  lon: number;
  code: string;
};

export function decodePlusCode(input: string): DecodedPlusCode | null {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return null;

  // Remove any locality after a space - keep the code token.
  const token = trimmed.split(/\s+/)[0];

  if (!token.includes(SEPARATOR)) return null;

  // If it looks like a short code (fewer than 10 chars excluding separator), we refuse in v1.
  // Example short: "8MPR+HH" (6 + '+' + 2 = 9) => cannot decode without reference area.
  const noSpace = token.toUpperCase();
  const plainLen = noSpace.replace(SEPARATOR, "").length;
  if (plainLen < 10) return null;

  return decodeFullPlusCode(noSpace);
}

function decodeFullPlusCode(code: string): DecodedPlusCode | null {
  const upper = code.toUpperCase();

  const sepIdx = upper.indexOf(SEPARATOR);
  if (sepIdx !== SEPARATOR_POSITION) return null;

  const cleaned = upper.replace(SEPARATOR, "");
  const padded = cleaned.replace(new RegExp(PADDING_CHAR, "g"), "");

  // We decode first 10 digits (5 pairs). Extra grid digits not supported in this MVP v1.
  const pairLen = Math.min(10, padded.length);
  if (pairLen < 10) return null;

  const pairCode = padded.slice(0, 10);

  let lat = -LAT_MAX;
  let lon = -LNG_MAX;

  for (let i = 0; i < 10; i += 2) {
    const latChar = pairCode[i];
    const lonChar = pairCode[i + 1];

    const latVal = CODE_ALPHABET.indexOf(latChar);
    const lonVal = CODE_ALPHABET.indexOf(lonChar);

    if (latVal < 0 || lonVal < 0) return null;

    const place = i / 2;
    const res = PAIR_RESOLUTIONS[place];

    lat += latVal * res;
    lon += lonVal * res;
  }

  // The decoded area is a cell - return center point.
  const cellHeight = PAIR_RESOLUTIONS[4];
  const cellWidth = PAIR_RESOLUTIONS[4];

  return {
    lat: clamp(lat + cellHeight / 2, -LAT_MAX, LAT_MAX),
    lon: clamp(lon + cellWidth / 2, -LNG_MAX, LNG_MAX),
    code: upper,
  };
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}
