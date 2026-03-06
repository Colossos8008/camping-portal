// @ts-nocheck
import { scoreVisionByPlaceType, type VisionLabel } from "../src/lib/hero-type-scoring.ts";

type PlaceType = "CAMPINGPLATZ" | "STELLPLATZ" | "HVO_TANKSTELLE" | "SEHENSWUERDIGKEIT";

type Scenario = {
  name: string;
  placeType: PlaceType;
  labels: VisionLabel[];
  faceCount?: number;
  logoCount?: number;
  landmarkCount?: number;
  hasText?: boolean;
  safeSearchPenalized?: boolean;
  expect: (score: number) => boolean;
};

type ComparisonScenario = {
  name: string;
  placeType: PlaceType;
  better: {
    labels: VisionLabel[];
    faceCount?: number;
    logoCount?: number;
    landmarkCount?: number;
    hasText?: boolean;
    safeSearchPenalized?: boolean;
  };
  worse: {
    labels: VisionLabel[];
    faceCount?: number;
    logoCount?: number;
    landmarkCount?: number;
    hasText?: boolean;
    safeSearchPenalized?: boolean;
  };
  expect: (better: number, worse: number) => boolean;
};

function score(placeType: PlaceType, input: Omit<Scenario, "name" | "placeType" | "expect">): { score: number; reason: string } {
  return scoreVisionByPlaceType(placeType, {
    labels: input.labels,
    faceCount: input.faceCount ?? 0,
    logoCount: input.logoCount ?? 0,
    landmarkCount: input.landmarkCount ?? 0,
    hasText: input.hasText ?? false,
    safeSearchPenalized: input.safeSearchPenalized ?? false,
  });
}

function runScenario(s: Scenario): { ok: boolean; message: string } {
  const result = score(s.placeType, s);
  const ok = s.expect(result.score);
  const status = ok ? "PASS" : "FAIL";
  return {
    ok,
    message: `${status} ${s.name}: score=${result.score} reason=${result.reason}`,
  };
}

function runComparison(s: ComparisonScenario): { ok: boolean; message: string } {
  const better = score(s.placeType, s.better);
  const worse = score(s.placeType, s.worse);
  const ok = s.expect(better.score, worse.score);
  const status = ok ? "PASS" : "FAIL";
  return {
    ok,
    message: `${status} ${s.name}: better=${better.score} vs worse=${worse.score}`,
  };
}

const scenarios: Scenario[] = [
  {
    name: "CAMPINGPLATZ vehicle + natural-water + landscape => very high",
    placeType: "CAMPINGPLATZ",
    labels: [
      { description: "motorhome", score: 0.94 },
      { description: "lake", score: 0.88 },
      { description: "landscape", score: 0.9 },
      { description: "outdoor", score: 0.84 },
      { description: "mountain", score: 0.72 },
    ],
    expect: (score) => score >= 80,
  },
  {
    name: "CAMPINGPLATZ pool gets strong negative score",
    placeType: "CAMPINGPLATZ",
    labels: [
      { description: "swimming pool", score: 0.95 },
      { description: "resort pool", score: 0.9 },
      { description: "water park", score: 0.89 },
      { description: "outdoor", score: 0.7 },
    ],
    expect: (score) => score <= -30,
  },
  {
    name: "CAMPINGPLATZ indoor + face => low",
    placeType: "CAMPINGPLATZ",
    labels: [
      { description: "indoor", score: 0.92 },
      { description: "portrait", score: 0.9 },
      { description: "person", score: 0.88 },
    ],
    faceCount: 1,
    expect: (score) => score <= -35,
  },
  {
    name: "HVO_TANKSTELLE fuel dispenser + logo => poor",
    placeType: "HVO_TANKSTELLE",
    labels: [
      { description: "fuel dispenser", score: 0.95 },
      { description: "gas station", score: 0.93 },
      { description: "logo", score: 0.85 },
      { description: "text", score: 0.83 },
    ],
    logoCount: 1,
    hasText: true,
    expect: (score) => score <= -12,
  },
];

const comparisonScenarios: ComparisonScenario[] = [
  {
    name: "CAMPINGPLATZ natural water outranks pool",
    placeType: "CAMPINGPLATZ",
    better: {
      labels: [
        { description: "camper", score: 0.92 },
        { description: "river", score: 0.9 },
        { description: "landscape", score: 0.87 },
      ],
    },
    worse: {
      labels: [
        { description: "camper", score: 0.92 },
        { description: "swimming pool", score: 0.95 },
        { description: "outdoor", score: 0.87 },
      ],
    },
    expect: (better, worse) => better > worse,
  },
  {
    name: "CAMPINGPLATZ vehicle + natural-water + landscape beats generic landscape",
    placeType: "CAMPINGPLATZ",
    better: {
      labels: [
        { description: "camper van", score: 0.95 },
        { description: "ocean", score: 0.88 },
        { description: "landscape", score: 0.9 },
        { description: "outdoor", score: 0.85 },
      ],
    },
    worse: {
      labels: [
        { description: "landscape", score: 0.91 },
        { description: "outdoor", score: 0.89 },
        { description: "mountain", score: 0.82 },
      ],
    },
    expect: (better, worse) => better >= worse + 15,
  },
];

let allOk = true;
for (const scenario of scenarios) {
  const outcome = runScenario(scenario);
  if (!outcome.ok) allOk = false;
  console.log(outcome.message);
}

for (const scenario of comparisonScenarios) {
  const outcome = runComparison(scenario);
  if (!outcome.ok) allOk = false;
  console.log(outcome.message);
}

if (!allOk) {
  process.exitCode = 1;
}
