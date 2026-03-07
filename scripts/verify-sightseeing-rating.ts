async function loadRatingModule() {
  return import(new URL("../src/lib/sightseeing-rating.ts", import.meta.url).href);
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function run() {
  const { rateSightseeing } = await loadRatingModule();

  const nature = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Wild Atlantic Cliffs Viewpoint",
    description: "Spectacular cliff coast panorama with secluded headland and nature reserve trails",
    tags: ["coastal", "viewpoint", "panoramic"],
  });
  assert(nature.natureScore >= 4, "nature place should score high on nature");

  const architectureHistory = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Old Town Citadel",
    description: "UNESCO listed medieval town with cathedral, ramparts, fortress heritage and historic national monument remembrance",
  });
  assert(architectureHistory.architectureScore >= 4, "architecture/history place should score high on architecture");
  assert(architectureHistory.historyScore >= 3.5, "architecture/history place should score high on history");

  const iconicCrowded = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Iconic tidal abbey island",
    description: "Iconic UNESCO abbey and medieval landmark, must-see hotspot, crowded in peak season with queues",
  });
  assert(iconicCrowded.sightRelevanceType === "ICON", "iconic crowded place should stay ICON");
  assert(iconicCrowded.crowdRiskScore >= 3.5, "iconic crowded place should preserve crowd risk");
  assert(iconicCrowded.sightVisitModePrimary === "SMART_WINDOW", "iconic crowded place should suggest smart window");


  const lighthouseNameOnly = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Phare de la Pointe",
  });
  const lighthouseWithMetadata = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Phare de la Pointe",
    category: "lighthouse",
    description: "Historic coastal lighthouse viewpoint with memorial traces and fort remains",
    tags: ["viewpoint", "coastal", "fort", "memorial", "megalithic"],
    source: "OSM/Overpass",
    region: "normandie",
    country: "France",
  });
  assert(
    lighthouseWithMetadata.sightseeingTotalScore > lighthouseNameOnly.sightseeingTotalScore,
    "metadata-enriched lighthouse should score higher than name-only input"
  );
  assert(
    lighthouseWithMetadata.sightRelevanceType !== "LOW_MATCH",
    "metadata-enriched lighthouse should avoid LOW_MATCH"
  );

  const entertainment = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Mega Entertainment Mall Park",
    description: "Indoor attraction with gaming, shopping and amusement family park area",
  });
  assert(entertainment.sightRelevanceType === "LOW_MATCH" || entertainment.sightRelevanceType === "OPTIONAL", "entertainment spot should rank low");

  const megalithicArchaeology = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Allée couverte de Bretteville",
    category: "archaeological_site",
    description: "Prehistoric megalithic passage grave with archaeological significance",
    tags: [
      "archaeological_site:megalith",
      "historic:archaeological_site",
      "historic:civilization:prehistoric",
      "megalith_type:passage_grave",
      "wikidata:Q2838858",
      "wikipedia:fr:Allee couverte de Bretteville",
    ],
  });
  assert(megalithicArchaeology.historyScore >= 4, "megalithic archaeology should be clearly strong on history");
  assert(megalithicArchaeology.uniquenessScore >= 3.5, "megalithic archaeology should not have low uniqueness");
  assert(megalithicArchaeology.sightRelevanceType !== "LOW_MATCH", "megalithic archaeology should avoid LOW_MATCH");

  const lighthousePhare = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Phare du Cap",
    category: "lighthouse",
    description: "Historic phare on coastal cliff with panoramic viewpoint",
    tags: ["phare", "coastal", "viewpoint", "panorama", "wikidata:Q12345"],
  });
  assert(lighthousePhare.architectureScore >= 3.5, "lighthouse should be strong on architecture");
  assert(lighthousePhare.natureScore >= 3.5, "lighthouse cliff setting should be strong on nature");
  assert(lighthousePhare.uniquenessScore >= 3, "lighthouse should have meaningful uniqueness");
  assert(
    lighthousePhare.sightVisitModePrimary === "OUTSIDE_BEST" ||
      lighthousePhare.sightVisitModeSecondary === "OUTSIDE_BEST",
    "coastal lighthouse should include OUTSIDE_BEST as preferred mode"
  );
  assert(lighthousePhare.sightRelevanceType !== "LOW_MATCH", "lighthouse should avoid LOW_MATCH");

  const fortMemorialViewpoint = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Fort de la Pointe Memorial",
    category: "fortress",
    description: "Coastal fortress ruins and memorial overlooking a dramatic bay viewpoint",
    tags: ["fort", "ruins", "memorial", "bay", "viewpoint", "historic"],
  });
  assert(fortMemorialViewpoint.architectureScore >= 3.2, "fort + ruins should be strong on architecture");
  assert(fortMemorialViewpoint.historyScore >= 3.5, "fort + memorial should score strong on history");
  assert(fortMemorialViewpoint.uniquenessScore >= 3, "fort + memorial viewpoint should have meaningful uniqueness");
  assert(
    fortMemorialViewpoint.sightVisitModePrimary === "OUTSIDE_BEST" ||
      fortMemorialViewpoint.sightVisitModePrimary === "MAIN_DESTINATION" ||
      fortMemorialViewpoint.sightVisitModeSecondary === "OUTSIDE_BEST",
    "coastal fortification should keep OUTSIDE_BEST or MAIN_DESTINATION orientation"
  );
  assert(fortMemorialViewpoint.sightRelevanceType !== "LOW_MATCH", "fort + memorial viewpoint should avoid LOW_MATCH");

  const deportationMemorial = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Mémorial de la déportation",
    category: "memorial",
    description: "Major deportation remembrance site tied to resistance and occupation history",
    tags: ["memorial", "deportation", "remembrance", "resistance", "occupation", "historic"],
  });
  assert(deportationMemorial.historyScore >= 4, "deportation remembrance memorial should be strong on history");
  assert(deportationMemorial.uniquenessScore >= 3, "deportation remembrance memorial should not stay low uniqueness");
  assert(
    deportationMemorial.sightRelevanceType === "OPTIONAL" || deportationMemorial.sightRelevanceType === "GOOD_MATCH" || deportationMemorial.sightRelevanceType === "ICON",
    "deportation remembrance memorial should reach at least OPTIONAL"
  );

  const majorFortress = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Major Fortress Citadel",
    category: "fortress",
    description: "Iconic major fortress and fortified citadel with monument heritage and major attraction viewpoint",
    tags: ["fortress", "major fortress", "landmark", "iconic", "major-attraction", "historic"],
  });
  assert(majorFortress.architectureScore >= 4, "major fortress should score very high on architecture");
  assert(majorFortress.sightRelevanceType === "ICON", "major fortress profile should reach ICON");
  assert(
    majorFortress.sightVisitModePrimary === "MAIN_DESTINATION" ||
      majorFortress.sightVisitModePrimary === "OUTSIDE_BEST" ||
      majorFortress.sightVisitModeSecondary === "MAIN_DESTINATION",
    "major fortress should be treated as destination-oriented profile"
  );

  const iconicCastle = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Iconic Medieval Castle",
    category: "castle",
    description: "Iconic medieval castle landmark and major attraction with preserved fortification history",
    tags: ["castle", "medieval-castle", "iconic-castle", "landmark", "major-attraction"],
  });
  assert(iconicCastle.architectureScore >= 4, "iconic medieval castle should score very high on architecture");
  assert(iconicCastle.uniquenessScore >= 4, "iconic medieval castle should score very high on uniqueness");
  assert(iconicCastle.sightRelevanceType === "ICON" || iconicCastle.sightRelevanceType === "GOOD_MATCH", "iconic castle should be ICON or GOOD_MATCH");

  const abbeyMonastery = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Abtei am See",
    category: "abbey",
    description: "Romanesque abbey and monastery with basilica, pilgrimage tradition and historic religious heritage",
    tags: ["abbey", "monastery", "basilica", "pilgrimage", "major-attraction"],
  });
  assert(abbeyMonastery.historyScore >= 3, "abbey/monastery should be solid on history");
  assert(abbeyMonastery.architectureScore >= 3, "abbey/monastery should be solid on architecture");
  assert(abbeyMonastery.sightRelevanceType !== "LOW_MATCH", "abbey/monastery should avoid LOW_MATCH");

  const historicQuarter = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Altstadt am Fluss",
    category: "historic-quarter",
    description: "Historic quarter and old town center with monument ensemble and major attraction squares",
    tags: ["historic-quarter", "old-town", "historic-center", "monument", "major-attraction"],
  });
  assert(historicQuarter.historyScore >= 3, "historic quarter should be strong on history");
  assert(historicQuarter.sightRelevanceType !== "LOW_MATCH", "historic quarter should avoid LOW_MATCH");
  assert(historicQuarter.sightVisitModePrimary === "EASY_STOP" || historicQuarter.sightVisitModePrimary === "MAIN_DESTINATION", "historic quarter should be stop or destination");

  const nationalMonument = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Rivers Confluence Monument",
    category: "landmark",
    description: "National monument at a rivers confluence headland, iconic landmark and major viewpoint",
    tags: ["landmark", "national-monument", "rivers-confluence", "major-viewpoint", "major-attraction"],
  });
  assert(nationalMonument.uniquenessScore >= 3.2, "national monument landmark should have notable uniqueness");
  assert(nationalMonument.sightRelevanceType !== "LOW_MATCH", "national monument landmark should avoid LOW_MATCH");

  const geothermalGeyser = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Geothermal Geyser",
    category: "natural-attraction",
    description: "Geothermal geyser and major natural attraction with viewpoint",
    tags: ["geyser", "geysir", "geothermal", "natural-attraction", "major-attraction"],
  });
  assert(geothermalGeyser.uniquenessScore >= 3.2, "geothermal geyser should have strong uniqueness");
  assert(geothermalGeyser.sightRelevanceType !== "LOW_MATCH", "geothermal geyser should avoid LOW_MATCH");
  assert(geothermalGeyser.sightVisitModePrimary === "MAIN_DESTINATION" || geothermalGeyser.sightVisitModeSecondary === "MAIN_DESTINATION", "geothermal geyser should be treated as a destination");

  console.log("verify-sightseeing-rating: ok");
}

run();
