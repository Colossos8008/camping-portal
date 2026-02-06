import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { parseCsv } from "@/lib/import/csv";
import { decodePlusCode } from "@/lib/import/pluscode";
import { parseNumber, resolveLatLngFromMapsUrl } from "@/lib/import/geo";

type ImportRowResult =
  | { status: "created" | "updated" | "skipped"; placeName: string; message?: string }
  | { status: "error"; placeName: string; message: string };

type PlaceType = "CAMPINGPLATZ" | "STELLPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

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

  // Heuristik - robust genug für euren privaten Import
  if (n.includes("hvo") || n.includes("tankstelle")) return "HVO_TANKSTELLE";
  if (n.includes("stellplatz") || n.includes("wohnmobilstellplatz")) return "STELLPLATZ";
  if (n.includes("camping")) return "CAMPINGPLATZ";
  return "SEHENSWUERDIGKEIT";
}

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json(
        { ok: false, error: "No file uploaded (field name must be 'file')." },
        { status: 400 }
      );
    }

    const text = await file.text();
    const rows = parseCsv(text);

    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "CSV is empty (or only comments)." },
        { status: 400 }
      );
    }

    const results: ImportRowResult[] = [];

    for (const r of rows) {
      const placeName = (r["placeName"] ?? "").trim();
      const googleMapsUrl = (r["googleMapsUrl"] ?? "").trim();
      const plusCode = (r["plusCode"] ?? "").trim();

      // Optional fields
      const placeTypeHint = (r["placeTypeHint"] ?? "").trim();
      const latCsv = parseNumber(r["lat"]);
      const lngCsv = parseNumber(r["lng"]);

      if (!placeName || !googleMapsUrl) {
        results.push({
          status: "error",
          placeName: placeName || "(missing placeName)",
          message: "Missing mandatory field(s): placeName and-or googleMapsUrl",
        });
        continue;
      }

      // Type resolution
      const type = normalizePlaceType(placeTypeHint) ?? inferPlaceTypeFromName(placeName);

      // Geo resolution - deterministic priority
      let lat: number | null = null;
      let lng: number | null = null;

      if (latCsv !== null && lngCsv !== null) {
        lat = latCsv;
        lng = lngCsv;
      } else {
        const decoded = decodePlusCode(plusCode);
        if (decoded) {
          lat = decoded.lat;
          lng = decoded.lon; // note: pluscode returns lon, Prisma uses lng
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

      // Upsert strategy for your private use:
      // - match by name
      // - update lat/lng/type if exists
      const existing = await prisma.place.findFirst({
        where: { name: placeName },
        select: { id: true },
      });

      if (existing) {
        await prisma.place.update({
          where: { id: existing.id },
          data: {
            type,
            lat,
            lng,
          },
        });
        results.push({ status: "updated", placeName });
      } else {
        await prisma.place.create({
          data: {
            name: placeName,
            type,
            lat,
            lng,
          },
        });
        results.push({ status: "created", placeName });
      }
    }

    const summary = {
      created: results.filter((x) => x.status === "created").length,
      updated: results.filter((x) => x.status === "updated").length,
      skipped: results.filter((x) => x.status === "skipped").length,
      error: results.filter((x) => x.status === "error").length,
    };

    return NextResponse.json({ ok: true, summary, results });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Import failed" },
      { status: 500 }
    );
  }
}
