import "dotenv/config";
import { prisma } from "../src/lib/prisma.ts";

function norm(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, " ");
}

function containsAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(norm(term)));
}

function uniqueText(parts: Array<unknown>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const part of parts) {
    const raw = String(part ?? "").trim();
    if (!raw) continue;
    const key = norm(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out.join("\n");
}

function inferCriteria(textRaw: string, type: "CAMPINGPLATZ" | "STELLPLATZ") {
  const text = norm(textRaw);

  const sigLuxury = containsAny(text, [
    "glamping",
    "resort",
    "holiday park",
    "ferienpark",
    "vacances",
    "village",
    "5 star",
    "4 star",
    "4 stelle",
    "5 stelle",
    "spa",
    "wellness",
    "premium",
    "domaine",
    "sandaya",
    "yelloh",
    "huttopia",
    "camping paradis",
  ]);
  const sigMunicipal = containsAny(text, ["municipal", "communal", "stads", "gemeinde", "city owned", "municipalite"]);
  const sigAire = type === "STELLPLATZ" || containsAny(text, ["aire", "camping-car", "camping car", "camperplaats", "motorhome stopover"]);
  const sigBooking = containsAny(text, ["online booking", "book online", "reservation", "reservations", "acsi", "pitchup", "booking"]);
  const sigFood = containsAny(text, ["restaurant", "bar", "bistro", "snack", "pizzeria", "brasserie", "cafe"]);
  const sigDogYes = containsAny(text, ["dog friendly", "dogs allowed", "chiens acceptes", "hunde erlaubt", "pets allowed"]);
  const sigDogNo = containsAny(text, ["no dogs", "dogs not allowed", "chiens interdits", "hunde verboten"]);
  const sigWinterYes = containsAny(text, ["open all year", "year round", "ganzjahrig", "ouvert toute l'annee", "winter camping"]);
  const sigWinterNo = containsAny(text, ["seasonal", "closed in winter", "ferme en hiver", "saison", "winter closed"]);

  return {
    dogAllowed: sigDogNo ? false : sigDogYes ? true : null,
    sanitary: sigLuxury ? true : sigAire ? false : null,
    yearRound: sigWinterNo ? false : sigWinterYes ? true : null,
    onlineBooking: sigBooking ? true : sigAire ? false : null,
    gastronomy: sigFood || sigLuxury ? true : null,
    reasons: [
      sigLuxury ? "luxury" : null,
      sigMunicipal ? "municipal" : null,
      sigAire ? "aire" : null,
      sigBooking ? "booking" : null,
      sigFood ? "food" : null,
      sigDogYes ? "dog-yes" : null,
      sigDogNo ? "dog-no" : null,
      sigWinterYes ? "winter-yes" : null,
      sigWinterNo ? "winter-no" : null,
    ].filter(Boolean) as string[],
  };
}

async function main() {
  const places = await prisma.place.findMany({
    where: { type: "CAMPINGPLATZ" },
    select: {
      id: true,
      name: true,
      type: true,
      heroReason: true,
      heroImageUrl: true,
      summaryWhyItMatches: true,
      bestVisitHint: true,
      sightDescription: true,
      canonicalSource: true,
      canonicalSourceId: true,
      wikipediaTitle: true,
      wikipediaUrl: true,
      dogAllowed: true,
      sanitary: true,
      yearRound: true,
      onlineBooking: true,
      gastronomy: true,
      ratingDetail: { select: { note: true, cUmgebung: true, cPlatzStruktur: true, cSanitaer: true, cBuchung: true, cHilde: true, cPreisLeistung: true, cNachklang: true } },
      ts21: { select: { note: true, dnaExplorerNote: true } },
    },
  });

  let updated = 0;
  const touched = { dogAllowed: 0, sanitary: 0, yearRound: 0, onlineBooking: 0, gastronomy: 0 };

  for (const place of places) {
    const evidence = uniqueText([
      place.name,
      place.heroReason,
      place.heroImageUrl,
      place.summaryWhyItMatches,
      place.bestVisitHint,
      place.sightDescription,
      place.canonicalSource,
      place.canonicalSourceId,
      place.wikipediaTitle,
      place.wikipediaUrl,
      place.ratingDetail?.note,
      place.ratingDetail?.cUmgebung,
      place.ratingDetail?.cPlatzStruktur,
      place.ratingDetail?.cSanitaer,
      place.ratingDetail?.cBuchung,
      place.ratingDetail?.cHilde,
      place.ratingDetail?.cPreisLeistung,
      place.ratingDetail?.cNachklang,
      place.ts21?.note,
      place.ts21?.dnaExplorerNote,
    ]);

    const inferred = inferCriteria(evidence, "CAMPINGPLATZ");
    const data: Record<string, boolean> = {};

    if (inferred.dogAllowed !== null && place.dogAllowed !== inferred.dogAllowed) data.dogAllowed = inferred.dogAllowed;
    if (inferred.sanitary !== null && place.sanitary !== inferred.sanitary) data.sanitary = inferred.sanitary;
    if (inferred.yearRound !== null && place.yearRound !== inferred.yearRound) data.yearRound = inferred.yearRound;
    if (inferred.onlineBooking !== null && place.onlineBooking !== inferred.onlineBooking) data.onlineBooking = inferred.onlineBooking;
    if (inferred.gastronomy !== null && place.gastronomy !== inferred.gastronomy) data.gastronomy = inferred.gastronomy;

    if (!Object.keys(data).length) continue;

    await prisma.place.update({
      where: { id: place.id },
      data,
    });

    updated += 1;
    for (const key of Object.keys(data) as Array<keyof typeof touched>) touched[key] += 1;
  }

  console.log(
    JSON.stringify(
      {
        scanned: places.length,
        updated,
        touched,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
