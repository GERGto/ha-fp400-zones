# Release-Review – 13. Oktober 2026

## 1. Zusammenfassung

**Veröffentlichungsbereit: Nein, noch nicht abschließend abgenommen.** Die lokal nachweisbaren Sicherheitsfehler sind behoben und die lokalen Prüfungen grün. Ein produktiver Einsatz ist weiterhin experimentell. Für eine Freigabe fehlen echte Supervisor-/Zigbee2MQTT-/FP400-Tests und erfolgreiche Container-Checks für beide Architekturen.

Typ: Home-Assistant-App/Add-on mit Node.js-Backend, eigenem Web-Editor und Zigbee2MQTT-Converter. Keine Custom Integration und keine Lovelace-Karte. Deshalb keine `manifest.json`, kein Config Flow, kein HACS, kein hassfest und kein Python-/ruff-Testlauf. `config.yaml`, `repository.yaml`, Ingress, Optionen, englische/deutsche Optionstexte und MIT-Lizenz sind vorhanden. Keine Host-Mounts, Docker-API oder privilegierten Fähigkeiten angefordert. Die MQTT-Service-API benötigt hier keine zusätzliche Supervisor-API-Berechtigung.

## 2. Datenschutz

- Alle ursprünglichen Projektdateien, die gesamte lokal erreichbare History (`git rev-list --objects --all`: zwei Commits, 19 unterschiedliche Blobs), Autoren-/Committerdaten und Bilder wurden geprüft. `git fsck --full --no-reflogs` meldete keine weiteren verwaisten Objekte. Nicht lokal vorhandene Remote-Refs oder GitHub-Artefakte sind damit nicht abgedeckt.
- Keine echten API-Schlüssel, Passwörter, Tokens, individuellen Geräteadressen, Standortkoordinaten, HA-Storage-Dateien, Datenbanken oder privaten Logs gefunden. Das ist ein Prüfresultat, keine Garantie für unbekannte externe Artefakte.
- `192.168.1.10` war eine Beispieladresse und wurde in der aktuellen Dokumentation durch `mqtt.example.invalid` ersetzt. Die ursprünglichen Beispiele bleiben in der History. `172.30.32.2` ist die dokumentierte Ingress-Proxy-Adresse und bleibt im Code. Loopback-Adressen sind technisch erforderlich. Neue Tests verwenden synthetische Daten.
- `lumi.models.4447_8295` und `PS-S05D` sind Modellkennungen. Die drei PNG-Dateien zeigen ausschließlich das Projektlogo, keine Räume, Personen oder Gerätedaten; zwei Dateien verwenden denselben Bildinhalt.
- Autorenadresse: GitHub-noreply, keine private Mailadresse. Der Name in Lizenz und Commits bleibt auf ausdrücklichen Wunsch des Eigentümers erhalten. Keine History-Bereinigung oder Secret-Rotation durch einen Fund erforderlich.
- Laufzeitbefunde behoben: TLS-Verifikation war abgeschaltet; Broker-URLs einschließlich möglicher Zugangsdaten wurden protokolliert. TLS wird jetzt geprüft, bekannte Zugangsdaten/URLs/IP-/IEEE-Adressen in App-Diagnosen geschwärzt und explizite Gerätenamen aus den normalen Backend-Logs entfernt.
- Der autorisierte Live-Editor zeigt weiterhin Gerätenamen, Kennungen und Positionen. Exporte, Browser-Entwürfe, Z2M-Konfiguration und Backups sind gesondert zu behandeln. Fremde Z2M-Logs werden nicht durch diese App geschwärzt.

## 3. Befunde und Behebung

| Schwere | Befund | Ergebnis |
|---|---|---|
| Blocker | MQTT-TLS-Prüfung deaktiviert | Standard-Zertifikatsprüfung wieder aktiv |
| Blocker | Ungültige WebSocket-Nachrichten konnten Fehler außerhalb der Fehlerbehandlung auslösen; geerbte Aktionen aufrufbar | Typ-/ID-/Own-Property-Prüfung; Regressionstests |
| Blocker | MQTT-Werte ungeschützt in HTML eingefügt | Sämtliche Live-Tabellenwerte HTML-escaped; Regressionstest |
| Blocker | Bekannte Sicherheitslücken in `ws` 8.18.0 | Update auf 8.22.0; npm audit ohne Befund |
| Wichtig | Unbegrenzte WS-Nachrichten, fehlender Standalone-Origin-Abgleich und Ingress-Bypass | 64-KiB-Limit, WS-Fehlerbehandlung, Origin-Abgleich und feste Ingress-Zugriffsprüfung |
| Wichtig | Layout-Sicherung vor Bestätigung durch Z2M | Erst nach erfolgreicher Antwort speichern; Fehlerfall getestet |
| Wichtig | Ungültige JSON-Layouts (`null`) im Converter | Abgefangen und mit Protokolltests abgesichert |
| Wichtig | Ungeprüfte MQTT-Gerätelisten und veralteter Live-Cache | Ungültige Einträge filtern, entfernte Geräte aus Live-Cache entfernen |
| Wichtig | Fehlende Tests, Linting und CI | ESLint, zwölf Node-Tests, App-Linter und zwei Architektur-Builds eingerichtet |
| Wichtig | Keine vollständige Deinstallations-/Datenschutzbeschreibung | README und DOCS um konkrete Bereinigungsschritte ergänzt |
| Wichtig | Unbelegte Mindestversionen und fehlende Hardwareabnahme | Als offen dokumentiert; keine erfundene Mindestversion in `config.yaml` eingetragen |
| Nice-to-have | Unvollständige Ignore-Regeln, private Beispiel-IP, fehlende Entwicklerhinweise | Git-/Docker-Ignore, neutrale Beispiele und CONTRIBUTING ergänzt |
| Nice-to-have | Bewegliches Docker-Basis-Tag und deutsche Editor-Oberfläche | Weiterhin offen; npm-Abhängigkeiten festgeschrieben, Sprache transparent dokumentiert |

Commits:

- `b5d8ac6` – Sicherheitskorrekturen und erste Server-/Diagnosetests.
- `ca6e1a3` – weitere Eingabehärtung, Dependency-Update, vollständige lokale Tests und CI.
- Dokumentation/Hygiene einschließlich dieses Berichts im nachfolgenden Commit `docs: document privacy, removal and release readiness`.

App-Version, npm-Paket und Lockfile bleiben konsistent bei `1.0.0`. Der vorhandene Tag `v1.0.0` bleibt auf seinem ursprünglichen Commit. Neue Änderungen sind unter **Unreleased** aufgeführt, der interne Converter-Versionsstand `1.1.0` ist unabhängig davon. Vor einer später genehmigten Veröffentlichung Versionsnummern aktualisieren. Es wurde nichts gepusht, getaggt oder veröffentlicht.

## 4. Offene Punkte und Empfehlungen

1. **Hardware-/Supervisor-Abnahme:** Docker-Dienst ist hier nicht erreichbar; Home Assistant und FP400 stehen nicht zur Verfügung. Mindestversionen erst nach Durchführung der Checkliste in CONTRIBUTING festlegen. Auch zwei Sensoren, Converter-Neuladen und dessen Timer im realen Z2M-Prozess müssen geprüft werden; die isolierten Protokolltests ersetzen das nicht.
2. **CI-Ergebnisse:** Workflow ist eingerichtet, aber nicht auf GitHub ausgeführt. Erst nach erfolgreichem App-Linter und Build für `amd64`/`aarch64` freigeben. Die einfachen lokalen Metadatenprüfungen ersetzen die vollständige Supervisor-Schemavalidierung nicht.
3. **Deinstallation:** App-Dateien liegen im eigenen Datenverzeichnis; die eigentliche Funktion verändert jedoch ausdrücklich Zigbee2MQTT und den Sensor. Eine automatische vollständige Rücknahme beim Deinstallieren gibt es nicht. README beschreibt die gezielte Bereinigung; deren praktische Abnahme ist noch offen. Frühere Montage-/Reporting-Werte sind nicht gesichert und können deshalb nicht automatisch rekonstruiert werden. Ein Sensor-Reset wäre eine gesonderte, bewusste Nutzerentscheidung.
4. **Remote-Releases:** Lokaler Tag geprüft; GitHub-Releaseseite/API war nicht abrufbar. Remote-Releasestatus nicht bestätigt. Für diesen lokal gebauten Add-on-Typ ist der HACS-Releaseablauf nicht einschlägig.
5. **Reproduzierbarkeit/Sprachen:** `node:22-alpine` bewegt sich; für bitgenauere Builds später auf geprüften Image-Digest festlegen. Optionstexte sind Englisch/Deutsch, die Oberfläche ist Deutsch. Eine komplette UI-Lokalisierung wäre ein separater Umbau.

## 5. Checks

| Prüfung | Ergebnis |
|---|---|
| `npm ci --ignore-scripts` | Erfolgreich, auch als saubere Neuinstallation aus dem finalen Lockfile |
| `npm run check` | Erfolgreich: ESLint ohne Befund, 12/12 Tests bestanden |
| `npm audit --audit-level=moderate` | Erfolgreich: 0 bekannte Sicherheitslücken, einschließlich Entwicklungsabhängigkeiten |
| YAML-/Versions-/Übersetzungsprüfung | Erfolgreich, als Node-Test enthalten |
| `git diff --check` | Erfolgreich |
| HACS / hassfest / ruff | Nicht anwendbar auf diesen Add-on-Typ |
| Home Assistant App-Linter | In CI eingerichtet, lokal mangels Docker-Dienst nicht ausgeführt |
| Docker `amd64` / `aarch64` | In CI eingerichtet, lokal nicht ausgeführt |
| Echte Installation/Hardware/Deinstallation | Nicht ausgeführt; Freigabehindernis |

## 6. Nutzerweg

Installation:

1. In Home Assistant OS den Repository-Button im README verwenden oder die Repository-URL im App-Store hinzufügen.
2. FP400 Zonen installieren, starten und die Seitenleistenansicht öffnen. Z2M, MQTT-Broker und MQTT-Discovery müssen eingerichtet sein.
3. Z2M-Konfiguration sichern, die Checkliste abarbeiten, gegebenenfalls externe Converter bestätigen, Sensor auswählen und Layout speichern.

Deinstallation:

1. Gewünschte Exporte anlegen und gegebenenfalls geschriebene Masken/native Zonen am Sensor löschen.
2. App stoppen; ihren Converter und ihre Geräteoptionen gezielt in Z2M entfernen, Z2M neu starten.
3. App deinstallieren; danach FP400-Discovery-Reste, Browser-Schlüssel `fp400.*`, Exporte und Backups prüfen und nach Bedarf gezielt entfernen. Sensor-Reset nur für einen bewusst gewünschten vollständigen Geräte-Neuanfang. Details stehen im README.

## Prüfreferenzen

- [Home Assistant App-Konfiguration](https://developers.home-assistant.io/docs/apps/configuration/)
- [Ingress und Darstellung](https://developers.home-assistant.io/docs/apps/presentation/)
- [Supervisor-Service-API und Berechtigungen](https://developers.home-assistant.io/docs/apps/communication/)
- [Offizielles Add-on-Beispiel: Lint-Workflow](https://github.com/home-assistant/addons-example/blob/master/.github/workflows/lint.yaml)
- [Zigbee2MQTT externe Converter](https://www.zigbee2mqtt.io/advanced/more/external_converters.html)
- [Zigbee2MQTT MQTT-API](https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html)
