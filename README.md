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

## Docker (z. B. auf einem Heimserver)

`docker-compose.yml` startet zwei Container: den FaceitWatcher-Server (Editor, Overlay, Faceit-Abfrage) und den Discord-Bot.

```bash
cp .env.example .env      # Werte eintragen, siehe unten
docker compose up -d --build
docker compose logs -f    # Ausgabe ansehen
```

In OBS dann die LAN-Adresse des Servers verwenden, z. B. `http://192.168.0.10:3000/overlay/abcd1234`. Alle Daten liegen im Ordner `data/` neben der `docker-compose.yml`.

Update: `git pull` und danach `docker compose up -d --build`.

## Discord-Bot

Nach jedem beendeten Match postet der Bot das Ergebnis in einen Channel: Sieg/Niederlage, Map, Endstand, Elo-Änderung, K/D/A, K/D, ADR, HS % und MVPs. Der Bot fragt Faceit nicht selbst ab, er bekommt die Matches vom Server. Fehlt eine Nachricht, weil der Bot kurz weg war, holt er sie beim Wiederverbinden nach. Beim allerersten Start werden alte Matches übersprungen.

### Bot-Token und Channel-ID holen

1. Im [Discord Developer Portal](https://discord.com/developers/applications) auf **New Application** klicken und einen Namen vergeben (z. B. „FaceitWatcher“).
2. Links **Bot** öffnen, **Reset Token** klicken und den Token kopieren. Er gehört nur in deine `.env` als `DISCORD_BOT_TOKEN=`. Nirgends posten, er ist wie ein Passwort.
3. Links **OAuth2 → URL Generator**: Scope **bot** anhaken, darunter die Rechte **View Channels**, **Send Messages** und **Embed Links**. Die erzeugte URL im Browser öffnen und den Bot auf deinen Server einladen.
4. In Discord unter **Einstellungen → Erweitert** den **Entwicklermodus** einschalten. Dann Rechtsklick auf den Channel → **Kanal-ID kopieren** und als `DISCORD_CHANNEL_ID=` eintragen.

Privilegierte Intents braucht der Bot nicht, er schreibt nur.

**Ohne eigenen Bot geht es auch per Webhook:** Channel bearbeiten → **Integrationen → Webhooks → Neuer Webhook**, URL kopieren und als `DISCORD_WEBHOOK_URL=` eintragen (dann Token und Channel-ID leer lassen).

### Testen

```bash
docker compose run --rm discord-bot node --import tsx src/bot/index.ts --test
```

Schickt eine Beispielnachricht in den Channel. Ohne Docker: `npm run bot:test`. Ohne Faceit-API-Key läuft der Server im Demo-Modus und erfindet regelmäßig Matches, so siehst du den Bot auch ohne echte Spiele arbeiten. Ist gar nichts für Discord eingetragen, schreibt der Bot die Ergebnisse nur ins Log.

Ohne Docker: Server mit `npm start`, Bot in einem zweiten Terminal mit `npm run bot`.

## Schnittstelle für Discord-Bot und andere Clients

Die Faceit-API wird **nur vom Server** abgefragt. Overlay, Editor und Discord-Bot lesen dieselben gespeicherten Daten:

| Endpunkt | Inhalt |
| --- | --- |
| `GET /api/state` | aktueller Spieler, Session- und Season-Stats |
| `GET /api/matches?limit=20` | gespeicherte Matches, neueste zuerst (`MatchResult`, siehe `src/faceit/types.ts`) |
| `GET /api/history?since=ISO` | Elo-Verlauf |
| `GET /api/events` | Server-Sent Events: `state`, `overlay`, `match` |
| `GET /assets/level/1` … `/10` | offizielles Faceit-Level-Symbol (lokal zwischengespeichert) |
| `GET /assets/remote?url=…` | Faceit-Bild (Avatar, Avatar-Rahmen) aus dem lokalen Cache |

Ein `match`-Event wird erst gesendet, wenn die Elo-Änderung des Matches bekannt ist (spätestens nach drei Abrufen, dann `eloChange: null`). Clients sollten per `matchId` deduplizieren.

## Faceit-Symbole und Avatar-Rahmen

- Die **Level-Symbole** sind standardmäßig ein eingebauter Nachbau im Faceit-Stil (Bogen in Levelfarbe mit Zahl) und funktionieren ohne Netzwerk. Alternativ lädt der Server die Originaldatei einmal von Faceits CDN und speichert sie unter `data/assets/`. Die Adresse lässt sich mit `LEVEL_ICON_URL` (Platzhalter `{level}`) anpassen. Lädt sie nicht, wird der Nachbau angezeigt. Die Auswahl findest du im Editor unter **Design → Level-Symbol**.
- Den **Avatar-Rahmen** liefert die offizielle Data API nicht. Der Server liest ihn deshalb stündlich aus Faceits Profil-Schnittstelle der Webseite. Diese ist inoffiziell und kann sich ändern. Findet er keinen Rahmen, kannst du im Editor unter „Spieler“ selbst eine Bild-Adresse eintragen.
- **Nutzungsrechte**: Symbole, Rahmen und Logos gehören FACEIT. Sie werden deshalb nicht im Repo mitgeliefert, sondern nur lokal für dein eigenes Overlay zwischengespeichert. Für ein öffentliches Produkt (z. B. die spätere Web-App) bitte vorher die Erlaubnis von FACEIT einholen.

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
  bot/               Discord-Bot (liest Matches vom Server, postet sie in Discord)
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
