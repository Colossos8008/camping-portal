# ChatGPT Working Agreement – Verbindliche Arbeitsregeln

Dieses Dokument definiert die **verbindlichen Arbeitsregeln** für die Zusammenarbeit
zwischen dem Projektinhaber und ChatGPT.

Es gilt **ab dem Moment**, in dem dieses Dokument im Chat gepostet wird,
und ersetzt **alle impliziten Annahmen**.

---

## 🔒 0. Oberste Regel (nicht verhandelbar)

**ChatGPT darf niemals eigenständig entscheiden, Code zu kürzen,
neu zu strukturieren, zu vereinfachen oder Funktionalität zu entfernen.**

➡️ Bei Unsicherheit wird **immer gefragt**, niemals geraten.

---

## 📁 1. Dateibaseline-Pflicht

- ChatGPT arbeitet **ausschließlich auf Basis der vom Nutzer geposteten Originaldateien**
- Ohne gepostete Datei **keine Code-Antwort**
- Es gibt **keine Rekonstruktion aus dem Gedächtnis**

Formel:
- ❌ „Bitte passe Datei X an“
- ✅ „Hier ist die aktuelle Datei X. Bitte erweitere sie um …“

---

## 📄 2. Immer komplette Dateien

- **Keine Snippets**
- **Keine Teilauszüge**
- **Immer: vollständiger Dateipfad + kompletter Dateiinhalt**
- Die Datei muss **1:1 ersetzbar** sein (Copy-Paste)

---

## ✂️ 3. Änderungsregeln

Vor jeder Code-Lieferung muss ChatGPT explizit prüfen und garantieren:

- Entfernte Zeilen: **0**
- Umstrukturierung bestehender Logik: **nein**
- Refactoring: **verboten**
- Feature-Entfernung: **verboten**

Erlaubt sind **nur additive Änderungen**.

---

## 🧾 4. Änderungs-Checkliste (Pflicht)

Jede Code-Antwort beginnt mit:

Wenn auch nur ein Punkt nicht erfüllt ist → **STOP und Rückfrage**.

---

## 🧠 5. Implizite Entscheidungen sind verboten

ChatGPT darf **keine Annahmen treffen**, u. a. zu:

- Feature-Relevanz
- Vereinfachbarkeit
- „Unnötigem“ Code
- UI-/UX-Entscheidungen
- Typ- oder Datenmodell-Logik

Stattdessen ist **immer eine Rückfrage zu stellen**.

---

## 🛡️ 6. Feature-Schutzregel

Alles, was aktuell funktioniert, gilt als **geschützt**.

Neue Features dürfen:
- ✅ parallel ergänzt werden
- ❌ niemals bestehendes Verhalten verändern

---

## 🧯 7. STOP-Regel (Notbremse)

Der Nutzer kann jederzeit schreiben:

> **„STOP – Regelbruch-Check“**

In diesem Fall darf ChatGPT **keinen neuen Code liefern**,
sondern nur:

- den letzten Schritt analysieren
- mögliche Regelverstöße benennen
- Korrekturvorschläge **ohne Code**

---

## 🚫 8. Technische Verbote (projektspezifisch, falls zutreffend)

Sofern nicht explizit freigegeben:

- ❌ Prisma-Migrationen
- ❌ DB-Änderungen
- ❌ Enum-Änderungen
- ❌ Production-Deploys
- ❌ gleichzeitiges Anfassen von Preview + Production

---

## 🤝 9. Ziel dieser Regeln

Diese Regeln existieren, um sicherzustellen, dass:

- der Projektinhaber **keinen Kontrollverlust** erleidet
- investierte Entwicklungszeit **respektiert wird**
- die Zusammenarbeit **ruhig, planbar und vertrauensvoll** bleibt
- Frustration durch Überraschungen **verhindert wird**

---

## ✅ 10. Verbindlichkeit

Mit dem Posten dieses Dokuments im Chat gilt:

- Diese Regeln sind **verbindlich**
- Regelverstöße sind **Fehler**
- ChatGPT ist verpflichtet, diese Regeln **aktiv einzuhalten**