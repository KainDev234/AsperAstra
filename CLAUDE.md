# AsperAstra – Projektnotizen für Claude

Diese Datei ist die zentrale Projektdokumentation für KI-Sitzungen (und lesbar für Menschen). Sie wird zu Beginn
jeder Sitzung gelesen. **Bei Änderungen an Konzept, Architektur oder Arbeitsweise hier aktualisieren.**
Rechnerspezifisches (IP-Adressen, lokale Netzwerk-/VPN-Details) gehört NICHT hierher, sondern ins lokale Gedächtnis.

## Konzept
- Das abgestimmte Konzept steht in `KONZEPT.md`; es geht dieser Datei bei Spielfragen vor.
- Minimalistisches Weltraum-Aufbauspiel (4X mit physikalischem Kern: die Lichtgeschwindigkeit zählt) **im Geiste**
  der Bobiverse-Bücher. Eigene Umsetzung – keine Namen, Figuren oder Begriffe aus den Büchern übernehmen.
- Neustart von Replikator (`KainDev234/Replikator`). Technik und Inhalte von dort dürfen übernommen werden,
  Mechaniken nur, wenn sie sich im neuen Konzept bewähren; jede Übernahme als eigener PR mit Herkunftsangabe.
- **Mobile first**: wird vor allem auf dem Handy im Hochformat gespielt und getestet.
- Sprache von Spiel, Code-Kommentaren, Doku, Issues und Commits: **Deutsch**.
- Weniger Text ist mehr: im ständigen Spiel Piktogramme, Farben, Zahlen; Text nur in freiwilligen Karten.

## Technik
- Läuft im Browser ohne Build-Schritt (native ES-Module). Noch kein Code; das Grundgerüst folgt in Phase 2.

## Arbeitsweise (vom Projektinhaber festgelegt)
- **Neue Mechaniken und Ideen erst diskutieren, dann umsetzen.** Auch bei Lösungen für ein bereits besprochenes
  Problem: Ansatz vorschlagen und auf Zustimmung warten.
- **Phasenweise arbeiten** (Fahrplan in `KONZEPT.md`, je Phase ein Meilenstein). Auffälligkeiten, die nicht zur
  laufenden Aufgabe gehören, kommen in den Parkplatz-Issue (#2) statt eingeschoben zu werden.
- **Prototyp vor Politur:** neue Mechaniken erst kopflos testen und mit dem Bot messen (Spielfluss statt
  Gewinnquote), dann Oberfläche. Testspielstände je Mechanik vorbereiten.
- **Code immer zeitnah und vollständig kommentieren** (Deutsch): Dateikopf, jede Funktion, nicht offensichtliche
  Formeln und Designentscheidungen.
- **Issues**: Claude legt für jede Aufgabe ein GitHub-Issue an und schließt es (per `Closes #n` im PR).
- **Branches**: pro Issue ein Branch (`feature/…`, `fix/…`, `docs/…`), nie direkt auf `main`.
- **Push & PR**: Claude pusht den Branch und eröffnet einen Pull Request.
  **Der Projektinhaber merged und löscht die Branches** – Claude merged nicht selbst.
- **Reviews durch den Fable-Reviewer** nur nach Abstimmung mit dem Projektinhaber.
- Repository: `KainDev234/AsperAstra` (öffentlich).

## Lizenz
- Code unter MIT (`LICENSE`), Texte und Grafiken unter CC BY 4.0 (`LICENSE-CONTENT.md`).

## Datenschutz
- Das Repo ist **öffentlich**: alles, was committet wird, ist sofort für alle sichtbar.
- Commits laufen mit der GitHub-noreply-Adresse als Autor (repo-lokale Git-Konfiguration),
  nicht mit privater E-Mail oder Klarnamen.
- Keine IP-Adressen, Hostnamen, Rechner-/Netzwerkdetails, Namen oder E-Mails in Code,
  Doku, Issues, Commits oder PRs.
- Das Spiel überträgt keine Daten; der Spielstand bleibt im Browser des Geräts.
- Keine Analyse-, Tracking- oder externen CDN-Ressourcen einbinden.
