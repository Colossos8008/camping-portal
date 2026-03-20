import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type TripPlaceStatus = "GEPLANT" | "BOOKED" | "CONFIRMED" | "VISITED";

function asString(v: unknown): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function asOptionalBoolean(v: unknown): boolean | undefined {
  if (v == null) return undefined;
  return !!v;
}

function normalizeTripPlaceStatus(v: unknown): TripPlaceStatus {
  return v === "BOOKED" || v === "CONFIRMED" || v === "VISITED" ? v : "GEPLANT";
}

function normalizeTripPlaces(v: unknown) {
  if (!Array.isArray(v)) return [];

  const out: Array<{ placeId: number; sortOrder: number; dayNumber: number; status: TripPlaceStatus; note: string }> = [];

  for (const item of v) {
    const placeId = Number((item as any)?.placeId);
    const sortOrder = Number((item as any)?.sortOrder);
    const dayNumber = Number((item as any)?.dayNumber);
    if (!Number.isFinite(placeId) || !Number.isFinite(sortOrder)) continue;
    out.push({
      placeId,
      sortOrder: Math.max(1, Math.round(sortOrder)),
      dayNumber: Number.isFinite(dayNumber) ? Math.max(1, Math.round(dayNumber)) : 1,
      status: normalizeTripPlaceStatus((item as any)?.status),
      note: asString((item as any)?.note),
    });
  }

  return out;
}

const tripSelect = {
  id: true,
  name: true,
  description: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  places: {
    orderBy: { sortOrder: "asc" as const },
    select: {
      id: true,
      tripId: true,
      placeId: true,
      sortOrder: true,
      dayNumber: true,
      status: true,
      note: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} as const;

export async function GET() {
  try {
    const trips = await prisma.trip.findMany({
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      select: tripSelect,
    });

    return NextResponse.json({ trips });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? String(error) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const name = asString((body as any)?.name).trim();
  if (!name) return NextResponse.json({ error: "Name fehlt" }, { status: 400 });

  try {
    const trip = await prisma.trip.create({
      data: {
        name,
        description: asString((body as any)?.description),
        isActive: asOptionalBoolean((body as any)?.isActive) ?? true,
        places: {
          create: normalizeTripPlaces((body as any)?.places),
        },
      },
      select: tripSelect,
    });

    return NextResponse.json(trip);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? String(error) }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const id = Number((body as any)?.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id fehlt" }, { status: 400 });

  const data: any = {};
  if ((body as any)?.name !== undefined) {
    const name = asString((body as any)?.name).trim();
    if (!name) return NextResponse.json({ error: "Name fehlt" }, { status: 400 });
    data.name = name;
  }
  if ((body as any)?.description !== undefined) data.description = asString((body as any)?.description);
  if ((body as any)?.isActive !== undefined) data.isActive = !!(body as any)?.isActive;
  if ((body as any)?.places !== undefined) {
    const places = normalizeTripPlaces((body as any)?.places);
    data.places = {
      deleteMany: {},
      create: places,
    };
  }

  try {
    const trip = await prisma.trip.update({
      where: { id },
      data,
      select: tripSelect,
    });

    return NextResponse.json(trip);
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? String(error) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });

  const id = Number((body as any)?.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "id fehlt" }, { status: 400 });

  try {
    await prisma.trip.delete({ where: { id } });
    return NextResponse.json({ ok: true, id });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message ?? String(error) }, { status: 500 });
  }
}
