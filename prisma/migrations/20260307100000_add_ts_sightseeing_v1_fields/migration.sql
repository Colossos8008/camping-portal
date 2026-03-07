-- Additive schema extension for TS Sehenswürdigkeiten v1
CREATE TYPE "SightRelevanceType" AS ENUM ('ICON', 'STRONG_MATCH', 'GOOD_MATCH', 'OPTIONAL', 'LOW_MATCH');
CREATE TYPE "SightVisitMode" AS ENUM ('EASY_STOP', 'SMART_WINDOW', 'OUTSIDE_BEST', 'MAIN_DESTINATION', 'WEATHER_WINDOW');

ALTER TABLE "Place"
  ADD COLUMN "natureScore" DOUBLE PRECISION,
  ADD COLUMN "architectureScore" DOUBLE PRECISION,
  ADD COLUMN "historyScore" DOUBLE PRECISION,
  ADD COLUMN "uniquenessScore" DOUBLE PRECISION,
  ADD COLUMN "spontaneityScore" DOUBLE PRECISION,
  ADD COLUMN "calmScore" DOUBLE PRECISION,
  ADD COLUMN "sightseeingTotalScore" DOUBLE PRECISION,
  ADD COLUMN "sightRelevanceType" "SightRelevanceType",
  ADD COLUMN "sightVisitModePrimary" "SightVisitMode",
  ADD COLUMN "sightVisitModeSecondary" "SightVisitMode",
  ADD COLUMN "crowdRiskScore" DOUBLE PRECISION,
  ADD COLUMN "bestVisitHint" TEXT,
  ADD COLUMN "summaryWhyItMatches" TEXT;
