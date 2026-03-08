-- Scalable POI governance foundation: identity, coordinate provenance and review state
CREATE TYPE "CoordinateMode" AS ENUM ('POINT', 'AREA_CENTER', 'ENTRANCE_POINT', 'VIEWPOINT', 'COMPLEX_SITE');

CREATE TYPE "PoiReviewState" AS ENUM ('PENDING', 'AUTO_ACCEPT', 'AUTO_REJECT', 'MANUAL_REVIEW');

ALTER TABLE "Place"
  ADD COLUMN "canonicalSource" TEXT,
  ADD COLUMN "canonicalSourceId" TEXT,
  ADD COLUMN "wikidataId" TEXT,
  ADD COLUMN "osmType" TEXT,
  ADD COLUMN "osmId" BIGINT,
  ADD COLUMN "wikipediaTitle" TEXT,
  ADD COLUMN "wikipediaUrl" TEXT,
  ADD COLUMN "coordinateSource" TEXT,
  ADD COLUMN "coordinateConfidence" DOUBLE PRECISION,
  ADD COLUMN "coordinateMode" "CoordinateMode",
  ADD COLUMN "geometryType" TEXT,
  ADD COLUMN "geometryJson" JSONB,
  ADD COLUMN "poiReviewState" "PoiReviewState" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "poiReviewReason" TEXT;

CREATE INDEX "Place_canonicalSource_canonicalSourceId_idx" ON "Place"("canonicalSource", "canonicalSourceId");
CREATE INDEX "Place_wikidataId_idx" ON "Place"("wikidataId");
CREATE INDEX "Place_osmType_osmId_idx" ON "Place"("osmType", "osmId");
CREATE INDEX "Place_coordinateMode_coordinateConfidence_idx" ON "Place"("coordinateMode", "coordinateConfidence");
CREATE INDEX "Place_poiReviewState_idx" ON "Place"("poiReviewState");
