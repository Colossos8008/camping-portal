import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type ReviewStatus = "REVIEWED";
type CoordinateStatus = "GOOD" | "OKAY" | "BAD";
type ImageStatus = "GOOD" | "BAD" | "UNKNOWN";
type TargetPointTypeExpected =
  | "EXACT_OBJECT"
  | "ENTRANCE_POINT"
  | "VISITOR_POINT"
  | "AREA_ANCHOR"
  | "VIEWPOINT"
  | "COMPLEX_SITE";

type GoldSetEntry = {
  placeKey: string;
  placeName: string;
  reviewStatus: ReviewStatus;
  coordinateStatus: CoordinateStatus;
  imageStatus: ImageStatus;
  reviewNote: string;
  reviewSource: string;
  reviewedBy: string;
  reviewedAt: string;
  targetPointTypeExpected: TargetPointTypeExpected;
  isGoldSet: boolean;
};

const FILE_PATH = resolve(process.cwd(), "data/review/koblenz-goldset-v1.json");
const REQUIRED_FIELDS: Array<keyof GoldSetEntry> = [
  "placeKey",
  "placeName",
  "reviewStatus",
  "coordinateStatus",
  "imageStatus",
  "reviewNote",
  "reviewSource",
  "reviewedBy",
  "reviewedAt",
  "targetPointTypeExpected",
  "isGoldSet",
];

const REVIEW_STATUS_VALUES = new Set<ReviewStatus>(["REVIEWED"]);
const COORDINATE_STATUS_VALUES = new Set<CoordinateStatus>(["GOOD", "OKAY", "BAD"]);
const IMAGE_STATUS_VALUES = new Set<ImageStatus>(["GOOD", "BAD", "UNKNOWN"]);
const TARGET_POINT_VALUES = new Set<TargetPointTypeExpected>([
  "EXACT_OBJECT",
  "ENTRANCE_POINT",
  "VISITOR_POINT",
  "AREA_ANCHOR",
  "VIEWPOINT",
  "COMPLEX_SITE",
]);

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

function assertStringField(entry: Record<string, unknown>, field: keyof GoldSetEntry, index: number): string {
  const value = entry[field];
  if (typeof value !== "string" || !value.trim()) {
    fail(`Entry #${index + 1}: field "${field}" must be a non-empty string`);
  }
  return value;
}

function main(): void {
  const raw = readFileSync(FILE_PATH, "utf-8");
  const parsed = JSON.parse(raw) as unknown;

  if (!Array.isArray(parsed)) {
    fail("Gold-set file must be a JSON array");
  }

  const seenKeys = new Set<string>();
  const goodOrOkay: string[] = [];
  const bad: string[] = [];

  const counts = {
    total: parsed.length,
    coordinateGOOD: 0,
    coordinateOKAY: 0,
    coordinateBAD: 0,
    imageGOOD: 0,
    imageBAD: 0,
    imageUNKNOWN: 0,
  };

  parsed.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      fail(`Entry #${index + 1} must be an object`);
    }

    const entry = item as Record<string, unknown>;

    for (const field of REQUIRED_FIELDS) {
      if (!(field in entry)) {
        fail(`Entry #${index + 1}: missing required field "${field}"`);
      }
    }

    const placeKey = assertStringField(entry, "placeKey", index);
    const placeName = assertStringField(entry, "placeName", index);
    const reviewStatus = assertStringField(entry, "reviewStatus", index);
    const coordinateStatus = assertStringField(entry, "coordinateStatus", index);
    const imageStatus = assertStringField(entry, "imageStatus", index);
    assertStringField(entry, "reviewNote", index);
    assertStringField(entry, "reviewSource", index);
    assertStringField(entry, "reviewedBy", index);
    assertStringField(entry, "reviewedAt", index);
    const targetPointTypeExpected = assertStringField(entry, "targetPointTypeExpected", index);

    if (typeof entry.isGoldSet !== "boolean") {
      fail(`Entry #${index + 1}: field "isGoldSet" must be boolean`);
    }

    if (!REVIEW_STATUS_VALUES.has(reviewStatus as ReviewStatus)) {
      fail(`Entry #${index + 1}: invalid reviewStatus "${reviewStatus}"`);
    }
    if (!COORDINATE_STATUS_VALUES.has(coordinateStatus as CoordinateStatus)) {
      fail(`Entry #${index + 1}: invalid coordinateStatus "${coordinateStatus}"`);
    }
    if (!IMAGE_STATUS_VALUES.has(imageStatus as ImageStatus)) {
      fail(`Entry #${index + 1}: invalid imageStatus "${imageStatus}"`);
    }
    if (!TARGET_POINT_VALUES.has(targetPointTypeExpected as TargetPointTypeExpected)) {
      fail(`Entry #${index + 1}: invalid targetPointTypeExpected "${targetPointTypeExpected}"`);
    }

    if (seenKeys.has(placeKey)) {
      fail(`Duplicate placeKey found: "${placeKey}"`);
    }
    seenKeys.add(placeKey);

    if (coordinateStatus === "GOOD") counts.coordinateGOOD += 1;
    if (coordinateStatus === "OKAY") counts.coordinateOKAY += 1;
    if (coordinateStatus === "BAD") counts.coordinateBAD += 1;

    if (imageStatus === "GOOD") counts.imageGOOD += 1;
    if (imageStatus === "BAD") counts.imageBAD += 1;
    if (imageStatus === "UNKNOWN") counts.imageUNKNOWN += 1;

    const label = `${placeKey} (${placeName})`;
    if (coordinateStatus === "BAD") {
      bad.push(label);
    } else {
      goodOrOkay.push(label);
    }
  });

  console.log("✅ Koblenz gold-set validation passed");
  console.log(`total: ${counts.total}`);
  console.log(`count GOOD: ${counts.coordinateGOOD}`);
  console.log(`count OKAY: ${counts.coordinateOKAY}`);
  console.log(`count BAD: ${counts.coordinateBAD}`);
  console.log(`count image BAD: ${counts.imageBAD}`);
  console.log(`count image GOOD: ${counts.imageGOOD}`);
  console.log(`count image UNKNOWN: ${counts.imageUNKNOWN}`);
  console.log("");
  console.log("GOOD/OKAY POIs:");
  console.log(goodOrOkay.map((item) => `- ${item}`).join("\n"));
  console.log("");
  console.log("BAD POIs:");
  console.log(bad.map((item) => `- ${item}`).join("\n"));
}

main();
