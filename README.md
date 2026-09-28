# TourScout

TourScout ist eine statische Progressive Web App (PWA) für Fahrradnavigation und Ausflüge. Sie läuft auf GitHub Pages und benötigt keine kostenpflichtigen API-Schlüssel.

## Funktionen

- Fahrradprofile: E-Bike, E-MTB, Trekking, Gravel, MTB, Rennrad, Citybike
- Routing-Modi: ausgewogen, ruhig/sicher, schneller, wenig Steigung, Natur
- Start/Ziel/Zwischenpunkte sowie automatisch erzeugte Rundtouren
- GPS-Fahrmodus mit deutschen Sprachhinweisen und automatischer Neuberechnung
- Höhenprofil, Höhenmeter und Streckenart aus BRouter/OSM-Daten
- GPX-Import und GPX-Export
- E-Bike-Reichweitenplanung mit Akku, Verbrauch und Reserve
- Camping- und E-Bike-Ladepunkte entlang der Route
- Ausflugsfinder in DE/AT/CH/NL/BE/PL/CZ mit Radius- und Wetterfilter
- Bikepacking-Etappen mit Camping-/Ladesuche am Etappenziel
- Favoriten, besuchte Orte und gespeicherte Touren lokal auf dem Gerät
- Teilen per Link und QR-Code
- Responsive Hoch- und Querformat-Darstellung
- PWA/Zum-Home-Bildschirm-Unterstützung
- Lokaler Aufrufzähler ohne externes Tracking

## Veröffentlichung mit GitHub Pages

1. Alle Dateien dieses Ordners direkt in die oberste Ebene des GitHub-Repositories laden. `index.html` muss direkt im Repository sichtbar sein.
2. Repository auf **Public** stellen.
3. **Settings → Pages** öffnen.
4. **Deploy from a branch** wählen.
5. Branch **main** und Ordner **/(root)** wählen.
6. Speichern.

## Wichtiger technischer Hinweis

TourScout selbst ist statisch und verursacht bei GitHub Pages keine API-Gebühren. Die App nutzt öffentliche, kostenlose Community-/Open-Data-Dienste. Diese können Fair-Use-Grenzen haben oder zeitweise nicht erreichbar sein. Für einen großen produktiven Dienst sollten BRouter/Overpass/Nominatim später selbst gehostet werden.

Siehe `NOTICES.md` und `LICENSES.md`.

## Aufrufzähler

Die GitHub-Pages-Version zählt Aufrufe lokal pro Gerät. Ein gemeinsamer globaler Zähler für alle Nutzer benötigt technisch einen schreibbaren Backend-Dienst; er ist deshalb in der vollständig statischen, backendfreien Version nicht enthalten.
