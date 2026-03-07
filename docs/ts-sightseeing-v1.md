# TS Sehenswürdigkeiten v1

TS Sehenswürdigkeiten v1 ist eine additive, regelbasierte Vorbewertung für `Place.type = SEHENSWUERDIGKEIT`.

## Neue Place-Felder (optional)

- `natureScore` (0..5)
- `architectureScore` (0..5)
- `historyScore` (0..5)
- `uniquenessScore` (0..5)
- `spontaneityScore` (0..5)
- `calmScore` (0..5)
- `crowdRiskScore` (0..5)
- `sightseeingTotalScore` (0..100)
- `sightRelevanceType` (`ICON | STRONG_MATCH | GOOD_MATCH | OPTIONAL | LOW_MATCH`)
- `sightVisitModePrimary` (`EASY_STOP | SMART_WINDOW | OUTSIDE_BEST | MAIN_DESTINATION | WEATHER_WINDOW`)
- `sightVisitModeSecondary` (optional, gleicher Enum)
- `bestVisitHint`
- `summaryWhyItMatches`

Alle Felder sind nullable, damit Bestandsdaten ohne Migration der Inhalte weiterlaufen.

## Regelbasierte Bewertung

Zentrale Funktion: `rateSightseeing(input)` in `src/lib/sightseeing-rating.ts`.

Eingaben (robust/optional):
- `name`, `description`, `category`, `tags`, `source`, `address`, `region`, `country`, `type`

Ausgabe enthält alle oben genannten Score-/Meta-Felder.

### Leitplanken

- Crowd-Risiko beeinflusst den Score, zerstört aber ICON-Kandidaten nicht automatisch.
- Ikonische Orte mit hohem Andrang erhalten typischerweise `SMART_WINDOW` + passenden Besuchshinweis.
- Für Landmarken mit starker Außenwirkung kann zusätzlich `OUTSIDE_BEST` gesetzt werden.

## Backfill / Autofill auslösen

Admin Endpoint:

`POST /api/admin/sightseeing-autofill`

Body (optional):

```json
{
  "limit": 100,
  "offset": 0,
  "cursor": 123,
  "ids": [1, 2, 3],
  "type": "SEHENSWUERDIGKEIT",
  "dryRun": true,
  "force": false
}
```

Hinweise:
- Default-Type ist `SEHENSWUERDIGKEIT`.
- `dryRun=true` schreibt nichts in die DB, liefert aber Vorschau.
- `force=true` überschreibt bereits gesetzte TS-Sehenswürdigkeiten-Felder.

## Verifikation

```bash
npm run verify:sightseeing-rating
```

Deckt Kernfälle ab:
- starker Naturort
- starker Architektur-/Geschichtsort
- ikonischer Massen-Hotspot
- unpassender Entertainment-Spot
