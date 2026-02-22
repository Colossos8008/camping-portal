import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type TSValue = "STIMMIG" | "OKAY" | "PASST_NICHT";
type TSHaltung = "DNA" | "EXPLORER";

function normTS(v: unknown): TSValue {
  const s = String(v ?? "OKAY").toUpperCase();
  if (s === "STIMMIG") return "STIMMIG";
  if (s === "PASST_NICHT") return "PASST_NICHT";
  return "OKAY";
}

function normHaltung(v: unknown): TSHaltung {
  const s = String(v ?? "DNA").toUpperCase();
  if (s === "EXPLORER") return "EXPLORER";
  return "DNA";
}

function computeTotal10(rd: any, prefix: "user" | "ai"): number | null {
  const keys = [
    "HundAmPlatz",
    "GassiUmfeld",
    "Buchung",
    "Ankommen",
    "SanitaerPrivat",
    "Umgebung",
    "Stellplatz",
    "Ruhe",
    "Nachklang",
    "Wiederkommen",
  ];

  const anySet = keys.some((k) => rd?.[`${prefix}${k}`] != null);
  if (prefix === "user" && !anySet) return null;

  function pts(v: TSValue | null | undefined) {
    if (v === "STIMMIG") return 2;
    if (v === "OKAY") return 1;
    return 0;
  }

  return keys.reduce((sum, k) => sum + pts(rd?.[`${prefix}${k}`]), 0);
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const placeId = Number(id);
    if (!Number.isFinite(placeId)) return new NextResponse("Bad id", { status: 400 });

    const body = await req.json().catch(() => ({} as any));
    const rd = body?.ratingDetail ?? body ?? {};

    const payload: any = {
      // TS 2.1 – User Bewertung
      userHaltung: rd.userHaltung == null ? null : normHaltung(rd.userHaltung),
      userHundAmPlatz: rd.userHundAmPlatz == null ? null : normTS(rd.userHundAmPlatz),
      userGassiUmfeld: rd.userGassiUmfeld == null ? null : normTS(rd.userGassiUmfeld),
      userBuchung: rd.userBuchung == null ? null : normTS(rd.userBuchung),
      userAnkommen: rd.userAnkommen == null ? null : normTS(rd.userAnkommen),
      userSanitaerPrivat: rd.userSanitaerPrivat == null ? null : normTS(rd.userSanitaerPrivat),
      userUmgebung: rd.userUmgebung == null ? null : normTS(rd.userUmgebung),
      userStellplatz: rd.userStellplatz == null ? null : normTS(rd.userStellplatz),
      userRuhe: rd.userRuhe == null ? null : normTS(rd.userRuhe),
      userNachklang: rd.userNachklang == null ? null : normTS(rd.userNachklang),
      userWiederkommen: rd.userWiederkommen == null ? null : normTS(rd.userWiederkommen),
      userNote: String(rd.userNote ?? ""),

      // Verifikation
      haltungVerified: !!rd.haltungVerified,
    };

    const userTotal = computeTotal10(payload, "user");
    payload.userTotalPoints = userTotal;

    const updated = await prisma.place.update({
      where: { id: placeId },
      data: {
        ratingDetail: {
          upsert: {
            create: {
              // Minimal – aber vollständig genug für neue Places
              tsUmgebung: "OKAY",
              tsPlatzStruktur: "OKAY",
              tsSanitaer: "OKAY",
              tsBuchung: "OKAY",
              tsHilde: "OKAY",
              tsPreisLeistung: "OKAY",
              tsNachklang: "OKAY",
              totalPoints: 7,
              note: "",
              cUmgebung: "",
              cPlatzStruktur: "",
              cSanitaer: "",
              cBuchung: "",
              cHilde: "",
              cPreisLeistung: "",
              cNachklang: "",

              aiHaltung: "DNA",
              aiHundAmPlatz: "OKAY",
              aiGassiUmfeld: "OKAY",
              aiBuchung: "OKAY",
              aiAnkommen: "OKAY",
              aiSanitaerPrivat: "OKAY",
              aiUmgebung: "OKAY",
              aiStellplatz: "OKAY",
              aiRuhe: "OKAY",
              aiNachklang: "OKAY",
              aiWiederkommen: "OKAY",
              aiTotalPoints: 10,
              aiNote: "",

              userHaltung: payload.userHaltung,
              userHundAmPlatz: payload.userHundAmPlatz,
              userGassiUmfeld: payload.userGassiUmfeld,
              userBuchung: payload.userBuchung,
              userAnkommen: payload.userAnkommen,
              userSanitaerPrivat: payload.userSanitaerPrivat,
              userUmgebung: payload.userUmgebung,
              userStellplatz: payload.userStellplatz,
              userRuhe: payload.userRuhe,
              userNachklang: payload.userNachklang,
              userWiederkommen: payload.userWiederkommen,
              userTotalPoints: payload.userTotalPoints,
              userNote: payload.userNote,

              haltungVerified: payload.haltungVerified,
            },
            update: payload,
          },
        },
      },
      include: { ratingDetail: true },
    });

    return NextResponse.json(updated.ratingDetail);
  } catch (e: any) {
    return new NextResponse(e?.message || "Rating update failed", { status: 500 });
  }
}