-- CreateEnum
CREATE TYPE "TripPlaceStatus" AS ENUM ('GEPLANT', 'BOOKED', 'CONFIRMED', 'VISITED');

-- CreateTable
CREATE TABLE "Trip" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripPlace" (
    "id" SERIAL NOT NULL,
    "tripId" INTEGER NOT NULL,
    "placeId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "status" "TripPlaceStatus" NOT NULL DEFAULT 'GEPLANT',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripPlace_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Trip_isActive_updatedAt_idx" ON "Trip"("isActive", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TripPlace_tripId_placeId_key" ON "TripPlace"("tripId", "placeId");

-- CreateIndex
CREATE UNIQUE INDEX "TripPlace_tripId_sortOrder_key" ON "TripPlace"("tripId", "sortOrder");

-- CreateIndex
CREATE INDEX "TripPlace_placeId_tripId_idx" ON "TripPlace"("placeId", "tripId");

-- AddForeignKey
ALTER TABLE "TripPlace" ADD CONSTRAINT "TripPlace_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripPlace" ADD CONSTRAINT "TripPlace_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;
