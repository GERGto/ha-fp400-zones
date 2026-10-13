# Changelog

## Unreleased

- MQTT-TLS-Zertifikate werden geprüft; bekannte Zugangsdaten und Gerätekennungen in App-Diagnosen werden geschwärzt.
- WebSocket-Anfragen validiert, Nachrichtengröße begrenzt, Standalone-Origin und Add-on-Ingress geprüft.
- MQTT-Werte im Editor als Text dargestellt; ungültige Converter-Layouts abgefangen.
- Layout-Sicherung erst nach erfolgreicher Zigbee2MQTT-Antwort; entfernte Geräte aus dem Live-Cache entfernt.
- `ws` auf 8.22.0 aktualisiert, um bekannte Sicherheitslücken zu beheben.
- Regressionstests, ESLint, Add-on-Linter und Container-Builds in CI ergänzt.
- Installation, Datenschutz, Deinstallation und Grenzen der bisherigen Kompatibilitätsprüfung dokumentiert.

Noch kein Release: App-Version und bestehender Tag bleiben bei 1.0.0; der interne Converter-Versionsstand ist unabhängig davon 1.1.0.

## 1.0.0

- Erste Version als Home-Assistant-App
- Automatische Einrichtung: externe Converter in Z2M erlauben, Converter installieren und aktualisieren, Sensor konfigurieren
- Zonen-Editor in der Seitenleiste (Ingress), MQTT-Zugangsdaten über den Supervisor
- Converter v1.1.0: Definition mit Version, damit Z2M bei Updates selbst neu konfiguriert
