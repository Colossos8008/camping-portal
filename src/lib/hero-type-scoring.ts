export type PlaceType = "STELLPLATZ" | "CAMPINGPLATZ" | "SEHENSWUERDIGKEIT" | "HVO_TANKSTELLE";

export type VisionLabel = {
  description: string;
  score: number;
};

export type VisionSignalsInput = {
  labels: VisionLabel[];
  faceCount: number;
  logoCount: number;
  landmarkCount: number;
  hasText: boolean;
  safeSearchPenalized: boolean;
};

const LABEL_SETS = {
  vehicle: ["vehicle", "motor vehicle", "car", "van", "rv", "motorhome", "camper", "caravan", "truck", "transport"],
  nature: ["nature", "landscape", "forest", "tree", "meadow", "field", "grass", "valley", "wilderness"],
  water: ["water", "lake", "river", "sea", "ocean", "coast", "beach", "shore", "bay"],
  genericWater: ["water", "waterfront"],
  seaWater: ["sea", "ocean", "coast", "beach", "shore", "shoreline", "bay"],
  inlandWater: ["lake", "river", "stream", "creek"],
  naturalWater: [
    "sea",
    "ocean",
    "coast",
    "beach",
    "lake",
    "river",
    "shore",
    "shoreline",
    "bay",
    "waterfront",
    "natural",
  ],
  pool: [
    "pool",
    "swimming pool",
    "resort pool",
    "water park",
    "indoor pool",
    "hotel pool",
    "water slide",
    "aquatic centre",
  ],
  mountain: ["mountain", "hill", "alps", "peak", "cliff"],
  outdoor: ["outdoor", "sky", "cloud", "horizon", "sunset", "sunrise"],
  camping: ["camping", "campground", "campsite", "tent", "caravan site", "holiday park"],
  indoor: ["indoor", "room", "interior", "living room", "bedroom", "kitchen", "bathroom"],
  person: ["person", "people", "selfie", "portrait", "face"],
  logoText: ["logo", "brand", "advertising", "advertisement", "sign", "text", "label"],
  product: ["product", "showroom", "dealership", "shop", "store", "exhibition"],
  station: ["fuel dispenser", "gas station", "petrol station", "service station", "pump"],
  parking: ["parking", "parking lot", "car park", "asphalt"],
  screenshot: ["screenshot", "map", "diagram", "graphic"],
  landmark: ["landmark", "monument", "historic site", "tourist attraction", "cathedral", "castle", "bridge"],
  building: ["building", "architecture", "facade", "exterior"],
} as const;

function normalizeScore(score: number): number {
  return Number.isFinite(score) ? Math.max(0.2, Math.min(1, score)) : 0.2;
}

function hasAnyLabel(labels: VisionLabel[], keywords: readonly string[]): boolean {
  return labels.some((label) => keywords.some((keyword) => label.description.includes(keyword)));
}

function labelStrength(labels: VisionLabel[], keywords: readonly string[]): number {
  let sum = 0;
  for (const label of labels) {
    if (keywords.some((keyword) => label.description.includes(keyword))) {
      sum += normalizeScore(label.score);
    }
  }
  return sum;
}

export function scoreVisionByPlaceType(placeType: PlaceType, input: VisionSignalsInput): { score: number; reason: string } {
  const labels = input.labels;

  const signal = {
    vehicle: hasAnyLabel(labels, LABEL_SETS.vehicle),
    nature: hasAnyLabel(labels, LABEL_SETS.nature),
    water: hasAnyLabel(labels, LABEL_SETS.water),
    naturalWater: hasAnyLabel(labels, LABEL_SETS.naturalWater),
    pool: hasAnyLabel(labels, LABEL_SETS.pool),
    mountain: hasAnyLabel(labels, LABEL_SETS.mountain),
    outdoor: hasAnyLabel(labels, LABEL_SETS.outdoor),
    camping: hasAnyLabel(labels, LABEL_SETS.camping),
    indoor: hasAnyLabel(labels, LABEL_SETS.indoor),
    person: hasAnyLabel(labels, LABEL_SETS.person) || input.faceCount > 0,
    logoText: hasAnyLabel(labels, LABEL_SETS.logoText) || input.logoCount > 0 || input.hasText,
    product: hasAnyLabel(labels, LABEL_SETS.product),
    station: hasAnyLabel(labels, LABEL_SETS.station),
    parking: hasAnyLabel(labels, LABEL_SETS.parking),
    screenshot: hasAnyLabel(labels, LABEL_SETS.screenshot),
    landmark: hasAnyLabel(labels, LABEL_SETS.landmark) || input.landmarkCount > 0,
    building: hasAnyLabel(labels, LABEL_SETS.building),
  };

  let score = 0;
  const positives: string[] = [];
  const negatives: string[] = [];

  const vehicleStrength = labelStrength(labels, LABEL_SETS.vehicle);
  const natureStrength = labelStrength(labels, [...LABEL_SETS.nature, ...LABEL_SETS.outdoor]);
  const waterStrength = labelStrength(labels, LABEL_SETS.water);
  const genericWaterStrength = labelStrength(labels, LABEL_SETS.genericWater);
  const seaWaterStrength = labelStrength(labels, LABEL_SETS.seaWater);
  const inlandWaterStrength = labelStrength(labels, LABEL_SETS.inlandWater);
  const naturalWaterStrength = labelStrength(labels, LABEL_SETS.naturalWater);
  const poolStrength = labelStrength(labels, LABEL_SETS.pool);
  const scenicStrength = labelStrength(labels, [...LABEL_SETS.mountain, ...LABEL_SETS.water, ...LABEL_SETS.nature, ...LABEL_SETS.outdoor]);

  if (placeType === "CAMPINGPLATZ" || placeType === "STELLPLATZ") {
    if (signal.vehicle) {
      const base = Math.round(12 + 10 * Math.min(1.4, vehicleStrength / 1.4));
      score += base;
      positives.push(`vehicle +${base}`);
    }
    if (signal.camping) {
      score += 8;
      positives.push("camping-scene +8");
    }
    if (signal.nature || signal.outdoor) {
      score += 10;
      positives.push("nature/outdoor +10");
    }
    if (signal.naturalWater) {
      const waterBonus = Math.round(16 + 10 * Math.min(1.2, naturalWaterStrength / 1.2));
      score += waterBonus;
      positives.push(`natural-water +${waterBonus}`);
    } else if (signal.water) {
      const genericBonus = Math.round(4 + 5 * Math.min(1, Math.max(0.3, genericWaterStrength)));
      score += genericBonus;
      positives.push(`generic-water +${genericBonus}`);
    }
    if (seaWaterStrength > 0) {
      const seaBonus = Math.round(10 + 8 * Math.min(1.2, seaWaterStrength / 1.1));
      score += seaBonus;
      positives.push(`sea/coast-water +${seaBonus}`);
    }
    if (inlandWaterStrength > 0) {
      const inlandBonus = Math.round(8 + 7 * Math.min(1.2, inlandWaterStrength / 1.1));
      score += inlandBonus;
      positives.push(`lake/river-water +${inlandBonus}`);
    }
    if (signal.mountain) {
      score += 8;
      positives.push("mountain +8");
    }

    if (signal.vehicle && (signal.nature || signal.outdoor)) {
      const combo = Math.round(24 + 10 * Math.min(1.2, (vehicleStrength + natureStrength) / 2));
      score += combo;
      positives.push(`vehicle+landscape +${combo}`);
    }
    if (signal.vehicle && (signal.naturalWater || signal.water)) {
      const naturalWaterBoost = signal.naturalWater ? naturalWaterStrength : waterStrength;
      const combo = Math.round(18 + 12 * Math.min(1.2, (vehicleStrength + naturalWaterBoost) / 2));
      score += combo;
      positives.push(`vehicle+water +${combo}`);
    }
    if (signal.vehicle && signal.naturalWater && (signal.nature || signal.outdoor)) {
      const combo = Math.round(16 + 10 * Math.min(1.2, (vehicleStrength + naturalWaterStrength + natureStrength) / 3));
      score += combo;
      positives.push(`vehicle+landscape+natural-water +${combo}`);
    }
    if (signal.vehicle && signal.mountain) {
      score += 12;
      positives.push("vehicle+mountain +12");
    }
    if (signal.vehicle && signal.parking && !signal.nature && !signal.water && !signal.mountain) {
      score -= 24;
      negatives.push("parking-lot-only -24");
    }
    if (signal.vehicle && scenicStrength < 0.6 && !signal.camping) {
      score -= 16;
      negatives.push("vehicle-closeup-no-scenic -16");
    }
    if (signal.pool) {
      const points = Math.round(46 + 18 * Math.min(1.5, poolStrength / 1.1));
      score -= points;
      negatives.push(`pool/swimming -${points}`);
    }

    if (signal.indoor) {
      score -= 26;
      negatives.push("indoor -26");
    }
    if (signal.person) {
      const points = Math.min(34, 14 + input.faceCount * 8);
      score -= points;
      negatives.push(`face/person -${points}`);
    }
    if (signal.logoText) {
      const points = Math.min(36, 14 + input.logoCount * 10 + (input.hasText ? 6 : 0));
      score -= points;
      negatives.push(`logo/text -${points}`);
    }
    if (signal.station) {
      score -= 28;
      negatives.push("fuel-station-like -28");
    }
    if (signal.product) {
      score -= 20;
      negatives.push("product/showroom -20");
    }
    if (signal.screenshot) {
      score -= 24;
      negatives.push("screenshot/map -24");
    }
  } else if (placeType === "HVO_TANKSTELLE") {
    if (signal.station || signal.outdoor || signal.building) {
      score += 8;
      positives.push("station/exterior +8");
    }
    if (signal.nature || signal.water) {
      score += 3;
      positives.push("minor-nature +3");
    }
    if (signal.vehicle) {
      score += 2;
      positives.push("vehicle-neutral +2");
    }

    if (signal.logoText) {
      score -= 16;
      negatives.push("logo/text -16");
    }
    if (signal.station) {
      score -= 12;
      negatives.push("fuel-dispenser penalty -12");
    }
    if (signal.indoor) {
      score -= 20;
      negatives.push("indoor -20");
    }
    if (signal.person) {
      const points = Math.min(28, 10 + input.faceCount * 8);
      score -= points;
      negatives.push(`face/person -${points}`);
    }
    if (signal.screenshot) {
      score -= 16;
      negatives.push("screenshot/map -16");
    }
  } else {
    if (signal.landmark) {
      score += 16;
      positives.push("landmark +16");
    }
    if (signal.outdoor || signal.nature) {
      score += 8;
      positives.push("outdoor/scenic +8");
    }
    if (signal.water || signal.mountain) {
      score += 8;
      positives.push("water/landscape +8");
    }
    if (signal.building) {
      score += 4;
      positives.push("exterior +4");
    }

    if (signal.person) {
      const points = Math.min(30, 12 + input.faceCount * 8);
      score -= points;
      negatives.push(`selfie/person -${points}`);
    }
    if (signal.logoText) {
      score -= 16;
      negatives.push("logo/text -16");
    }
    if (signal.indoor) {
      score -= 10;
      negatives.push("indoor mismatch -10");
    }
    if (signal.screenshot) {
      score -= 16;
      negatives.push("screenshot/map -16");
    }
  }

  if (input.safeSearchPenalized) {
    score -= 10;
    negatives.push("safe-search -10");
  }

  const scope = placeType === "SEHENSWUERDIGKEIT" ? "Sight" : placeType === "HVO_TANKSTELLE" ? "Station" : "Camping";
  const positiveText = positives.length > 0 ? positives.join(" + ") : "neutral";
  const negativeText = negatives.length > 0 ? negatives.join(" + ") : "none";
  return {
    score,
    reason: `${scope} score: ${positiveText}; Rejected-ish signals: ${negativeText}`,
  };
}
