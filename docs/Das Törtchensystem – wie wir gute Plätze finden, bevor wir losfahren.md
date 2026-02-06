# 🎂 Törtchensystem – Filter- & Bewertungsarchitektur (Baseline)

Zweck:
Dieses Dokument beschreibt die **konzeptionelle Grundlage** des Törtchensystems
für Vorauswahl, Filterung und spätere Bewertung von Campingplätzen.

Das System ist **intern**, **subjektiv** und **entscheidungsorientiert**.
Es dient nicht der öffentlichen Bewertung, sondern der eigenen Reiseplanung.

---

## 🧭 Grundidee

Das Törtchensystem arbeitet **immer in drei strikt getrennten Ebenen**:

1. Reise-Kontext (KO-Kriterien)
2. Törtchen-Haltung (DNA / Explorer)
3. Feinfilter & spätere Bewertung (Scoring)

Diese Reihenfolge ist **zwingend**.
Keine Ebene darf Aufgaben einer anderen übernehmen.

---

## 🔒 EBENE 1 – Reise-Kontext (KO-Filter)

**Leitfrage:**  
> Welche Plätze sind für diese konkrete Reise überhaupt möglich?

Eigenschaften:
- hart
- binär (ja / nein)
- kontextabhängig
- ohne Interpretation
- ohne Punkte
- ohne Ranking

Ein Platz, der hier scheitert, wird **nicht weiter betrachtet**.

---

### ✅ Typische KO-Kriterien (Start-Set)

Diese Kriterien werden **pro Reise aktiviert oder deaktiviert**.

- 🐕 Hund dabei  
  → Hunde erlaubt

- ❄️ Winterreise  
  → im Winter geöffnet

- 🌐 Kurzfristig / sprachlich unsicher  
  → Online buchbar

- 🚿 Mindestkomfort erforderlich  
  → Sanitär vorhanden

- 🗓️ Mehrtägiger Aufenthalt  
  → ganzjährig nutzbar

---

### ➕ Weitere sinnvolle KO-Kriterien (konzeptionell vorgesehen)

Nicht zwingend sofort aktiv, aber strukturell mitgedacht:

- Stromanschluss verfügbar
- Wohnmobil geeignet (kein Zelt-only)
- Hunde ganzjährig erlaubt
- Mindestaufenthalt ≤ 2 Nächte
- Späte Anreise möglich
- Keine festen Check-in-Zeiten
- Ruhige Nutzung auch bei hoher Belegung
- Kein Party-/Eventfokus

⚠️ Wichtig:
KO-Kriterien bewerten **nicht**, sie filtern **nur Machbarkeit**.

---

## 🎚️ EBENE 2 – Törtchen-Haltung

**Leitfrage:**  
> In welcher Stimmung reisen wir?

Diese Ebene entscheidet über **Passung**, nicht über Qualität.

---

### 🎂 Törtchen-DNA (Standard)

Default-Modus – wenn nichts anderes aktiv ist.

Merkmale:
- cosy
- ruhig
- entspannt
- verlässlich
- Rückzugsort
- stressarm

➡️ Erwartung: „Runterkommen“

---

### 🧭 Törtchen-Explorer (Sonderkategorie)

Explorer ist **kein Vorfilter**, sondern eine **Erweiterung** der DNA.

Merkmale:
- bewusst außerhalb der Comfort-Zone
- Abenteuer, Konzept, Reduktion
- nicht zwingend ruhig
- zeitlich begrenzte Abweichung
- bewusst gewählt

Regeln:
- Explorer **ersetzt DNA nie**
- Explorer wird **aktiv zugeschaltet**
- Explorer-Plätze sind **klar markiert**

➡️ Erwartung: „Erleben statt entspannen“

---

## 🧩 EBENE 3 – Feinfilter & Bewertung

**Leitfrage:**  
> Warum mochten oder mochten wir diesen Platz?

Diese Ebene greift:
- nach der Reise (Scoring)
- oder weich sortierend (Vorauswahl)

Eigenschaften:
- subjektiv
- erklärend
- niemals KO-relevant

---

### 🧪 Typische Kategorien (TS 2.0)

- Sanitär
- Buchung (2a digital / 2b Ankommen)
- Öffnungszeiten / Wintertauglichkeit
- Umgebung / Landschaft (4a)
- Stellplatzqualität (4b)
- Hunde (Hilde-Faktor)
- Ruhe & Platzstruktur
- Spontaneignung

Diese Kategorien werden:
- **vor der Reise**: grob eingeschätzt
- **nach der Reise**: ehrlich bewertet

---

## 🧠 Törtchen-Scoring (nur nach Besuch)

Scoring dient ausschließlich dazu:
- Erinnerungen zu konservieren
- spätere Entscheidungen zu erleichtern
- Wiederbesuchs-Wahrscheinlichkeit einzuschätzen

Es hat **keine Filterfunktion**.

---

## 🔁 Gesamtlogik (Merksatz)
1. Was geht überhaupt? → KO-Filter
2. Was passt zur Stimmung? → DNA / Explorer
3. Warum war es gut/schlecht → Scoring

Oder kurz:

> Erst machbar.  
> Dann passend.  
> Dann erinnerbar.

🧠 Kerngedanke

Reisen ändern sich.
Stimmungen ändern sich.
Plätze nicht.

👉 Deshalb wird nie umbewertet,
sondern immer nur anders gefiltert.