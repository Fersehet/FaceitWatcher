# Nginx Proxy Manager: Logs nach 14 Tagen löschen

Die Datenschutzerklärung der Landingpage verspricht, dass Server-Logs mit IP-Adressen nach spätestens 14 Tagen gelöscht werden. Der Nginx Proxy Manager hebt Zugriffs-Logs standardmäßig etwa 5 Wochen und Fehler-Logs etwa 10 Wochen auf. `logrotate.conf` stellt beides auf täglich rotieren und 14 Tage aufbewahren um.

## Einbinden

1. `logrotate.conf` auf den Server kopieren, in den Ordner mit der `docker-compose.yml` des Nginx Proxy Managers.
2. Dort beim Dienst des Proxy Managers unter `volumes` eine Zeile ergänzen:

   ```yaml
   services:
     app:
       image: jc21/nginx-proxy-manager:latest
       volumes:
         - ./data:/data
         - ./letsencrypt:/etc/letsencrypt
         - ./logrotate.conf:/etc/logrotate.d/nginx-proxy-manager:ro
   ```

3. Neu starten: `docker compose up -d`

## Prüfen

```bash
# Zeigt, was logrotate tun würde, ohne etwas zu löschen
docker compose exec app logrotate -d /etc/logrotate.d/nginx-proxy-manager

# Alte Logs sofort aufräumen
docker compose exec app logrotate -f /etc/logrotate.d/nginx-proxy-manager
```

Nach dem ersten Lauf liegen in `data/logs/` höchstens 14 alte, komprimierte Dateien je Log (`.1` bis `.14.gz`).
