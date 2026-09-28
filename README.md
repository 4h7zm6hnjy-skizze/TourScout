# TourScout

Responsiver PWA-Prototyp für Fahrradnavigation und Ausflugssuche.

## Enthalten
- Hoch- und Querformat
- MapLibre + OpenFreeMap
- BRouter Fahrrad-Routing (Trekking, MTB, Rennrad)
- Start/Ziel/Zwischenpunkte
- Höhenmeter, Distanz und Zeit aus BRouter
- GPS-Fahrmodus mit deutscher Browser-Sprachausgabe auf Basis der BRouter-Voicehints
- GPX-Export
- Ausflugsfinder mit Schönwetter-/Schlechtwetterfilter und 5–200-km-Radius
- Campingplätze und E-Bike-Lademöglichkeiten aus OpenStreetMap/Overpass, bei geplanter Route entlang mehrerer Streckenabschnitte
- Bikepacking-Etappenvorschau
- lokale Favoriten
- lokaler Aufrufzähler

## Starten
Wegen PWA/Service-Worker nicht per `file://`, sondern über einen lokalen Webserver starten, z. B.:

    python -m http.server 8080

Dann http://localhost:8080 öffnen.

## GitHub Pages
Alle Dateien in das Root-Verzeichnis eines GitHub-Repositories legen und Pages aktivieren.

## Kosten / Lizenzen
Die App benötigt keine API-Keys und keine kostenpflichtigen APIs. Die eingesetzten Daten/Komponenten sind offen, aber nicht "ohne Lizenzbedingungen": OpenStreetMap-Daten unter ODbL, MapLibre unter BSD-3-Clause, BRouter unter MIT. Die vorgeschriebene OSM-Attribution ist in der Karte enthalten.

## Wichtiger Hinweis für öffentliche Nutzung
Die Standardkonfiguration greift auf öffentliche BRouter- und Overpass-Instanzen zu. Das ist für Entwicklung und moderate Nutzung geeignet, aber Gemeinschaftsinfrastruktur mit Fair-Use-Regeln. Für hohe Nutzerzahlen sollten BRouter/Overpass selbst gehostet oder durch geeignete freie Infrastruktur ersetzt werden.

## Aufrufzähler
Der Prototyp zählt Aufrufe **lokal pro Gerät**. Ein globaler Zähler benötigt einen beschreibbaren Server/Backend-Dienst; GitHub Pages allein kann globale Zähler nicht persistent speichern.
