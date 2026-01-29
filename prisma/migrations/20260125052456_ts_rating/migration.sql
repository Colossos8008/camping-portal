/*
  Warnings:

  - Added the required column `updatedAt` to the `Place` table without a default value. This is not possible if the table is not empty.

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
    "pUmgebung" INTEGER NOT NULL DEFAULT 1,
    "pPlatzStruktur" INTEGER NOT NULL DEFAULT 1,
    "pSanitaer" INTEGER NOT NULL DEFAULT 1,
    "pBuchung" INTEGER NOT NULL DEFAULT 1,
    "pHilde" INTEGER NOT NULL DEFAULT 1,
    "pPreisLeistung" INTEGER NOT NULL DEFAULT 1,
    "pNachklang" INTEGER NOT NULL DEFAULT 1,
    "totalPoints" INTEGER NOT NULL DEFAULT 7,
    "note" TEXT,
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
    "rating" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Place" ("createdAt", "dogAllowed", "id", "lat", "lng", "name", "onlineBooking", "rating", "sanitary", "type", "yearRound") SELECT "createdAt", "dogAllowed", "id", "lat", "lng", "name", "onlineBooking", "rating", "sanitary", "type", "yearRound" FROM "Place";
DROP TABLE "Place";
ALTER TABLE "new_Place" RENAME TO "Place";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PlaceRating_placeId_key" ON "PlaceRating"("placeId");
