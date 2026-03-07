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
  assert(lighthousePhare.sightVisitModePrimary !== "EASY_STOP", "lighthouse should get a more specific visit mode");

  const fortMemorialViewpoint = rateSightseeing({
    type: "SEHENSWUERDIGKEIT",
    name: "Fort de la Pointe Memorial",
    category: "fortress",
    description: "Coastal fortress ruins and memorial overlooking a dramatic bay viewpoint",
    tags: ["fort", "ruins", "memorial", "bay", "viewpoint", "historic"],
  });
  assert(fortMemorialViewpoint.historyScore >= 3.5, "fort + memorial should score strong on history");
  assert(fortMemorialViewpoint.uniquenessScore >= 3, "fort + memorial viewpoint should have meaningful uniqueness");
  assert(fortMemorialViewpoint.sightRelevanceType !== "LOW_MATCH", "fort + memorial viewpoint should avoid LOW_MATCH");

  console.log("verify-sightseeing-rating: ok");
}

run();
