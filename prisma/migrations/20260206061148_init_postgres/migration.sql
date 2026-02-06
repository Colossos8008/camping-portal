-- CreateEnum
CREATE TYPE "PlaceType" AS ENUM ('STELLPLATZ', 'CAMPINGPLATZ', 'SEHENSWUERDIGKEIT', 'HVO_TANKSTELLE');

-- CreateEnum
CREATE TYPE "TSValue" AS ENUM ('STIMMIG', 'OKAY', 'PASST_NICHT');

-- CreateEnum
CREATE TYPE "TSHaltung" AS ENUM ('DNA', 'EXPLORER');

-- CreateTable
CREATE TABLE "Place" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PlaceType" NOT NULL DEFAULT 'CAMPINGPLATZ',
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "dogAllowed" BOOLEAN NOT NULL DEFAULT false,
    "sanitary" BOOLEAN NOT NULL DEFAULT false,
    "yearRound" BOOLEAN NOT NULL DEFAULT false,
    "onlineBooking" BOOLEAN NOT NULL DEFAULT false,
    "gastronomy" BOOLEAN NOT NULL DEFAULT false,
    "thumbnailImageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaceRating" (
    "id" SERIAL NOT NULL,
    "placeId" INTEGER NOT NULL,
    "tsUmgebung" "TSValue" NOT NULL DEFAULT 'OKAY',
    "tsPlatzStruktur" "TSValue" NOT NULL DEFAULT 'OKAY',
    "tsSanitaer" "TSValue" NOT NULL DEFAULT 'OKAY',
    "tsBuchung" "TSValue" NOT NULL DEFAULT 'OKAY',
    "tsHilde" "TSValue" NOT NULL DEFAULT 'OKAY',
    "tsPreisLeistung" "TSValue" NOT NULL DEFAULT 'OKAY',
    "tsNachklang" "TSValue" NOT NULL DEFAULT 'OKAY',
    "totalPoints" INTEGER NOT NULL DEFAULT 7,
    "note" TEXT NOT NULL DEFAULT '',
    "cUmgebung" TEXT NOT NULL DEFAULT '',
    "cPlatzStruktur" TEXT NOT NULL DEFAULT '',
    "cSanitaer" TEXT NOT NULL DEFAULT '',
    "cBuchung" TEXT NOT NULL DEFAULT '',
    "cHilde" TEXT NOT NULL DEFAULT '',
    "cPreisLeistung" TEXT NOT NULL DEFAULT '',
    "cNachklang" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceRating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaceTS2" (
    "id" SERIAL NOT NULL,
    "placeId" INTEGER NOT NULL,
    "haltung" "TSHaltung" NOT NULL DEFAULT 'DNA',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceTS2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Image" (
    "id" SERIAL NOT NULL,
    "placeId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Image_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaceRating_placeId_key" ON "PlaceRating"("placeId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaceTS2_placeId_key" ON "PlaceTS2"("placeId");

-- CreateIndex
CREATE INDEX "Image_placeId_idx" ON "Image"("placeId");

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_thumbnailImageId_fkey" FOREIGN KEY ("thumbnailImageId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceRating" ADD CONSTRAINT "PlaceRating_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaceTS2" ADD CONSTRAINT "PlaceTS2_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Image" ADD CONSTRAINT "Image_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;
