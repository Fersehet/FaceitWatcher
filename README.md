# FaceitWatcher

Lokales Tool, mit dem du eigene Faceit-Overlays (Elo, Level, Session-Stats, K/D, …) für OBS baust und deine Faceit-Statistiken automatisch speicherst.

- **Editor im Browser**: jede Stat einzeln an/aus, per Drag & Drop verschieben, Farben, Schrift, Größe, Hintergrund, Rahmen. Mehrere Overlays möglich.
- **OBS-Browserquelle**: transparentes Overlay, aktualisiert sich live, auch während du im Editor etwas änderst.
- **Statistik-Speicher**: jeder neue Elo-Stand landet in einer lokalen SQLite-Datenbank (`data/`), daraus entsteht dein Elo-Verlauf.
- **Session-Stats**: Elo-Änderung und Siege/Niederlagen seit Streambeginn. Neue Session per Knopf oder automatisch nach 12 Stunden.
- **Demo-Modus**: ohne API-Key läuft alles mit Beispieldaten.

## Voraussetzungen

- [Node.js](https://nodejs.org) **22.13 oder neuer** (die LTS-Version reicht)
- Optional: ein Faceit API-Key

## Starten

```bash
npm install
cp .env.example .env   # unter Windows: copy .env.example .env
npm start
```

Dann im Browser **http://localhost:3000** öffnen.

## Faceit API-Key holen

1. Auf [developers.faceit.com](https://developers.faceit.com) mit deinem Faceit-Account einloggen.
2. Im **App Studio** eine App anlegen.
3. Unter **API Keys** einen Key vom Typ **Server side** erstellen.
4. Den Key in `.env` bei `FACEIT_API_KEY=` eintragen und das Tool neu starten.

Den Nickname setzt du direkt im Editor (oder als `FACEIT_NICKNAME` in `.env`).

## In OBS einbinden

1. Im Editor bei „In OBS einbinden“ die URL kopieren (z. B. `http://localhost:3000/overlay/abcd1234`).
2. In OBS: **Quelle hinzufügen → Browser**, URL einfügen.
3. Breite und Höhe so eintragen wie im Editor unter **Design**.

## Aufbau

```
src/
  server.ts          HTTP-Server, REST-API, Live-Updates (Server-Sent Events)
  tracker.ts         fragt Faceit regelmäßig ab, berechnet Session-Stats
  faceit/client.ts   Faceit Data API v4
  faceit/demo.ts     Beispieldaten ohne API-Key
  storage/storage.ts Speicher-Interface
  storage/sqlite.ts  SQLite-Umsetzung (node:sqlite, keine nativen Abhängigkeiten)
  overlays/          Overlay-Datenmodell und Standard-Layout
public/
  editor.html        Editor
  overlay.html       OBS-Overlay
  js/render.js       gemeinsamer Renderer für Editor-Vorschau und Overlay
```

### Weg zur Web-App

Das Tool ist so aufgebaut, dass es später gehostet werden kann:

- Alle Datenzugriffe laufen über `Storage`. Für den Server kommt eine Postgres-Umsetzung dazu.
- Overlays haben bereits eine `ownerId` (lokal immer `local`). Mit Login wird daraus die Nutzer-ID.
- Die Faceit-Abfrage steckt hinter `StatsSource`; für viele Nutzer wird daraus ein gemeinsamer Poller.
- Editor und Overlay sind reine Web-Seiten und funktionieren unverändert.
