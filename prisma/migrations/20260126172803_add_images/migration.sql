/*
  Warnings:

  - You are about to drop the `PlaceRating` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the column `dogAllowed` on the `Place` table. All the data in the column will be lost.
  - You are about to drop the column `hasGastro` on the `Place` table. All the data in the column will be lost.
  - You are about to drop the column `onlineBooking` on the `Place` table. All the data in the column will be lost.
  - You are about to drop the column `rating` on the `Place` table. All the data in the column will be lost.
  - You are about to drop the column `type` on the `Place` table. All the data in the column will be lost.
  - You are about to drop the column `yearRound` on the `Place` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "PlaceRating_placeId_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "PlaceRating";
PRAGMA foreign_keys=on;

-- CreateTable
CREATE TABLE "Image" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "placeId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Image_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Place" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'CAMPINGPLATZ',
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "dogsAllowed" BOOLEAN NOT NULL DEFAULT false,
    "sanitary" BOOLEAN NOT NULL DEFAULT false,
    "openAllYear" BOOLEAN NOT NULL DEFAULT false,
    "online" BOOLEAN NOT NULL DEFAULT false,
    "gastronomy" BOOLEAN NOT NULL DEFAULT false,
    "tsScore" INTEGER NOT NULL DEFAULT 0,
    "tsComment" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Place" ("createdAt", "gastronomy", "id", "lat", "lng", "name", "sanitary", "updatedAt") SELECT "createdAt", "gastronomy", "id", "lat", "lng", "name", "sanitary", "updatedAt" FROM "Place";
DROP TABLE "Place";
ALTER TABLE "new_Place" RENAME TO "Place";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
