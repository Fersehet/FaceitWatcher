# FaceitWatcher Website

Statische Landingpage (Deutsch), die das FaceitWatcher OBS-Overlay bewirbt. Ohne Build-Schritt: `index.html` direkt im Browser öffnen. Der FaceitWatcher-Server liefert die Seite unter `/site/` mit aus, öffentlich über `SITE_HOST` (siehe Haupt-README).

Die Werte in der Overlay-Vorschau und im Elo-Diagramm sind Beispieldaten.

Die Overlay-Vorschau in der Stream-Szene nutzt den echten Renderer des Tools (`public/js/render.js`, vom Server unter `js/render.js` ausgeliefert). Läuft die Seite über den FaceitWatcher-Server, zeigt sie das erste gespeicherte Overlay mit den aktuellen Werten (`live.json`). Sonst kommen das Standard-Overlay und ein Stand von Jans Faceit-Account (Fersehet) aus `demo.json`. Die Matches dort sind simuliert.
