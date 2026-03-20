ALTER TABLE "TripPlace" DROP CONSTRAINT IF EXISTS "TripPlace_tripId_placeId_key";

CREATE INDEX IF NOT EXISTS "TripPlace_tripId_placeId_idx" ON "TripPlace"("tripId", "placeId");
