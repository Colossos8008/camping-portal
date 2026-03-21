import { NextRequest, NextResponse } from "next/server";
import { generatePlaceQualityReport, parseQualityPlaceType } from "@/lib/sightseeing-quality";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const placeType = parseQualityPlaceType(req.nextUrl.searchParams.get("type")) ?? "SEHENSWUERDIGKEIT";
    const report = await generatePlaceQualityReport(req.nextUrl.origin, placeType);

    return NextResponse.json({
      ok: true,
      ...report,
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? String(error) }, { status: 500 });
  }
}
