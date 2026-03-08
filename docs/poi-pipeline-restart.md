# POI-Pipeline Neustart (Sehenswürdigkeiten, skalierbar für Europa)

## 1) Kurz-Architekturvorschlag

### Problem im Altzustand
- Einfache `lat/lng`-Pflege ohne belastbare Identität führt bei tausenden POIs zu Drift, Dubletten und uneinheitlicher Qualität.
- Bei Flächenobjekten (Altstadt, Parkareal, Schlossgelände) ist ein einzelner Punkt oft nur ein Näherungsanker.

### Zielmodell (additiv auf `Place`)
- **Identität**: `canonicalSource`, `canonicalSourceId`, `wikidataId`, `osmType`, `osmId`, `wikipediaTitle`, `wikipediaUrl`
- **Koordinatenherkunft und Qualität**: `coordinateSource`, `coordinateConfidence`, `coordinateMode`
- **Geometrievorbereitung**: `geometryType`, `geometryJson`
- **Review-Governance**: `poiReviewState`, `poiReviewReason`

### Warum tragfähiger als reine lat/lng-Handpflege?
- **Stabile Identität pro POI**: Änderungen am Namen oder an Kategorien verlieren die Objekt-Referenz nicht.
- **Nachvollziehbare Herkunft**: Quelle und Confidence sind persistiert, nicht implizit.
- **Fachlich richtige Ankerlogik** über `coordinateMode` statt „ein Punkt passt immer“.
- **Skalierbarer Review-Fokus**: manuelle Arbeit nur für Grenzfälle statt für jeden POI.

## 2) Quellenstrategie (Priorisierung)

### Führende Identität
1. **Wikidata (`wikidataId`)** – höchste Stabilität für europaweite Referenzierung.
2. **Wikipedia (`wikipediaTitle`)** – guter Fallback bei klarer Entität.
3. **OSM-Objekt (`osmType` + `osmId`)** – immer verfügbar, aber objektmodellabhängig.

### Führende Koordinate (nach Zieltyp)
1. **Ikonisches Einzelbauwerk**: OSM Node/Entrance bevorzugt, `POINT` oder `ENTRANCE_POINT`.
2. **Platz**: OSM Fläche mit `AREA_CENTER`.
3. **Altstadt/Historisches Viertel**: Relation/Fläche als `COMPLEX_SITE` oder `AREA_CENTER`.
4. **Naturziel**: je nach Objekt `VIEWPOINT` (Aussicht) oder `AREA_CENTER` (Areal).
5. **Schloss-/Kloster-/Parkareal**: bei großem Areal `COMPLEX_SITE`/`AREA_CENTER`, optional später zusätzlicher Eingangspunkt.
6. **Aussichtspunkt**: `VIEWPOINT` ist fachlich führend.

### Fallbacks
- Wenn Wikidata/Wikipedia fehlen, OSM-Identität bleibt canonical.
- Wenn Fläche/Relation ohne stabile Mitte unklar ist: vorerst `COMPLEX_SITE` + manuelle Review.

### Wann manuelle Review zwingend?
- `coordinateMode = COMPLEX_SITE`
- niedrige `coordinateConfidence`
- widersprüchliche Quellen (z. B. Wikipedia vorhanden, aber OSM-Mapping wirkt generisch/unklar)

## 3) Minimaler technischer Start (dieser PR)

1. **Prisma-Modell erweitert** um POI-Identity/Coordinate/Review-Felder inklusive Enums und Indizes.
2. **Governance-Helper** (`src/lib/poi-governance.ts`) eingeführt:
   - leitet Canonical-Identität aus OSM/Wikidata/Wikipedia ab
   - bestimmt `coordinateMode`
   - schätzt `coordinateConfidence`
   - erzeugt erste `suggestedReviewState`-Entscheidung
3. **Seed-Import normalisiert** jetzt Governance-Metadaten pro Kandidat statt nur lat/lng.
4. **Assist-Script** (`assist:poi-governance-preview`) ergänzt, um die neue Entscheidungslogik auf realen Overpass-Daten zu prüfen.

## 4) Review-Workflow (einfach, umsetzbar)

### AUTO_ACCEPT
- `coordinateConfidence >= 0.80`
- und `coordinateMode != COMPLEX_SITE`
- und konsistente Identity-Signale (Wikidata/Wikipedia/OSM nicht widersprüchlich)

### AUTO_REJECT
- `coordinateConfidence < 0.45`
- oder harte Qualitätsflags (fehlende Entität/zu generisches Objekt)

### MANUAL_REVIEW
- alles dazwischen
- insbesondere `COMPLEX_SITE`, `AREA_CENTER` mit schwachen Quellen, oder touristisch relevante Grenzfälle

### PENDING
- Default-Status nach Import, bis Entscheidung geschrieben wird.

Damit entsteht eine belastbare Pipeline-Basis, ohne eine riskante Komplettmigration aller bestehenden POIs in einem Schritt.
