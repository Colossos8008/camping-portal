import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const BUCKET = "place-images";

function getPlaceIdFromPath(req: NextRequest): number {
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const placesIdx = parts.lastIndexOf("places");
  const idStr = placesIdx >= 0 ? parts[placesIdx + 1] : "";
  return Number(idStr);
}

function getSupabaseServerClient() {
  const url = process.env.SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url) throw new Error("Missing env SUPABASE_URL");
  if (!serviceRole) throw new Error("Missing env SUPABASE_SERVICE_ROLE_KEY");

  return createClient(url, serviceRole, {
    auth: { persistSession: false },
  });
}

type RegisterImageInput = {
  filename: string;
};

type RegisterBody = {
  images: RegisterImageInput[];
};

export async function POST(req: NextRequest) {
  const placeId = getPlaceIdFromPath(req);
  if (!Number.isFinite(placeId)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json(
      {
        error:
          "Upload payload too large on Vercel. Upload files directly to Supabase Storage from the browser, then call this endpoint with JSON { images: [{ filename }] }.",
      },
      { status: 415 }
    );
  }

  const body = (await req.json()) as RegisterBody;
  const images = Array.isArray(body?.images) ? body.images : [];

  if (!images.length) {
    return NextResponse.json({ error: "No images provided" }, { status: 400 });
  }

  const created = [];
  for (const img of images) {
    const filename = String(img?.filename || "").trim();
    if (!filename) continue;

    const row = await prisma.image.create({
      data: {
        placeId,
        filename,
      },
    });
    created.push(row);
  }

  return NextResponse.json({ images: created });
}

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

  const supabase = getSupabaseServerClient();

  const { error: storageErr } = await supabase.storage.from(BUCKET).remove([img.filename]);
  if (storageErr) {
    return NextResponse.json(
      { error: "Storage delete failed", details: storageErr.message },
      { status: 500 }
    );
  }

  await prisma.image.delete({ where: { id: imageId } });

  return NextResponse.json({ ok: true });
}
