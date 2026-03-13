ALTER TABLE "PlaceHeroCandidate"
  ADD COLUMN IF NOT EXISTS "userFeedback" TEXT,
  ADD COLUMN IF NOT EXISTS "feedbackUpdatedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "PlaceHeroCandidate_placeId_userFeedback_idx"
  ON "PlaceHeroCandidate"("placeId", "userFeedback");
