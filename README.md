<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-wordmark.svg">
    <img src="public/logo-wordmark-light.svg" alt="FaceitWatcher" height="64">
  </picture>
</h1>

Lokales Tool, mit dem du eigene Faceit-Overlays (Elo, Level, Session-Stats, K/D, …) für OBS baust und deine Faceit-Statistiken automatisch speicherst.

- **Editor im Browser**: jede Stat einzeln an/aus, per Drag & Drop verschieben (mit Einrasten an anderen Elementen), Farben, Schrift, Größe, Hintergrund, Rahmen. Mehrere Overlays möglich.
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

`docker-compose.yml` startet den FaceitWatcher-Server (Editor, Overlay, Faceit-Abfrage).

```bash
cp .env.example .env      # Werte eintragen, siehe unten
docker compose up -d --build
docker compose logs -f    # Ausgabe ansehen
```

In OBS dann die LAN-Adresse des Servers verwenden, z. B. `http://192.168.0.10:3000/overlay/abcd1234`. Alle Daten liegen im Ordner `data/` neben der `docker-compose.yml`.

Update: `git pull` und danach `docker compose up -d --build`.

## Landingpage (optional)

Der Server kann zusätzlich eine statische Website unter `/site/` ausliefern. Sie gehört nicht zu diesem Repo: Lege die Dateien in den Ordner `website/` neben dieser README (wird von Git ignoriert und in Docker eingebunden) oder gib mit `SITE_DIR` einen anderen Ordner an.

Mit `SITE_HOST=deine-domain.de` in `.env` zeigt der Server unter dieser Domain die Website (z. B. hinter Nginx Proxy Manager). Der Editor ist dort nur nach Login erreichbar:

1. In `.env` `ADMIN_USER` (Standard `admin`) und ein langes `ADMIN_PASSWORD` eintragen, Server neu starten.
2. Auf der Website oben auf **Login** klicken (Seite `login.html` aus dem Website-Repo), danach geht es direkt in den Editor (`/editor.html`).

Ohne Login sind über die Domain nur die Website, die Bilder und die Overlays lesend erreichbar (`/overlay/<id>`, damit OBS auch von außen funktioniert). Alles andere (Editor, Änderungen über die API) braucht die Anmeldung. Nach 10 falschen Versuchen sperrt der Server die IP für 15 Minuten. Ein neues Passwort meldet alle Sitzungen ab. Ohne `ADMIN_PASSWORD` bleibt der Editor über die Domain gesperrt. Im Heimnetz (localhost oder LAN-IP) braucht der Editor weiterhin keinen Login.

## Schnittstelle für andere Clients

Die Faceit-API wird **nur vom Server** abgefragt. Overlay und Editor lesen dieselben gespeicherten Daten:

| Endpunkt | Inhalt |
| --- | --- |
| `GET /api/state` | aktueller Spieler, Session- und Season-Stats |
| `GET /api/matches?limit=20` | gespeicherte Matches, neueste zuerst (`MatchResult`, siehe `src/faceit/types.ts`) |
| `GET /api/history?since=ISO` | Elo-Verlauf |
| `GET /api/events` | Server-Sent Events: `state`, `overlay`, `match` |
| `GET /api/me` | Login-Status (`user`, `loginEnabled`, `site`) |
| `POST /api/login` / `POST /api/logout` | An- und Abmelden für den Editor über die Website (`{ "user", "password" }`) |
| `GET /assets/level/1` … `/10` | offizielles Faceit-Level-Symbol (lokal zwischengespeichert) |
| `GET /assets/remote?url=…` | Faceit-Bild (Avatar, Avatar-Rahmen) aus dem lokalen Cache |

Ein `match`-Event wird erst gesendet, wenn die Elo-Änderung des Matches bekannt ist (spätestens nach drei Abrufen, dann `eloChange: null`). Clients sollten per `matchId` deduplizieren.

## Faceit-Symbole und Avatar-Rahmen

- Die **Level-Symbole** sind standardmäßig ein eingebauter Nachbau im Faceit-Stil (Bogen in Levelfarbe mit Zahl) und funktionieren ohne Netzwerk. Alternativ lädt der Server die Originaldatei einmal von Faceits CDN und speichert sie unter `data/assets/`. Die Adresse lässt sich mit `LEVEL_ICON_URL` (Platzhalter `{level}`) anpassen. Lädt sie nicht, wird der Nachbau angezeigt. Die Auswahl findest du im Editor unter **Design → Level-Symbol**.
- Den **Avatar-Rahmen** liefert die offizielle Data API nicht. Der Server liest ihn deshalb stündlich über die Schnittstelle, mit der auch die Faceit-Webseite den ausgerüsteten Rahmen lädt (`/api/user-summary/v2/list`). Diese ist inoffiziell und kann sich ändern. Findet er keinen Rahmen, kannst du im Editor unter „Spieler“ selbst eine Bild-Adresse eintragen.
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
