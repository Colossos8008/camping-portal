-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Image" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "placeId" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Image_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Image" ("createdAt", "filename", "id", "placeId") SELECT "createdAt", "filename", "id", "placeId" FROM "Image";
DROP TABLE "Image";
ALTER TABLE "new_Image" RENAME TO "Image";
CREATE INDEX "Image_placeId_idx" ON "Image"("placeId");
CREATE TABLE "new_Place" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'CAMPINGPLATZ',
    "lat" REAL NOT NULL,
    "lng" REAL NOT NULL,
    "dogAllowed" BOOLEAN NOT NULL DEFAULT false,
    "sanitary" BOOLEAN NOT NULL DEFAULT false,
    "yearRound" BOOLEAN NOT NULL DEFAULT false,
    "onlineBooking" BOOLEAN NOT NULL DEFAULT false,
    "gastronomy" BOOLEAN NOT NULL DEFAULT false,
    "thumbnailImageId" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Place_thumbnailImageId_fkey" FOREIGN KEY ("thumbnailImageId") REFERENCES "Image" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Place" ("createdAt", "dogAllowed", "gastronomy", "id", "lat", "lng", "name", "onlineBooking", "sanitary", "type", "updatedAt", "yearRound") SELECT "createdAt", "dogAllowed", "gastronomy", "id", "lat", "lng", "name", "onlineBooking", "sanitary", "type", "updatedAt", "yearRound" FROM "Place";
DROP TABLE "Place";
ALTER TABLE "new_Place" RENAME TO "Place";
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
    "note" TEXT NOT NULL DEFAULT '',
    "cUmgebung" TEXT NOT NULL DEFAULT '',
    "cPlatzStruktur" TEXT NOT NULL DEFAULT '',
    "cSanitaer" TEXT NOT NULL DEFAULT '',
    "cBuchung" TEXT NOT NULL DEFAULT '',
    "cHilde" TEXT NOT NULL DEFAULT '',
    "cPreisLeistung" TEXT NOT NULL DEFAULT '',
    "cNachklang" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaceRating_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PlaceRating" ("cBuchung", "cHilde", "cNachklang", "cPlatzStruktur", "cPreisLeistung", "cSanitaer", "cUmgebung", "createdAt", "id", "note", "placeId", "totalPoints", "tsBuchung", "tsHilde", "tsNachklang", "tsPlatzStruktur", "tsPreisLeistung", "tsSanitaer", "tsUmgebung", "updatedAt") SELECT "cBuchung", "cHilde", "cNachklang", "cPlatzStruktur", "cPreisLeistung", "cSanitaer", "cUmgebung", "createdAt", "id", "note", "placeId", "totalPoints", "tsBuchung", "tsHilde", "tsNachklang", "tsPlatzStruktur", "tsPreisLeistung", "tsSanitaer", "tsUmgebung", "updatedAt" FROM "PlaceRating";
DROP TABLE "PlaceRating";
ALTER TABLE "new_PlaceRating" RENAME TO "PlaceRating";
CREATE UNIQUE INDEX "PlaceRating_placeId_key" ON "PlaceRating"("placeId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
