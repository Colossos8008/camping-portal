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

  console.log("verify-sightseeing-rating: ok");
}

run();
