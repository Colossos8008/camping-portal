import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

const ALL_TYPES: PlaceType[] = [
  "CAMPINGPLATZ",
  "STELLPLATZ",
  "HVO_TANKSTELLE",
  "SEHENSWUERDIGKEIT",
];

export async function GET() {
  try {
    const counts = await Promise.all(
      ALL_TYPES.map(async (t) => {
        const c = await prisma.place.count({ where: { type: t } });
        return [t, c] as const;
      })
    );

    const countsByType = Object.fromEntries(counts) as Record<PlaceType, number>;
    const total = Object.values(countsByType).reduce((a, b) => a + b, 0);

    return NextResponse.json({ ok: true, countsByType, total }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}