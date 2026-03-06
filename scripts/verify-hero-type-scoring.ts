// @ts-nocheck
import { scoreVisionByPlaceType, type VisionLabel } from "../src/lib/hero-type-scoring.ts";

type Scenario = {
  name: string;
  placeType: "CAMPINGPLATZ" | "STELLPLATZ" | "HVO_TANKSTELLE" | "SEHENSWUERDIGKEIT";
  labels: VisionLabel[];
  faceCount?: number;
  logoCount?: number;
  landmarkCount?: number;
  hasText?: boolean;
  safeSearchPenalized?: boolean;
  expect: (score: number) => boolean;
};

function runScenario(s: Scenario): { ok: boolean; message: string } {
  const result = scoreVisionByPlaceType(s.placeType, {
    labels: s.labels,
    faceCount: s.faceCount ?? 0,
    logoCount: s.logoCount ?? 0,
    landmarkCount: s.landmarkCount ?? 0,
    hasText: s.hasText ?? false,
    safeSearchPenalized: s.safeSearchPenalized ?? false,
  });

  const ok = s.expect(result.score);
  const status = ok ? "PASS" : "FAIL";
  return {
    ok,
    message: `${status} ${s.name}: score=${result.score} reason=${result.reason}`,
  };
}

const scenarios: Scenario[] = [
  {
    name: "CAMPINGPLATZ vehicle + water + landscape => high",
    placeType: "CAMPINGPLATZ",
    labels: [
      { description: "motorhome", score: 0.94 },
      { description: "lake", score: 0.88 },
      { description: "landscape", score: 0.9 },
      { description: "outdoor", score: 0.84 },
      { description: "mountain", score: 0.72 },
    ],
    expect: (score) => score >= 55,
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
  {
    name: "SEHENSWUERDIGKEIT landmark + water => good",
    placeType: "SEHENSWUERDIGKEIT",
    labels: [
      { description: "landmark", score: 0.95 },
      { description: "river", score: 0.86 },
      { description: "outdoor", score: 0.8 },
      { description: "architecture", score: 0.76 },
    ],
    landmarkCount: 1,
    expect: (score) => score >= 20,
  },
];

let allOk = true;
for (const scenario of scenarios) {
  const outcome = runScenario(scenario);
  if (!outcome.ok) allOk = false;
  console.log(outcome.message);
}

if (!allOk) {
  process.exitCode = 1;
}
