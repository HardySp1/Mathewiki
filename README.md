# Mathe-Wissensraum (Manim Edition)

Interaktive Wissenslandkarte mit Semantic Zoom, KaTeX-Formelsatz, eingebetteten GeoGebra-Applets, Video-Slots und integriertem GitHub-Admin-Modus.

## Dateistruktur

- `index.html` – Hauptseite und Modals (Medienplayer, Admin-Login, Baustein-Editor)
- `styles.css` – Manim-inspiriertes Dark-Glassmorphism-Design & Semantic-Zoom-Steuerung
- `app.js` – Canvas-Navigation, Verlinkungen, Medien-Einbettung und GitHub-API-Sync
- `data/nodes.json` – Alle 185 Themenknoten & 7 GeoGebra-Applets aus dem bestehenden Mathewiki

## Deployment auf GitHub Pages

1. Entpacke dieses Archiv und lade alle Dateien (`index.html`, `styles.css`, `app.js` sowie den Ordner `data/nodes.json`) in dein GitHub-Repository (`hardysp1/Mathewiki`) hoch.
2. Aktiviere unter **Settings → Pages** die Bereitstellung aus dem gewählten Branch (`main` / Root).
3. Rufe die Seite anschließend unter `https://hardysp1.github.io/Mathewiki/` auf (lokales Doppelklicken von `index.html` blockiert in manchen Browsern `fetch('data/nodes.json')` wegen CORS – über GitHub Pages oder einen lokalen Webserver wie `python3 -m http.server` funktioniert es direkt).

## Admin-Login einrichten (Persistentes Bearbeiten)

1. Öffne auf GitHub **Settings → Developer settings → Personal access tokens → Fine-grained tokens**.
2. Klicke auf **Generate new token**, wähle unter *Repository access* ausschließlich dein Repository `Mathewiki` aus und setze unter *Permissions → Repository permissions* den Punkt **Contents** auf **Read and write**.
3. Kopiere den Token, klicke auf deiner Website oben rechts auf **Admin-Login** und melde dich an.
4. Jetzt kannst du Bausteine per **Drag & Drop** verschieben, über das **✎-Symbol** bearbeiten, beliebig viele **GeoGebra-Applets** und **Videos** ergänzen und alle Änderungen mit **„Auf GitHub speichern“** dauerhaft ins Repository schreiben.
