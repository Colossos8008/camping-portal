# Sightseeing Seed Import (Region + Nearby Radius + Highlight-Modus)

Dieses Seed-Script importiert echte Sehenswürdigkeiten (OSM/Overpass) in `Place` mit `type=SEHENSWUERDIGKEIT`.

Unterstützte Modi:

- **Region-Modus** (bestehend): Normandie / Bretagne über Overpass Area Query
- **Nearby-Modus** (bestehend): Radius um expliziten Mittelpunkt (`--center` + `--radius-km`) oder Preset (`--near=nievern`)
- **Highlight-Modus** (neu): fokussiert auf wenige Haupt-Sehenswürdigkeiten (`--highlight-mode` oder `--top-sights`)

## Unterschied Nearby vs Highlight

### Normaler Nearby-Modus

- Breiteres Kandidatenfeld (`historic`, `natural`, `viewpoint`, `heritage` etc.)
- Gut für explorative, eher vollständige Suche
- Mehr Rauschen in dichten Regionen möglich

### Highlight-Modus

- Früh harte Reduktion auf starke Landmark-Klassen
- Nearby-Subqueries sind enger und touristisch fokussiert
- Regelbasiertes Ranking **vor** DB-Import
- `--limit=10` liefert Top-Rangliste (nicht bloß „erste 10 Rohdaten“)

Im Highlight-Modus werden bevorzugt:

- Burg/Festung/Zitadelle/Schloss (`castle`, `fortress`, `citadel`, `palace`, `schloss`, `burg`)
- Abtei/Kloster/Kathedrale/Dom (`abbey`, `monastery`, `cathedral`)
- Altstadt / Historic Centre
- Bedeutende Ruinen und große Memorials/Landmarks
- Tourist. Seilbahn/Funicular nur mit klaren Relevanzsignalen

Deutlich abgewertet/ausgeschlossen werden u. a.:

- generische Viewpoints ohne Landmark-Signal
- kleine Kreuze/Calvaires/Bench-POIs
- technische/utility-nahe Objekte

## Regionen (bestehend)

- `normandie` (`FR-NOR`)
- `bretagne` (`FR-BRE`)
- `all` (beide Regionen)

Der Import ist bewusst lokal begrenzt (Area Query oder Nearby Radius), es wird **nicht** ein ganzes Land blind importiert.

## CLI Optionen

Allgemein:

- `--limit=<n>` (begrenzt Verarbeitung; im Highlight-Modus nach Ranking als harte Top-Grenze)
- `--max-elements=<n>` (begrenzt Fetch-Menge)
- `--dry-run` (keine DB Writes)
- `--force` (ignoriert DB-Dublettenprüfung)
- `--verbose`
- `--overpass-url=<url>` (überschreibt `OVERPASS_URL`)

Highlight:

- `--highlight-mode` (Alias: `--top-sights`)

Region-Modus:

- `--region=normandie|bretagne|all`
- `--bbox=minLon,minLat,maxLon,maxLat` (verkleinert die Overpass-Abfrage auf eine kleine Box)
- `--test-mode` (nutzt pro Region eine kleine feste BBox)

Nearby-Modus:

- `--center=<lat,lng>`
- `--radius-km=<number>`
- optional: `--near=nievern` (Preset für lokalen Testfall)
- optional: `--subqueries=<key1,key2,...>` (Alias: `--include-subqueries=...`, nur diese Nearby-Teilabfragen)

Hinweise zu Kombinationen:

- Nearby kann **nicht** mit `--bbox` oder `--test-mode` kombiniert werden.
- Bei `--near=nievern` werden Center und Standardradius vorbelegt (können über `--center/--radius-km` überschrieben werden).
- Nearby nutzt mehrere kleinere thematische Overpass-Teilabfragen, merged lokal und dedupliziert nach OSM-ID.
- Nearby-Teilabfragen dürfen teilweise fehlschlagen (z. B. 429/504/Timeout): erfolgreiche Teilabfragen werden trotzdem weiterverarbeitet.
- Nur wenn **alle** ausgewählten Nearby-Teilabfragen fehlschlagen, gilt der Scope als fehlgeschlagen.

## Beispiel Koblenz/Nievern

Mit Highlight-Modus + `--limit=10` werden wenige Hauptziele priorisiert (z. B. Deutsches Eck, Festungen/Burgen/Schlösser, Altstadt-Signale, touristisch starke Landmarken) statt vieler kleinteiliger OSM-Treffer.

## Lokale Befehle

Koblenz Highlight Dry-Run:

- `npm run import:sightseeing:seed -- --center=50.3569,7.5889 --radius-km=35 --highlight-mode --limit=10 --dry-run --verbose`

Nievern Highlight Dry-Run:

- `npm run import:sightseeing:seed -- --near=nievern --highlight-mode --limit=10 --dry-run --verbose`
- Shortcut: `npm run import:sightseeing:seed:nievern:highlights -- --dry-run --verbose`

Echter Highlight-Import:

- `npm run import:sightseeing:seed -- --near=nievern --highlight-mode --limit=10 --verbose`

## Overpass Endpoint (Standard + Fallback)

- Standard-Endpoint: `https://overpass-api.de/api/interpreter`
- Primärer Endpoint via Env `OVERPASS_URL`
- Alternativ per CLI `--overpass-url=...` (hat Vorrang gegenüber Env)
- Bei temporären Fehlern (u. a. `429`) versucht der Importer Retries und fällt auf `https://lz4.overpass-api.de/api/interpreter` zurück.

## Dublettenlogik (unverändert)

- Batch-intern: nahe Koordinaten + ähnliche Namen werden zusammengeführt.
- Gegen DB: bestehende `SEHENSWUERDIGKEIT`-Datensätze werden via Name+Distanz-Heuristik geprüft.
- Standard: Dubletten werden übersprungen; mit `--force` werden vorhandene Datensätze aktualisiert.

## Persistierte Sightseeing-Metadaten

Der Import persistiert additiv neben Kernfeldern:

- `sightSource`
- `sightExternalId`
- `sightCategory`
- `sightDescription`
- `sightTags`
- `sightRegion`
- `sightCountry`

Diese Felder bleiben optional/nullable und sind für `SEHENSWUERDIGKEIT` optimiert.

## Anschluss: TS-Sehenswürdigkeiten-Autofill

Nach echtem Seed-Import:

- `POST /api/admin/sightseeing-autofill`
