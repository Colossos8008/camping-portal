-- AlterEnum
ALTER TYPE "CoordinateMode" ADD VALUE IF NOT EXISTS 'ENTRANCE_POINT';
ALTER TYPE "CoordinateMode" ADD VALUE IF NOT EXISTS 'VIEWPOINT';
ALTER TYPE "CoordinateMode" ADD VALUE IF NOT EXISTS 'COMPLEX_SITE';

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'PoiReviewState') THEN
    CREATE TYPE "PoiReviewState" AS ENUM ('PENDING', 'AUTO_ACCEPT', 'AUTO_REJECT', 'MANUAL_REVIEW');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "Place"
  ADD COLUMN IF NOT EXISTS "canonicalSource" TEXT,
  ADD COLUMN IF NOT EXISTS "canonicalSourceId" TEXT,
  ADD COLUMN IF NOT EXISTS "wikidataId" TEXT,
  ADD COLUMN IF NOT EXISTS "osmType" TEXT,
  ADD COLUMN IF NOT EXISTS "osmId" BIGINT,
  ADD COLUMN IF NOT EXISTS "wikipediaTitle" TEXT,
  ADD COLUMN IF NOT EXISTS "wikipediaUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "coordinateSource" TEXT,
  ADD COLUMN IF NOT EXISTS "coordinateConfidence" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "coordinateMode" "CoordinateMode",
  ADD COLUMN IF NOT EXISTS "geometryType" TEXT,
  ADD COLUMN IF NOT EXISTS "geometryJson" JSONB,
  ADD COLUMN IF NOT EXISTS "poiReviewState" "PoiReviewState" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS "poiReviewReason" TEXT;

-- Indexes
CREATE INDEX IF NOT EXISTS "Place_canonicalSource_canonicalSourceId_idx" ON "Place"("canonicalSource", "canonicalSourceId");
CREATE INDEX IF NOT EXISTS "Place_wikidataId_idx" ON "Place"("wikidataId");
CREATE INDEX IF NOT EXISTS "Place_osmType_osmId_idx" ON "Place"("osmType", "osmId");
CREATE INDEX IF NOT EXISTS "Place_coordinateMode_coordinateConfidence_idx" ON "Place"("coordinateMode", "coordinateConfidence");
CREATE INDEX IF NOT EXISTS "Place_poiReviewState_idx" ON "Place"("poiReviewState");
