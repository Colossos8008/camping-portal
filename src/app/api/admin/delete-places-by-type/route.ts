import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";

type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

const ALL_TYPES: PlaceType[] = [
  "CAMPINGPLATZ",
  "STELLPLATZ",
  "HVO_TANKSTELLE",
  "SEHENSWUERDIGKEIT",
];

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { type?: PlaceType } | null;
    const type = body?.type;

    if (!type || !ALL_TYPES.includes(type)) {
      return NextResponse.json({ ok: false, error: "Invalid type" }, { status: 400 });
    }

    const res = await prisma.place.deleteMany({ where: { type } });

    return NextResponse.json({ ok: true, type, deleted: res.count ?? 0 }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
