# Sightseeing Seed Import (Normandie + Bretagne)

Dieses Seed-Script importiert echte Sehenswürdigkeiten (OSM/Overpass) gezielt für **Normandie** und **Bretagne** in `Place` mit `type=SEHENSWUERDIGKEIT`.

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

- Positiv: Natur-/Küstenorte, Landmarken, Aussichtspunkte, historische/architektonische Orte.
- Negativ: Freizeit-/Entertainment-/Shopping-/Indoor-POIs wie Theme Parks, Aquarien, Malls, Family-Park-Formate etc.

## Regionen

- `normandie` (`FR-NOR`)
- `bretagne` (`FR-BRE`)
- `all` (beide Regionen)

Der Import ist bewusst region-begrenzt über Overpass Area Queries. Es wird **nicht** ganz Frankreich importiert.

## CLI Optionen

- `--region=normandie|bretagne|all`
- `--limit=<n>` (begrenzt nur die lokale Weiterverarbeitung nach Normalisierung/Dedupe)
- `--bbox=minLon,minLat,maxLon,maxLat` (verkleinert die Overpass-Abfrage wirklich auf eine kleine Box)
- `--test-mode` (nutzt pro Region eine kleine, feste BBox für schnelle lokale Tests)
- `--max-elements=<n>` (kürzt die Overpass-Response auf n Elemente direkt nach dem Fetch)
- `--dry-run` (keine DB Writes)
- `--force` (ignoriert DB-Dublettenprüfung)
- `--verbose`
- `--overpass-url=<url>` (überschreibt `OVERPASS_URL`)


## Kleiner Testmodus (echte Overpass-Reduktion)

Für lokale Tests gibt es jetzt zwei Wege, die **Overpass-Last selbst** zu verkleinern:

1. `--bbox=...`
   - Schränkt die Query direkt auf eine Bounding Box ein.
   - Das reduziert Request-Volumen/Antwortgröße schon auf Overpass-Seite.
2. `--test-mode`
   - Nutzt eine kleine vordefinierte Test-BBox je Region (Normandie/Bretagne).
   - Gut für schnelle, reproduzierbare Dry-Runs ohne manuelle Koordinaten.

Optional zusätzlich:

- `--max-elements=<n>` kappt die Overpass-Elementliste direkt nach der API-Antwort (vor Normalisierung/Filterung).

Wichtig zur Abgrenzung:

- `--limit=<n>` wirkt **nur lokal** nach Normalisierung + Dedupe auf die Anzahl der weiterverarbeiteten Kandidaten.
- `--limit` macht die eigentliche Overpass-Abfrage **nicht** kleiner.

## Overpass Endpoint (Standard + Fallback)

- Standard-Endpoint: `https://overpass-api.de/api/interpreter`
- Primärer Endpoint kann über Env `OVERPASS_URL` gesetzt werden.
- Alternativ per CLI `--overpass-url=...` (hat Vorrang gegenüber Env).
- Bei temporären Overpass-Fehlern (u. a. `429`) versucht der Importer kurze Retries und fällt danach auf `https://lz4.overpass-api.de/api/interpreter` zurück.

Beispiele:

- Env:
  - `OVERPASS_URL=https://lz4.overpass-api.de/api/interpreter npm run import:sightseeing:seed -- --region=normandie --dry-run --limit=30`
- CLI:
  - `npm run import:sightseeing:seed -- --region=normandie --dry-run --limit=30 --overpass-url=https://lz4.overpass-api.de/api/interpreter`

## Praktische lokale Testläufe

Kleine echte Overpass-Abfrage per vordefiniertem Testmodus:

- `npm run import:sightseeing:seed:normandie -- --dry-run --test-mode --limit=30`
- `npm run import:sightseeing:seed:bretagne -- --dry-run --test-mode --limit=30`

Kleine echte Overpass-Abfrage per expliziter BBox:

- `npm run import:sightseeing:seed:normandie -- --dry-run --bbox=-1.585,49.63,-1.42,49.705 --limit=30`
- `npm run import:sightseeing:seed:bretagne -- --dry-run --bbox=-4.495,48.36,-4.405,48.41 --limit=30`

Zusätzlich optional für besonders kleine Runs:

- `npm run import:sightseeing:seed:normandie -- --dry-run --test-mode --max-elements=50 --limit=30`

Danach regulär:

1. Echten Import starten (ohne `--dry-run`, ohne Test-BBox falls Vollimport gewünscht).
2. Danach TS-Sehenswürdigkeiten anreichern:
   - `POST /api/admin/sightseeing-autofill`

## Dublettenlogik (v1)

Konservativ und nachvollziehbar:

- Batch-intern: nahe Koordinaten + sehr ähnliche Namen werden zusammengeführt.
- Gegen DB: bestehende `SEHENSWUERDIGKEIT`-Datensätze werden über Name+Distanz-Heuristik geprüft.
- Bei Treffer wird standardmäßig übersprungen (kein aggressives Merge-Update).

## Hinweise

- Persistiert werden aktuell nur sichere Kernfelder (`name`, `type`, `lat`, `lng`).
- Quell-Metadaten (Kategorie/Tags/Source/Region/Country) werden intern normalisiert und für spätere Schema-Erweiterung vorbereitet, aber aktuell nicht in `Place` gespeichert.
