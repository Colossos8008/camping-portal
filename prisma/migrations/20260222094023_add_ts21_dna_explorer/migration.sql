/*
  Warnings:

  - You are about to drop the column `aiAnkommen` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `aiBuchung` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `aiGassiUmfeld` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `aiHaltung` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `aiHundAmPlatz` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `aiNachklang` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `aiNote` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `aiRuhe` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `aiSanitaerPrivat` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `aiStellplatz` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `aiTotalPoints` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `aiUmgebung` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `aiWiederkommen` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `haltungVerified` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userAnkommen` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userBuchung` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userGassiUmfeld` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userHaltung` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userHundAmPlatz` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userNachklang` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userNote` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userRuhe` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userSanitaerPrivat` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userStellplatz` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userTotalPoints` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userUmgebung` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `userWiederkommen` on the `PlaceRating` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "TS21Source" AS ENUM ('AI', 'USER');

-- AlterTable
ALTER TABLE "PlaceRating" DROP COLUMN "aiAnkommen",
DROP COLUMN "aiBuchung",
DROP COLUMN "aiGassiUmfeld",
DROP COLUMN "aiHaltung",
DROP COLUMN "aiHundAmPlatz",
DROP COLUMN "aiNachklang",
DROP COLUMN "aiNote",
DROP COLUMN "aiRuhe",
DROP COLUMN "aiSanitaerPrivat",
DROP COLUMN "aiStellplatz",
DROP COLUMN "aiTotalPoints",
DROP COLUMN "aiUmgebung",
DROP COLUMN "aiWiederkommen",
DROP COLUMN "haltungVerified",
DROP COLUMN "userAnkommen",
DROP COLUMN "userBuchung",
DROP COLUMN "userGassiUmfeld",
DROP COLUMN "userHaltung",
DROP COLUMN "userHundAmPlatz",
DROP COLUMN "userNachklang",
DROP COLUMN "userNote",
DROP COLUMN "userRuhe",
DROP COLUMN "userSanitaerPrivat",
DROP COLUMN "userStellplatz",
DROP COLUMN "userTotalPoints",
DROP COLUMN "userUmgebung",
DROP COLUMN "userWiederkommen";

-- CreateTable
CREATE TABLE "PlaceTS21" (
    "id" SERIAL NOT NULL,
    "placeId" INTEGER NOT NULL,
    "activeSource" "TS21Source" NOT NULL DEFAULT 'AI',
    "ai" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "user" JSONB NOT NULL DEFAULT '{}'::jsonb,
    "dna" BOOLEAN NOT NULL DEFAULT false,
    "explorer" BOOLEAN NOT NULL DEFAULT false,
    "dnaExplorerNote" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlaceTS21_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaceTS21_placeId_key" ON "PlaceTS21"("placeId");

-- AddForeignKey
ALTER TABLE "PlaceTS21" ADD CONSTRAINT "PlaceTS21_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;
