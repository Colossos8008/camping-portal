import type { RatingDetail, TSValue, TSHaltung } from "../ts-editor";

export const TS_DEFAULT: TSValue = "OKAY";

export function tsToPoints(v: TSValue | null | undefined): number {
  if (v === "STIMMIG") return 2;
  if (v === "OKAY") return 1;
  return 0;
}

export function computeTs21Total(input: {
  hundAmPlatz: TSValue | null | undefined;
  gassiUmfeld: TSValue | null | undefined;
  buchung: TSValue | null | undefined;
  ankommen: TSValue | null | undefined;
  sanitaerPrivat: TSValue | null | undefined;
  umgebung: TSValue | null | undefined;
  stellplatz: TSValue | null | undefined;
  ruhe: TSValue | null | undefined;
  nachklang: TSValue | null | undefined;
  wiederkommen: TSValue | null | undefined;
}): number {
  return (
    tsToPoints(input.hundAmPlatz) +
    tsToPoints(input.gassiUmfeld) +
    tsToPoints(input.buchung) +
    tsToPoints(input.ankommen) +
    tsToPoints(input.sanitaerPrivat) +
    tsToPoints(input.umgebung) +
    tsToPoints(input.stellplatz) +
    tsToPoints(input.ruhe) +
    tsToPoints(input.nachklang) +
    tsToPoints(input.wiederkommen)
  );
}

export function blankRating(): RatingDetail {
  const aiTotal = computeTs21Total({
    hundAmPlatz: TS_DEFAULT,
    gassiUmfeld: TS_DEFAULT,
    buchung: TS_DEFAULT,
    ankommen: TS_DEFAULT,
    sanitaerPrivat: TS_DEFAULT,
    umgebung: TS_DEFAULT,
    stellplatz: TS_DEFAULT,
    ruhe: TS_DEFAULT,
    nachklang: TS_DEFAULT,
    wiederkommen: TS_DEFAULT,
  });

  return {
    // TS 1 legacy – bleibt, damit nix crasht
    tsUmgebung: TS_DEFAULT,
    tsPlatzStruktur: TS_DEFAULT,
    tsSanitaer: TS_DEFAULT,
    tsBuchung: TS_DEFAULT,
    tsHilde: TS_DEFAULT,
    tsPreisLeistung: TS_DEFAULT,
    tsNachklang: TS_DEFAULT,
    totalPoints: 7,
    note: "",
    cUmgebung: "",
    cPlatzStruktur: "",
    cSanitaer: "",
    cBuchung: "",
    cHilde: "",
    cPreisLeistung: "",
    cNachklang: "",

    // TS 2.1 AI
    aiHaltung: "DNA" as TSHaltung,
    aiHundAmPlatz: TS_DEFAULT,
    aiGassiUmfeld: TS_DEFAULT,
    aiBuchung: TS_DEFAULT,
    aiAnkommen: TS_DEFAULT,
    aiSanitaerPrivat: TS_DEFAULT,
    aiUmgebung: TS_DEFAULT,
    aiStellplatz: TS_DEFAULT,
    aiRuhe: TS_DEFAULT,
    aiNachklang: TS_DEFAULT,
    aiWiederkommen: TS_DEFAULT,
    aiTotalPoints: aiTotal,
    aiNote: "",

    // TS 2.1 User – leer bis Besuch
    userHaltung: null,
    userHundAmPlatz: null,
    userGassiUmfeld: null,
    userBuchung: null,
    userAnkommen: null,
    userSanitaerPrivat: null,
    userUmgebung: null,
    userStellplatz: null,
    userRuhe: null,
    userNachklang: null,
    userWiederkommen: null,
    userTotalPoints: null,
    userNote: "",

    haltungVerified: false,
  };
}

export function effectiveTs21Total(rd: RatingDetail): number {
  const userTotal = typeof rd.userTotalPoints === "number" ? rd.userTotalPoints : null;
  if (userTotal != null && Number.isFinite(userTotal)) return userTotal;

  const aiTotal = typeof rd.aiTotalPoints === "number" ? rd.aiTotalPoints : null;
  if (aiTotal != null && Number.isFinite(aiTotal)) return aiTotal;

  // Fallback – TS 1 legacy
  return Number(rd.totalPoints ?? 0) || 0;
}