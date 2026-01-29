/*
  Warnings:

  - You are about to drop the column `category` on the `Place` table. All the data in the column will be lost.
  - You are about to drop the column `description` on the `Place` table. All the data in the column will be lost.
  - You are about to drop the column `dogsAllowed` on the `Place` table. All the data in the column will be lost.
  - You are about to drop the column `online` on the `Place` table. All the data in the column will be lost.
  - You are about to drop the column `openAllYear` on the `Place` table. All the data in the column will be lost.
  - You are about to drop the column `tsComment` on the `Place` table. All the data in the column will be lost.
  - You are about to drop the column `tsScore` on the `Place` table. All the data in the column will be lost.
  - Added the required column `type` to the `Place` table without a default value. This is not possible if the table is not empty.

*/
-- CreateTable
CREATE TABLE "PlaceRating" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "placeId" INTEGER NOT NULL,
    "tsUmgebung" TEXT NOT NULL DEFAULT 'OKAY',
    "tsPlatzStruktur" TEXT NOT NULL DEFAULT 'OKAY',
    "tsSanitaer" TEXT NOT NULL DEFAULT 'OKAY',
    "tsBuchung" TEXT NOT NULL DEFAULT 'OKAY',
    "tsHilde" TEXT NOT NULL DEFAULT 'OKAY',
    "tsPreisLeistung" TEXT NOT NULL DEFAULT 'OKAY',
    "tsNachklang" TEXT NOT NULL DEFAULT 'OKAY',
    "totalPoints" INTEGER NOT NULL DEFAULT 7,
    "note" TEXT NOT NULL DEFAULT '',
    "cUmgebung" TEXT NOT NULL DEFAULT '',
    "cPlatzStruktur" TEXT NOT NULL DEFAULT '',
    "cSanitaer" TEXT NOT NULL DEFAULT '',
    "cBuchung" TEXT NOT NULL DEFAULT '',
    "cHilde" TEXT NOT NULL DEFAULT '',
    "cPreisLeistung" TEXT NOT NULL DEFAULT '',
    "cNachklang" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaceRating_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Place" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "dogAllowed" BOOLEAN NOT NULL DEFAULT false,
    "sanitary" BOOLEAN NOT NULL DEFAULT false,
    "yearRound" BOOLEAN NOT NULL DEFAULT false,
    "onlineBooking" BOOLEAN NOT NULL DEFAULT false,
    "gastronomy" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Place" ("createdAt", "gastronomy", "id", "lat", "lng", "name", "sanitary", "updatedAt") SELECT "createdAt", "gastronomy", "id", "lat", "lng", "name", "sanitary", "updatedAt" FROM "Place";
DROP TABLE "Place";
ALTER TABLE "new_Place" RENAME TO "Place";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PlaceRating_placeId_key" ON "PlaceRating"("placeId");
