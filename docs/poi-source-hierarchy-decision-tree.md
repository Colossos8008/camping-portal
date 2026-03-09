# POI Quellen-Hierarchie & Decision-Tree (Europa-Setup)

Diese Regeln sind in `src/lib/poi-source-decision-tree.ts` zentral implementiert und können region-unabhängig für Europa-POIs wiederverwendet werden.

## Quellen-Hierarchie

Globales Prinzip:
- **Wikidata** = primäre Identitätsquelle
- **Google Places** = bevorzugte Quelle für konkrete Besuchspunkte (finale Besucher-Koordinate)
- **OSM/Nominatim** = offene Gegenprobe, Fallback, Geometriehilfe
- **GeoNames** = Plausibilisierung und Namens-/Regionsabgleich
- **UNESCO/offizielle Register** = Referenz und Priorisierung für Top-POIs

## Typbasierte Regeln

1. **SINGLE_STRUCTURE** (Burg, Schloss, Kirche, Museum, Denkmal)
   - Identität: `wikidata > google_places > osm > nominatim > geonames > official_register`
   - Koordinate: `google_places > osm > nominatim > wikidata > geonames`
   - CoordinateMode: `ENTRANCE_POINT`

2. **SQUARE** (Platz)
   - Identität: `wikidata > osm > google_places > nominatim > geonames`
   - Koordinate: `osm > nominatim > google_places > wikidata > geonames`
   - CoordinateMode: `AREA_CENTER`

3. **OLD_TOWN_OR_ENSEMBLE** (Altstadt / historisches Viertel / Ensemble)
   - Identität: `wikidata > official_register > osm > geonames > nominatim`
   - Koordinate: `osm > nominatim > wikidata > geonames`
   - CoordinateMode: `AREA_CENTER`

4. **NATURE_DESTINATION** (Naturziel)
   - Identität: `wikidata > osm > geonames > nominatim > google_places`
   - Koordinate: `google_places > osm > nominatim > geonames > wikidata`
   - CoordinateMode: `VIEWPOINT`

5. **SITE_COMPLEX** (Schloss-/Burg-/Kloster-/Parkareal)
   - Identität: `wikidata > official_register > osm > nominatim > geonames`
   - Koordinate: `osm > nominatim > google_places > wikidata > geonames`
   - CoordinateMode: `COMPLEX_SITE`

6. **UNESCO_OR_TOP_POI** (UNESCO-/Top-POI)
   - Identität: `unesco_register > wikidata > official_register > osm > geonames`
   - Koordinate: `google_places > osm > nominatim > wikidata > geonames`
   - CoordinateMode: `AREA_CENTER`

## Review-Entscheidung (AUTO_ACCEPT / MANUAL_REVIEW / AUTO_REJECT)

- **AUTO_REJECT**, wenn:
  - Name fehlt (`missing-name`), oder
  - `coordinateConfidence < 0.45` (`low-coordinate-confidence`)
- **MANUAL_REVIEW**, wenn:
  - UNESCO-/Top-POI ohne UNESCO-Referenz (`top-poi-without-unesco-reference`), oder
  - mittelhohe/gute Signale mit Restunsicherheit (`strong-signals-but-human-check-needed`)
- **AUTO_ACCEPT**, wenn:
  - Wikidata vorhanden,
  - `coordinateConfidence >= 0.82`,
  - und kein `COMPLEX_SITE`

Nationale Denkmalregister sind als `official_register` vorbereitet, aber bewusst noch nicht voll integriert.
