/*
  Warnings:

  - You are about to drop the column `pBuchung` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `pHilde` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `pNachklang` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `pPlatzStruktur` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `pPreisLeistung` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `pSanitaer` on the `PlaceRating` table. All the data in the column will be lost.
  - You are about to drop the column `pUmgebung` on the `PlaceRating` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PlaceRating" (
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
    "note" TEXT,
    "cUmgebung" TEXT,
    "cPlatzStruktur" TEXT,
    "cSanitaer" TEXT,
    "cBuchung" TEXT,
    "cHilde" TEXT,
    "cPreisLeistung" TEXT,
    "cNachklang" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlaceRating_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlaceRating" ("cBuchung", "cHilde", "cNachklang", "cPlatzStruktur", "cPreisLeistung", "cSanitaer", "cUmgebung", "createdAt", "id", "note", "placeId", "totalPoints", "tsBuchung", "tsHilde", "tsNachklang", "tsPlatzStruktur", "tsPreisLeistung", "tsSanitaer", "tsUmgebung", "updatedAt") SELECT "cBuchung", "cHilde", "cNachklang", "cPlatzStruktur", "cPreisLeistung", "cSanitaer", "cUmgebung", "createdAt", "id", "note", "placeId", "totalPoints", "tsBuchung", "tsHilde", "tsNachklang", "tsPlatzStruktur", "tsPreisLeistung", "tsSanitaer", "tsUmgebung", "updatedAt" FROM "PlaceRating";
DROP TABLE "PlaceRating";
ALTER TABLE "new_PlaceRating" RENAME TO "PlaceRating";
CREATE UNIQUE INDEX "PlaceRating_placeId_key" ON "PlaceRating"("placeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
