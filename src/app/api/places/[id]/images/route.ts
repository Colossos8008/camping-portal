import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const BUCKET = "place-images";

function getPlaceIdFromPath(req: NextRequest): number {
  // /api/places/:id/images  -> :id
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const placesIdx = parts.lastIndexOf("places");
  const idStr = placesIdx >= 0 ? parts[placesIdx + 1] : "";
  return Number(idStr);
}

function getSupabaseAdmin() {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing env SUPABASE_URL");
  if (!serviceRoleKey) throw new Error("Missing env SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Erwartet JSON Body:
 * {
 *   "files": [
 *     { "path": "places/123/170...-image.jpg", "originalName": "image.jpg", "contentType": "image/jpeg", "size": 12345 }
 *   ]
 * }
 *
 * WICHTIG:
 * - Die Datei wird NICHT hier hochgeladen
 * - Upload passiert direkt vom Browser nach Supabase Storage
 * - Diese Route speichert nur DB-Metadaten
 */
export async function POST(req: NextRequest) {
  const placeId = getPlaceIdFromPath(req);
  if (!Number.isFinite(placeId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      {
        error:
          "Invalid JSON body. This endpoint no longer accepts multipart uploads. Upload files directly to Supabase Storage, then POST metadata here.",
      },
      { status: 400 }
    );
  }

  const files = Array.isArray(body?.files) ? body.files : [];
  if (!files.length) {
    return NextResponse.json({ error: "No files provided" }, { status: 400 });
  }

  const created: any[] = [];

  for (const f of files) {
    const storagePath = String(f?.path || "").trim();
    if (!storagePath) continue;

    // Wir verwenden das bestehende Feld "filename" weiter - jetzt ist es der Storage-Pfad
    // Keine Schema-Aenderung notwendig
    const img = await prisma.image.create({
      data: {
        placeId,
        filename: storagePath,
      },
    });

    created.push(img);
  }

  return NextResponse.json({ images: created });
}

/**
 * DELETE loescht:
 * - Datei aus Supabase Storage (Bucket place-images)
 * - DB-Eintrag (prisma.image)
 *
 * Query:
 * - ?imageId=123
 */
export async function DELETE(req: NextRequest) {
  const placeId = getPlaceIdFromPath(req);
  if (!Number.isFinite(placeId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const imageId = Number(req.nextUrl.searchParams.get("imageId"));
  if (!Number.isFinite(imageId)) {
    return NextResponse.json({ error: "Invalid imageId" }, { status: 400 });
  }

  const img = await prisma.image.findUnique({ where: { id: imageId } });
  if (!img || img.placeId !== placeId) {
    return NextResponse.json({ error: "Image not found" }, { status: 404 });
  }

  const storagePath = img.filename;

  try {
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.storage.from(BUCKET).remove([storagePath]);
    if (error) {
      return NextResponse.json(
        { error: `Storage delete failed: ${error.message}` },
        { status: 500 }
      );
    }
  } catch (e: any) {
    return NextResponse.json(
      { error: `Storage delete failed: ${e?.message || String(e)}` },
      { status: 500 }
    );
  }

  await prisma.image.delete({ where: { id: imageId } });

  return NextResponse.json({ ok: true });
}
