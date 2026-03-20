CREATE TABLE IF NOT EXISTS "PlaceHeroCandidate" (
  "id" SERIAL NOT NULL,
  "placeId" INTEGER NOT NULL,
  "source" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "thumbUrl" TEXT,
  "width" INTEGER,
  "height" INTEGER,
  "score" INTEGER,
  "reason" TEXT,
  "rank" INTEGER,
  "isRejected" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PlaceHeroCandidate_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PlaceHeroCandidate"
  ADD COLUMN IF NOT EXISTS "userFeedback" TEXT,
  ADD COLUMN IF NOT EXISTS "feedbackUpdatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "PlaceHeroCandidate_placeId_rank_idx"
  ON "PlaceHeroCandidate"("placeId", "rank");

CREATE INDEX IF NOT EXISTS "PlaceHeroCandidate_placeId_isRejected_idx"
  ON "PlaceHeroCandidate"("placeId", "isRejected");

CREATE INDEX IF NOT EXISTS "PlaceHeroCandidate_placeId_userFeedback_idx"
  ON "PlaceHeroCandidate"("placeId", "userFeedback");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'PlaceHeroCandidate_placeId_fkey'
  ) THEN
    ALTER TABLE "PlaceHeroCandidate"
      ADD CONSTRAINT "PlaceHeroCandidate_placeId_fkey"
      FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
