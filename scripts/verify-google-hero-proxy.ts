import assert from "node:assert/strict";
import fs from "node:fs";

import {
  buildPlaceHeroProxyPath,
  isGooglePlacesPhotoUrl,
  normalizePlaceHeroImageUrlForPublic,
} from "../src/lib/hero-image";

function run() {
  const googleMediaUrl =
    "https://places.googleapis.com/v1/places/ChIJN1t_tDeuEmsRUsoyG83frY4/photos/AcJnMuFs/media?maxWidthPx=1600&key=AIzaSy_TEST";

  assert.equal(isGooglePlacesPhotoUrl(googleMediaUrl), true, "Google media URL must be recognized");

  assert.equal(buildPlaceHeroProxyPath(70), "/api/places/70/hero", "Proxy path should use place id");

  assert.equal(
    normalizePlaceHeroImageUrlForPublic(70, googleMediaUrl),
    "/api/places/70/hero",
    "Public hero URL should be proxied for Google URLs"
  );

  const wikimedia =
    "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a4/Test.jpg/1280px-Test.jpg";

  assert.equal(
    normalizePlaceHeroImageUrlForPublic(70, wikimedia),
    wikimedia,
    "Wikimedia URL should pass through"
  );

  const imageUrlHelperSource = fs.readFileSync("src/app/map/_lib/image-url", "utf8");

  assert.equal(
    imageUrlHelperSource.includes(
      "isGooglePhotoReference(cleanPath) || isGooglePlacesPhotoUrl(cleanPath)"
    ),
    true,
    "Map image URL helper must detect Google photo URLs"
  );

  assert.equal(
    imageUrlHelperSource.includes("buildPlaceHeroProxyPath(placeId)"),
    true,
    "Map image URL helper must route Google photo URLs through proxy"
  );

  console.log("PASS verify:google-hero-proxy");
}

run();