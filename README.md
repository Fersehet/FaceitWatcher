<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="public/logo-animated.svg">
    <img src="public/logo-animated-light.svg" alt="FaceitWatcher" height="72">
  </picture>
</h1>

Eigene Faceit-Overlays (Elo, Level, K/D, Session-Stats, …) für OBS bauen und selbst hosten. Der Server fragt Faceit ab und speichert deine Statistiken, im Editor gestaltest du das Overlay, OBS zeigt es als Browserquelle.

## Voraussetzungen

- [Node.js](https://nodejs.org) 22.13 oder neuer
- Ein Faceit API-Key (ohne Key läuft alles im Demo-Modus mit Beispieldaten)

## Faceit API-Key holen

1. Auf [developers.faceit.com](https://developers.faceit.com) einloggen.
2. Im **App Studio** eine App anlegen.
3. Unter **API Keys** einen Key vom Typ **Server side** erstellen.

## Einrichten und starten

```bash
git clone https://github.com/Fersehet/FaceitWatcher.git
cd FaceitWatcher
npm install
cp .env.example .env   # Windows: copy .env.example .env
```

In `.env` mindestens eintragen:

```env
FACEIT_API_KEY=dein-key
ADMIN_PASSWORD=ein-langes-passwort
```

Dann starten:

```bash
npm start
```

Im Browser **http://localhost:3000** öffnen und mit Benutzer `admin` und deinem Passwort anmelden. Im Editor deinen Faceit-Nickname eintragen und das Overlay gestalten.

## In OBS einbinden

1. Im Editor bei **In OBS einbinden** die URL kopieren, z. B. `http://localhost:3000/overlay/abcd1234`.
2. In OBS **Quelle hinzufügen → Browser** wählen und die URL einfügen.
3. Breite und Höhe wie im Editor unter **Design** eintragen.

Läuft der Server auf einem anderen Rechner, statt `localhost` dessen IP verwenden. Overlays sind ohne Login lesbar, der Editor nicht.

## Update

```bash
git pull
npm install
npm start
```

Deine Overlays und Statistiken liegen in `data/` und bleiben erhalten. Weitere Einstellungen (Port, Abfrage-Intervall, Speicherort) stehen in `.env.example`.
