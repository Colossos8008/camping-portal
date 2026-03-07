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
- `--limit=<n>`
- `--dry-run` (keine DB Writes)
- `--force` (ignoriert DB-Dublettenprüfung)
- `--verbose`

## Ablaufempfehlung

1. Seed importieren (erst trocken testen):
   - `npm run import:sightseeing:seed:normandie -- --dry-run --limit=30`
   - `npm run import:sightseeing:seed:bretagne -- --dry-run --limit=30`
2. Echten Import starten.
3. Danach TS-Sehenswürdigkeiten anreichern:
   - `POST /api/admin/sightseeing-autofill`

## Dublettenlogik (v1)

Konservativ und nachvollziehbar:

- Batch-intern: nahe Koordinaten + sehr ähnliche Namen werden zusammengeführt.
- Gegen DB: bestehende `SEHENSWUERDIGKEIT`-Datensätze werden über Name+Distanz-Heuristik geprüft.
- Bei Treffer wird standardmäßig übersprungen (kein aggressives Merge-Update).

## Hinweise

- Persistiert werden aktuell nur sichere Kernfelder (`name`, `type`, `lat`, `lng`).
- Quell-Metadaten (Kategorie/Tags/Source/Region/Country) werden intern normalisiert und für spätere Schema-Erweiterung vorbereitet, aber aktuell nicht in `Place` gespeichert.
