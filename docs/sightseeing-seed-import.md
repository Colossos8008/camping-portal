# Sightseeing Seed Import (Region + Nearby Radius)

Dieses Seed-Script importiert echte Sehenswürdigkeiten (OSM/Overpass) in `Place` mit `type=SEHENSWUERDIGKEIT`.

Unterstützte Modi:

- **Region-Modus** (bestehend): Normandie / Bretagne über Overpass Area Query
- **Nearby-Modus** (neu): Radius um expliziten Mittelpunkt (`--center` + `--radius-km`) oder Preset (`--near=nievern`)

## Was importiert wird

Der Import zieht nur kuratierte OSM-Kandidaten, u. a.:

- `tourism=attraction`
- `tourism=viewpoint`
- `historic=*` (z. B. Burg/Festung/Ruinen/Memorial/Monument/archäologische Orte)
- `heritage=*`
- `natural=*`
- `man_made=lighthouse`
- megalithische Hinweise (`site_type`, `megalith_type`, Dolmen/Menhir)
- relevante historische Architektur (`building=abbey|cathedral|church|chapel|castle`)

Zusätzlich wird hart gefiltert:

- Positiv: Landmarken, Aussichtspunkte, historische/architektonische Orte, markante Naturpunkte.
- Negativ: Freizeit-/Entertainment-/Shopping-/Indoor-POIs (Theme Parks, Aquarien, Malls etc.), Spielplätze, Utility-Kram.

## Regionen (bestehend)

- `normandie` (`FR-NOR`)
- `bretagne` (`FR-BRE`)
- `all` (beide Regionen)

Der Import ist bewusst lokal begrenzt (Area Query oder Nearby Radius), es wird **nicht** ein ganzes Land blind importiert.

## CLI Optionen

Allgemein:

- `--limit=<n>` (begrenzt nur die lokale Weiterverarbeitung nach Normalisierung/Dedupe)
- `--max-elements=<n>` (kürzt die Overpass-Response auf n Elemente direkt nach dem Fetch)
- `--dry-run` (keine DB Writes)
- `--force` (ignoriert DB-Dublettenprüfung)
- `--verbose`
- `--overpass-url=<url>` (überschreibt `OVERPASS_URL`)

Region-Modus:

- `--region=normandie|bretagne|all`
- `--bbox=minLon,minLat,maxLon,maxLat` (verkleinert die Overpass-Abfrage auf eine kleine Box)
- `--test-mode` (nutzt pro Region eine kleine feste BBox)

Nearby-Modus (neu):

- `--center=<lat,lng>`
- `--radius-km=<number>`
- optional: `--near=nievern` (Preset für lokalen Testfall)

Hinweise zu Kombinationen:

- Nearby kann **nicht** mit `--bbox` oder `--test-mode` kombiniert werden.
- Bei `--near=nievern` werden Center und Standardradius vorbelegt (können über `--center/--radius-km` überschrieben werden).

## Nearby Beispiele (Nievern / Lahntal / Koblenz)

Dry-run mit explizitem Center:

- `npm run import:sightseeing:seed -- --center=50.316,7.617 --radius-km=35 --limit=30 --dry-run --verbose`

Dry-run mit Preset:

- `npm run import:sightseeing:seed:nievern -- --dry-run --limit=30 --verbose`

Echter Import:

- `npm run import:sightseeing:seed -- --center=50.316,7.617 --radius-km=35 --limit=30 --verbose`

Mit diesem Radius sollten realistische Sehenswürdigkeiten aus Nievern/Lahntal/Koblenz/Mittelrhein in sinnvoller Größe testbar sein.

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
