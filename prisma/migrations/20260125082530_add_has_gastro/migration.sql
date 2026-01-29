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
    "hasGastro" BOOLEAN NOT NULL DEFAULT false,
    "rating" REAL NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Place" ("createdAt", "dogAllowed", "id", "lat", "lng", "name", "onlineBooking", "rating", "sanitary", "type", "updatedAt", "yearRound") SELECT "createdAt", "dogAllowed", "id", "lat", "lng", "name", "onlineBooking", "rating", "sanitary", "type", "updatedAt", "yearRound" FROM "Place";
DROP TABLE "Place";
ALTER TABLE "new_Place" RENAME TO "Place";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
