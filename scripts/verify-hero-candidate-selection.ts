// @ts-nocheck
import { selectHeroCandidateByThreshold, type HeroCandidate } from "../src/lib/hero-candidate-selection.ts";
import { scoreVisionByPlaceType, type PlaceType, type VisionLabel } from "../src/lib/hero-type-scoring.ts";

type Scenario = {
  name: string;
  placeType: PlaceType;
  candidates: HeroCandidate[];
  expect: (selection: ReturnType<typeof selectHeroCandidateByThreshold>) => boolean;
};

function score(placeType: PlaceType, labels: VisionLabel[], extras?: { faceCount?: number; logoCount?: number; hasText?: boolean }): number {
  return scoreVisionByPlaceType(placeType, {
    labels,
    faceCount: extras?.faceCount ?? 0,
    logoCount: extras?.logoCount ?? 0,
    landmarkCount: 0,
    hasText: extras?.hasText ?? false,
    safeSearchPenalized: false,
  }).score;
}

const scenicVehicleCamping = score("CAMPINGPLATZ", [
  { description: "motorhome", score: 0.96 },
  { description: "lake", score: 0.91 },
  { description: "landscape", score: 0.92 },
  { description: "outdoor", score: 0.88 },
]);

const neutralCamping = score("CAMPINGPLATZ", [
  { description: "vehicle", score: 0.58 },
  { description: "outdoor", score: 0.45 },
]);

const poorCamping = score("CAMPINGPLATZ", [
  { description: "logo", score: 0.9 },
  { description: "text", score: 0.85 },
  { description: "indoor", score: 0.7 },
]);

const hvoNeutralExterior = score("HVO_TANKSTELLE", [
  { description: "building", score: 0.86 },
  { description: "outdoor", score: 0.84 },
]);

const hvoLogoPump = score(
  "HVO_TANKSTELLE",
  [
    { description: "fuel dispenser", score: 0.95 },
    { description: "logo", score: 0.9 },
    { description: "text", score: 0.82 },
  ],
  { logoCount: 1, hasText: true }
);

const scenarios: Scenario[] = [
  {
    name: "accepts real candidate when acceptable candidate exists",
    placeType: "SEHENSWUERDIGKEIT",
    candidates: [
      { source: "google", score: 7, url: "https://example.com/a.jpg" },
      { source: "wikimedia", score: -2, url: "https://example.com/b.jpg" },
    ],
    expect: (selection) => selection.chosen?.url === "https://example.com/a.jpg" && selection.bestPreferred === null,
  },
  {
    name: "CAMPINGPLATZ prefers scenic vehicle/water candidate",
    placeType: "CAMPINGPLATZ",
    candidates: [
      { source: "google", score: neutralCamping, url: "https://example.com/neutral.jpg" },
      { source: "wikimedia", score: scenicVehicleCamping, url: "https://example.com/scenic.jpg" },
      { source: "google", score: poorCamping, url: "https://example.com/poor.jpg" },
    ],
    expect: (selection) => selection.chosen?.url === "https://example.com/scenic.jpg" && selection.bestPreferred?.score === scenicVehicleCamping,
  },
  {
    name: "HVO neutral exterior beats logo/fuel-dispenser candidate",
    placeType: "HVO_TANKSTELLE",
    candidates: [
      { source: "google", score: hvoLogoPump, url: "https://example.com/logo.jpg" },
      { source: "wikimedia", score: hvoNeutralExterior, url: "https://example.com/exterior.jpg" },
    ],
    expect: (selection) => selection.chosen?.url === "https://example.com/exterior.jpg",
  },
  {
    name: "no acceptable candidate => placeholder path expected",
    placeType: "STELLPLATZ",
    candidates: [
      { source: "google", score: -20, url: "https://example.com/bad1.jpg" },
      { source: "wikimedia", score: -8, url: "https://example.com/bad2.jpg" },
    ],
    expect: (selection) => selection.chosen === null && selection.bestOverall?.score === -8,
  },
];

let allOk = true;
for (const scenario of scenarios) {
  const selection = selectHeroCandidateByThreshold(scenario.placeType, scenario.candidates);
  const ok = scenario.expect(selection);
  const msg = `${ok ? "PASS" : "FAIL"} ${scenario.name} => chosen=${selection.chosen?.url ?? "<placeholder>"} thresholds(preferred>=${selection.thresholds.preferredMin}, acceptable>=${selection.thresholds.acceptableMin})`;
  console.log(msg);
  if (!ok) allOk = false;
}

if (!allOk) {
  process.exitCode = 1;
}
