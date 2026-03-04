// src/app/api/import/ina-csv/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv } from "@/lib/import/csv";
import { decodePlusCode } from "@/lib/import/pluscode";
import { parseNumber, resolveLatLngFromMapsUrl } from "@/lib/import/geo";

export const runtime = "nodejs";

type ImportRowResult =
  | { status: "created" | "updated" | "skipped"; placeName: string; message?: string }
  | { status: "error"; placeName: string; message: string };

type PlaceType = "CAMPINGPLATZ" | "STELLPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

// TS 2.1
type TS21Source = "AI" | "USER";
type TS21Value = "S" | "O" | "X";
type TS21Scores = Record<string, TS21Value>;
type TS21Detail = {
  activeSource: TS21Source;
  ai: TS21Scores;
  user: TS21Scores;
  dna: boolean;
  explorer: boolean;
  dnaExplorerNote: string;
  note: string;
};

function normalizePlaceType(v: string): PlaceType | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "CAMPINGPLATZ") return "CAMPINGPLATZ";
  if (s === "STELLPLATZ") return "STELLPLATZ";
  if (s === "HVO_TANKSTELLE") return "HVO_TANKSTELLE";
  if (s === "SEHENSWUERDIGKEIT") return "SEHENSWUERDIGKEIT";
  return null;
}

function inferPlaceTypeFromName(placeName: string): PlaceType {
  const n = String(placeName ?? "").toLowerCase();
  if (n.includes("hvo") || n.includes("tankstelle")) return "HVO_TANKSTELLE";
  if (n.includes("stellplatz") || n.includes("wohnmobilstellplatz")) return "STELLPLATZ";
  if (n.includes("camping")) return "CAMPINGPLATZ";
  return "SEHENSWUERDIGKEIT";
}

function asString(v: any): string {
  if (typeof v === "string") return v;
  if (v == null) return "";
  return String(v);
}

function asOptionalString(v: any): string | undefined {
  if (v == null) return undefined;
  const s = asString(v).trim();
  return s.length ? s : undefined;
}

function asBool(v: any): boolean | undefined {
  if (v == null || v === "") return undefined;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["1", "true", "yes", "ja", "y"].includes(s)) return true;
  if (["0", "false", "no", "nein", "n"].includes(s)) return false;
  return undefined;
}

function round6(n: number) {
  return Number(n.toFixed(6));
}

function normNameKey(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replaceAll("&", "und")
    .replaceAll("ß", "ss")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function dedupeKey(type: PlaceType, placeName: string, lat: number, lng: number) {
  return `${type}__${normNameKey(placeName)}__${round6(lat)}__${round6(lng)}`;
}

function normalizeTS21Source(v: any): TS21Source {
  return String(v ?? "").trim().toUpperCase() === "USER" ? "USER" : "AI";
}

function blankTS21(): TS21Detail {
  return {
    activeSource: "AI",
    ai: {},
    user: {},
    dna: false,
    explorer: false,
    dnaExplorerNote: "",
    note: "",
  };
}

// robust CSV getter: exact key, trimmed key, case-insensitive
function getCsv(r: Record<string, string>, ...keys: string[]) {
  for (const k of keys) {
    if (k in r) return r[k];
  }
  const map = new Map<string, string>();
  for (const k of Object.keys(r)) map.set(k.trim().toLowerCase(), k);

  for (const wanted of keys) {
    const found = map.get(String(wanted).trim().toLowerCase());
    if (found) return r[found];
  }
  return undefined;
}

function isUnknownFieldError(e: any, field: string) {
  const msg = String(e?.message ?? e ?? "");
  return msg.includes(`Unknown field \`${field}\``) || msg.includes(`Unknown argument \`${field}\``);
}

// DO NOT memoize in dev
async function supportsTs21NoCache(): Promise<boolean> {
  try {
    await prisma.place.findFirst({
      select: { id: true, ts21: { select: { id: true } } },
    } as any);
    return true;
  } catch (e: any) {
    if (isUnknownFieldError(e, "ts21")) return false;
    throw e;
  }
}

function parseTS21Value(v: any): TS21Value | null {
  if (v == null) return null;
  const raw = String(v).trim();
  if (!raw.length) return null;

  const up = raw.toUpperCase();

  if (up === "S" || up === "O" || up === "X") return up as TS21Value;
  if (up === "STIMMIG") return "S";
  if (up === "OKAY") return "O";
  if (up === "PASST_NICHT") return "X";

  if (up === "2") return "S";
  if (up === "1") return "O";
  if (up === "0") return "X";

  const num = Number(raw.replace(",", "."));
  if (!Number.isNaN(num)) {
    if (num <= 1) return "X";
    if (num <= 3) return "O";
    return "S";
  }

  return null;
}

function isTs21MetaKey(keyLower: string) {
  return keyLower.startsWith("total") || keyLower.startsWith("confidence");
}

function stripScaleSuffix(key: string) {
  return key.replace(/_0_5$/i, "").replace(/_0_20$/i, "").replace(/_0_1$/i, "");
}

// TS21 UI expects exactly these keys
const TS21_UI_KEYS = new Set(["1a", "1b", "2a", "2b", "3", "4a", "4b", "5", "6", "7"]);

// Map legacy category names to TS21 UI keys
const LEGACY_TO_TS21_KEY: Record<string, string> = {
  sanitaer: "3",
  umgebung: "4a",
  platzstruktur: "4b",
  buchung: "2a",
  nachklang: "6",

  // best effort
  hilde_score: "1a",
  wintertauglichkeit: "5",
  wiederkommen: "7",
  ankommen: "2b",
  ruhe: "5",
  nachtruhe: "5",
};

function mappedTs21KeyFor(rawKey: string): string | null {
  const base = stripScaleSuffix(String(rawKey ?? "").trim()).toLowerCase();
  return LEGACY_TO_TS21_KEY[base] ?? null;
}

function normalizeAiProfileToHaltung(v: any): { dna: boolean; explorer: boolean } | null {
  const s = String(v ?? "").trim().toUpperCase();
  if (s === "DNA") return { dna: true, explorer: false };
  if (s === "EXPLORER") return { dna: false, explorer: true };
  return null;
}

function parseTs21FromRow(r: Record<string, string>): TS21Detail | null {
  const activeSourceRaw = getCsv(r, "ts21_activeSource", "activeSource", "ts21ActiveSource");
  const dnaRaw = getCsv(r, "ts21_dna", "ts21Dna");
  const explorerRaw = getCsv(r, "ts21_explorer", "ts21Explorer");
  const dnaExplorerNoteRaw = getCsv(r, "ts21_dnaExplorerNote", "ts21DnaExplorerNote");
  const noteRaw = getCsv(r, "ts21_note", "ts21Note");

  // Profile CSV fields (known from Ina Import profile template)
  const aiProfileRaw = getCsv(r, "ai_profile");
  const aiReasonShortRaw = getCsv(r, "ai_reason_short");

  const anyTs21Field =
    activeSourceRaw != null ||
    dnaRaw != null ||
    explorerRaw != null ||
    dnaExplorerNoteRaw != null ||
    noteRaw != null ||
    aiProfileRaw != null ||
    aiReasonShortRaw != null;

  const aiScores: TS21Scores = {};
  const userScores: TS21Scores = {};

  function setScore(target: TS21Scores, key: string, val: TS21Value) {
    if (!key) return;
    if (isTs21MetaKey(key.toLowerCase())) return;
    if (target[key] == null) target[key] = val;
  }

  function setScoreWithMapping(target: TS21Scores, rawKey: string, val: TS21Value) {
    setScore(target, rawKey, val);

    const rawTrim = String(rawKey ?? "").trim();
    const isUiKey = TS21_UI_KEYS.has(rawTrim);
    if (!isUiKey) {
      const mapped = mappedTs21KeyFor(rawTrim);
      if (mapped) setScore(target, mapped, val);
    }
  }

  for (const origKey of Object.keys(r)) {
    const kTrim = origKey.trim();
    const kLower = kTrim.toLowerCase();
    const v = r[origKey];

    if (kLower.startsWith("ai_ts21_")) {
      const rawKey = kTrim.slice("ai_ts21_".length).trim();
      const vv = parseTS21Value(v);
      if (rawKey && vv) setScoreWithMapping(aiScores, rawKey, vv);
      continue;
    }
    if (kLower.startsWith("user_ts21_")) {
      const rawKey = kTrim.slice("user_ts21_".length).trim();
      const vv = parseTS21Value(v);
      if (rawKey && vv) setScoreWithMapping(userScores, rawKey, vv);
      continue;
    }
    if (kLower.startsWith("ts21_ai_")) {
      const rawKey = kTrim.slice("ts21_ai_".length).trim();
      const vv = parseTS21Value(v);
      if (rawKey && vv) setScoreWithMapping(aiScores, rawKey, vv);
      continue;
    }
    if (kLower.startsWith("ts21_user_")) {
      const rawKey = kTrim.slice("ts21_user_".length).trim();
      const vv = parseTS21Value(v);
      if (rawKey && vv) setScoreWithMapping(userScores, rawKey, vv);
      continue;
    }
  }

  const hasScores = Object.keys(aiScores).length > 0 || Object.keys(userScores).length > 0;
  if (!anyTs21Field && !hasScores) return null;

  const out = blankTS21();
  out.activeSource = normalizeTS21Source(activeSourceRaw);

  // 1) explicit TS21 fields win
  out.dna = asBool(dnaRaw) ?? false;
  out.explorer = asBool(explorerRaw) ?? false;

  // 2) fallback from ai_profile if explicit not provided
  if (!out.dna && !out.explorer) {
    const fromProfile = normalizeAiProfileToHaltung(aiProfileRaw);
    if (fromProfile) {
      out.dna = fromProfile.dna;
      out.explorer = fromProfile.explorer;
    }
  }

  // mutual exclusive safety
  if (out.dna && out.explorer) {
    out.dna = true;
    out.explorer = false;
  }

  // 1) explicit dnaExplorerNote wins
  const explicitHaltungNote = asOptionalString(dnaExplorerNoteRaw);
  if (explicitHaltungNote) {
    out.dnaExplorerNote = explicitHaltungNote;
  } else {
    // 2) fallback from ai_reason_short
    out.dnaExplorerNote = asString(aiReasonShortRaw);
  }

  // general TS21 note still supported
  out.note = asString(noteRaw);

  out.ai = aiScores;
  out.user = userScores;

  return out;
}

function ts21Debug(ts21: TS21Detail | null | undefined) {
  if (!ts21) return "ts21Parsed=null";
  const aiKeys = Object.keys(ts21.ai ?? {});
  const userKeys = Object.keys(ts21.user ?? {});
  const firstAi = aiKeys.length ? `${aiKeys[0]}=${(ts21.ai as any)[aiKeys[0]]}` : "-";
  const firstUser = userKeys.length ? `${userKeys[0]}=${(ts21.user as any)[userKeys[0]]}` : "-";
  const mappedSample =
    ts21.ai?.["4a"] || ts21.ai?.["3"] || ts21.ai?.["2a"] || ts21.ai?.["6"]
      ? `mappedSample=4a:${ts21.ai?.["4a"] ?? "-"} 3:${ts21.ai?.["3"] ?? "-"} 2a:${ts21.ai?.["2a"] ?? "-"} 6:${ts21.ai?.["6"] ?? "-"}`
      : "mappedSample=-";
  const h = ts21.explorer ? "EXPLORER" : ts21.dna ? "DNA" : "-";
  const hNote = (ts21.dnaExplorerNote ?? "").trim();
  const hNoteInfo = hNote.length ? `haltungNoteLen=${hNote.length}` : "haltungNoteLen=0";
  return `aiKeys=${aiKeys.length} userKeys=${userKeys.length} firstAi=${firstAi} firstUser=${firstUser} activeSource=${ts21.activeSource} haltung=${h} ${hNoteInfo} ${mappedSample}`;
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: "No file uploaded (field name must be 'file')." }, { status: 400 });
    }

    const text = await file.text();
    const rows = parseCsv(text);

    if (rows.length === 0) {
      return NextResponse.json({ ok: false, error: "CSV is empty (or only comments)." }, { status: 400 });
    }

    const canTs21 = await supportsTs21NoCache();

    const seenInFile = new Set<string>();
    const results: ImportRowResult[] = [];

    for (const r of rows) {
      const placeName = String(getCsv(r, "placeName") ?? "").trim();
      const googleMapsUrl = String(getCsv(r, "googleMapsUrl") ?? "").trim();
      const plusCode = String(getCsv(r, "plusCode") ?? "").trim();

      const placeTypeHintRaw = String(getCsv(r, "placeTypeHint", "placeType", "type") ?? "").trim();

      const latCsv = parseNumber(getCsv(r, "lat"));
      const lngCsv = parseNumber(getCsv(r, "lng"));

      if (!placeName || !googleMapsUrl) {
        results.push({
          status: "error",
          placeName: placeName || "(missing placeName)",
          message: "Missing mandatory field(s): placeName and-or googleMapsUrl",
        });
        continue;
      }

      const normalizedHint = placeTypeHintRaw ? normalizePlaceType(placeTypeHintRaw) : null;
      if (placeTypeHintRaw && !normalizedHint) {
        results.push({
          status: "error",
          placeName,
          message:
            `Unknown placeTypeHint-placeType-type: '${placeTypeHintRaw}'. Allowed: CAMPINGPLATZ - STELLPLATZ - HVO_TANKSTELLE - SEHENSWUERDIGKEIT`,
        });
        continue;
      }

      const type = normalizedHint ?? inferPlaceTypeFromName(placeName);

      let lat: number | null = null;
      let lng: number | null = null;

      if (latCsv !== null && lngCsv !== null) {
        lat = latCsv;
        lng = lngCsv;
      } else {
        const decoded = decodePlusCode(plusCode);
        if (decoded) {
          lat = decoded.lat;
          lng = decoded.lon;
        } else {
          const fromMaps = await resolveLatLngFromMapsUrl(googleMapsUrl);
          if (fromMaps) {
            lat = fromMaps.lat;
            lng = fromMaps.lng;
          }
        }
      }

      if (lat === null || lng === null) {
        results.push({
          status: "error",
          placeName,
          message: "No georeference available. Provide lat+lng or a valid full plusCode or a resolvable googleMapsUrl.",
        });
        continue;
      }

      const fileKey = dedupeKey(type, placeName, lat, lng);
      if (seenInFile.has(fileKey)) {
        results.push({ status: "skipped", placeName, message: "Duplicate row in CSV (same type+name+lat+lng)" });
        continue;
      }
      seenInFile.add(fileKey);

      const dogAllowed = asBool(getCsv(r, "dogAllowed"));
      const sanitary = asBool(getCsv(r, "sanitary"));
      const yearRound = asBool(getCsv(r, "yearRound", "winterOpen"));
      const onlineBooking = asBool(getCsv(r, "onlineBooking"));
      const gastronomy = asBool(getCsv(r, "gastronomy"));

      const latR = round6(lat);
      const lngR = round6(lng);

      const ts21Parsed = canTs21 ? parseTs21FromRow(r) : null;
      const shouldHaveTS = type === "CAMPINGPLATZ" || type === "STELLPLATZ";

      const basePatch: any = {
        name: placeName,
        type,
        lat: latR,
        lng: lngR,
      };

      if (dogAllowed !== undefined) basePatch.dogAllowed = dogAllowed;
      if (sanitary !== undefined) basePatch.sanitary = sanitary;
      if (yearRound !== undefined) basePatch.yearRound = yearRound;
      if (onlineBooking !== undefined) basePatch.onlineBooking = onlineBooking;
      if (gastronomy !== undefined) basePatch.gastronomy = gastronomy;

      const patchUpdate: any = { ...basePatch };
      const patchCreate: any = { ...basePatch };

      if (canTs21 && shouldHaveTS && ts21Parsed) {
        patchUpdate.ts21 = {
          upsert: {
            create: { ...ts21Parsed },
            update: { ...ts21Parsed },
          },
        };
        patchCreate.ts21 = {
          create: { ...ts21Parsed },
        };
      }

      const existingByCoordSameType = await prisma.place.findFirst({
        where: { type, lat: latR, lng: lngR },
        select: { id: true },
      });

      if (existingByCoordSameType) {
        await prisma.place.update({ where: { id: existingByCoordSameType.id }, data: patchUpdate });
        results.push({
          status: "updated",
          placeName,
          message: `Matched by coordinates (same type) canTs21=${String(canTs21)} shouldHaveTS=${String(shouldHaveTS)} ${ts21Debug(ts21Parsed)}`,
        });
        continue;
      }

      if (type === "HVO_TANKSTELLE") {
        await prisma.place.create({ data: patchCreate });
        results.push({ status: "created", placeName, message: "Created (HVO - no name fallback)" });
        continue;
      }

      const existingAtCoord = await prisma.place.findMany({
        where: { lat: latR, lng: lngR },
        select: { id: true, type: true, name: true },
      });

      if (existingAtCoord.length > 0) {
        const wantedKey = normNameKey(placeName);
        const nameHit = existingAtCoord.find((x: { id: number; type: string; name: string }) => normNameKey(x.name) === wantedKey);
        const chosen = nameHit ?? (existingAtCoord.length === 1 ? existingAtCoord[0] : null);

        if (!chosen) {
          results.push({
            status: "error",
            placeName,
            message:
              "Multiple existing places share same lat+lng and none match the name. Refusing to create another. Please clean up duplicates.",
          });
          continue;
        }

        await prisma.place.update({ where: { id: chosen.id }, data: patchUpdate });
        results.push({ status: "updated", placeName, message: "Recovery match by coordinates" });
        continue;
      }

      const existingByName = await prisma.place.findFirst({
        where: { type, name: placeName },
        select: { id: true },
      });

      if (existingByName) {
        await prisma.place.update({ where: { id: existingByName.id }, data: patchUpdate });
        results.push({ status: "updated", placeName, message: "Matched by name (legacy)" });
        continue;
      }

      await prisma.place.create({ data: patchCreate });
      results.push({ status: "created", placeName });
    }

    const summary = {
      created: results.filter((x) => x.status === "created").length,
      updated: results.filter((x) => x.status === "updated").length,
      skipped: results.filter((x) => x.status === "skipped").length,
      error: results.filter((x) => x.status === "error").length,
    };

    return NextResponse.json({ ok: true, summary, results });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? "Import failed" }, { status: 500 });
  }
}