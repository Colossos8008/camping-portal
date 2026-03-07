-- Additive schema extension for persisted sightseeing import metadata on Place
ALTER TABLE "Place"
  ADD COLUMN "sightSource" TEXT,
  ADD COLUMN "sightExternalId" TEXT,
  ADD COLUMN "sightCategory" TEXT,
  ADD COLUMN "sightDescription" TEXT,
  ADD COLUMN "sightTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "sightRegion" TEXT,
  ADD COLUMN "sightCountry" TEXT;
