import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import fs from "fs";
import path from "path";

export const runtime = "nodejs";

function getPlaceIdFromPath(req: NextRequest): number {
  // /api/places/:id/images  -> :id
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const placesIdx = parts.lastIndexOf("places");
  const idStr = placesIdx >= 0 ? parts[placesIdx + 1] : "";
  return Number(idStr);
}

function ensureUploadDir(): string {
  const uploadDir = path.join(process.cwd(), "public", "uploads");
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
  return uploadDir;
}

function safeFilename(original: string) {
  const base = String(original || "image")
    .replace(/[^a-zA-Z0-9.\-_]/g, "_")
    .replace(/_+/g, "_");
  return `${Date.now()}-${Math.random().toString(16).slice(2)}-${base}`;
}

export async function POST(req: NextRequest) {
  const placeId = getPlaceIdFromPath(req);
  if (!Number.isFinite(placeId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const formData = await req.formData();
  const files = formData.getAll("files");

  if (!files.length) return NextResponse.json({ error: "No files uploaded" }, { status: 400 });

  const uploadDir = ensureUploadDir();
  const created: any[] = [];

  for (const f of files) {
    if (!(f instanceof File)) continue;

    const arrayBuf = await f.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    const filename = safeFilename(f.name);
    const absPath = path.join(uploadDir, filename);

    fs.writeFileSync(absPath, buf);

    const img = await prisma.image.create({
      data: {
        placeId,
        filename,
      },
    });

    created.push(img);
  }

  return NextResponse.json({ images: created });
}

export async function DELETE(req: NextRequest) {
  const placeId = getPlaceIdFromPath(req);
  if (!Number.isFinite(placeId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const imageId = Number(req.nextUrl.searchParams.get("imageId"));
  if (!Number.isFinite(imageId)) return NextResponse.json({ error: "Invalid imageId" }, { status: 400 });

  const img = await prisma.image.findUnique({ where: { id: imageId } });
  if (!img || img.placeId !== placeId) return NextResponse.json({ error: "Image not found" }, { status: 404 });

  const absPath = path.join(process.cwd(), "public", "uploads", img.filename);
  if (fs.existsSync(absPath)) fs.unlinkSync(absPath);

  await prisma.image.delete({ where: { id: imageId } });

  return NextResponse.json({ ok: true });
}
