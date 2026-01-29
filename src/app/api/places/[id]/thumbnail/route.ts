import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

function getPlaceIdFromPath(req: NextRequest): number {
  // /api/places/:id/thumbnail  -> :id
  const parts = req.nextUrl.pathname.split("/").filter(Boolean);
  const placesIdx = parts.lastIndexOf("places");
  const idStr = placesIdx >= 0 ? parts[placesIdx + 1] : "";
  return Number(idStr);
}

export async function POST(req: NextRequest) {
  const placeId = getPlaceIdFromPath(req);
  if (!Number.isFinite(placeId)) return NextResponse.json({ error: "Invalid id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const imageId = Number(body?.imageId);

  if (!Number.isFinite(imageId)) return NextResponse.json({ error: "Invalid imageId" }, { status: 400 });

  const img = await prisma.image.findUnique({ where: { id: imageId } });
  if (!img || img.placeId !== placeId) return NextResponse.json({ error: "Image not found" }, { status: 404 });

  // braucht in Prisma-Schema: Place.thumbnailImageId Int?
  const updated = await prisma.place.update({
    where: { id: placeId },
    data: { thumbnailImageId: imageId },
    include: { images: true, ratingDetail: true },
  });

  return NextResponse.json(updated);
}
