# FP400 Zonen für Zigbee2MQTT

<img src="fp400_zones/logo.png" alt="FP400 Zonen" width="160" align="right">

Zonen für den Aqara FP400 (`lumi.models.4447_8295`) in Zigbee2MQTT – ohne Aqara-Hub, ohne Cloud.

![Stage: experimental](https://img.shields.io/badge/stage-experimental-orange)
[![Lizenz: MIT](https://img.shields.io/badge/Lizenz-MIT-blue)](LICENSE)

## Was die App macht

- Installiert und aktualisiert den FP400-Converter automatisch über die Zigbee2MQTT-MQTT-API (`bridge/request/converter/save`)
- Konfiguriert den Sensor
- Zonen-Editor in der HA-Seitenleiste (Ingress) mit Live-Positionen auf einem 16 × 20-Raster (50-cm-Zellen)
- Bis zu 8 Zonen als Binärsensoren `zone_1` … `zone_8`
- Ausschluss-, Störquellen- und Ein-/Ausgangsbereiche, Montage und Hintergrund-Lernen
- MQTT-Zugangsdaten automatisch über den Supervisor

## Voraussetzungen

- Home Assistant OS mit Supervisor und App-Store, auf `amd64` oder `aarch64`
- Eine genaue minimale Home-Assistant-Version ist noch nicht durch Installationstests belegt. Home Assistant Container/Core allein bietet keinen App-Store; dafür siehe Docker unten.
- Zigbee2MQTT 2.x mit Unterstützung der MQTT-Converter-API und aktivierter Home-Assistant-MQTT-Discovery. Die bisherige Angabe „≥ 2.0“ ist noch keine verifizierte Kompatibilitätszusage.
- Mosquitto-Broker-App
- FP400 im Zigbee-Modus

## Installation

[![Repository hinzufügen](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FGERGto%2Fha-fp400-zones)

Manuell: **Einstellungen → Apps → App-Store → ⋮ → Repositories** → `https://github.com/GERGto/ha-fp400-zones` einfügen → **FP400 Zonen** installieren → starten → **Zur Seitenleiste hinzufügen**.

> Die Installation baut das Image lokal und dauert ein paar Minuten. Dies ist ein Add-on, keine HACS-Integration. Für eine lokale Installation ohne Repository kopiere den Ordner `fp400_zones` nach `/addons/fp400_zones` auf dem HA-OS-Host, lade den App-Store neu und installiere die App unter „Lokale Apps“.

## Einrichtung in 3 Schritten

1. **App öffnen** und die Checkliste links abarbeiten. Falls nötig, aktiviert „Externe Converter erlauben“ nach Bestätigung die Ausführung externer JavaScript-Converter und startet Z2M einmal neu. Vorher die Z2M-Konfiguration sichern.
2. **Converter und Sensor-Konfiguration** laufen automatisch. Einmal durch den Raum laufen, bis „Positionen kommen an“ grün ist.
3. **Zonen malen**, benennen, „Layout speichern“. Orientierung prüfen: an die linke Wand gehen; erscheint der Punkt rechts, „horizontal spiegeln“ aktivieren.

Details zur Bedienung und zu den Optionen: [fp400_zones/DOCS.md](fp400_zones/DOCS.md).

## Entitäten in Home Assistant

| Entität | Bedeutung |
|---|---|
| `presence` | Anwesenheit im Raum |
| `target_count` | Anzahl erkannter Personen |
| `illuminance` | Helligkeit |
| `zone_1` … `zone_8` | Zone belegt/frei |
| `install_mode`, `side_install`, `install_height` | Montage |
| `background_learning` | Hintergrund-Lernen |

Diese Entitäten werden durch Zigbee2MQTT und dessen MQTT-Discovery bereitgestellt. Die App registriert keine eigenen Home-Assistant-Dienste oder Events. Die Modellkennung `lumi.models.4447_8295` bezeichnet den Gerätetyp, keine individuelle Seriennummer.

## Ohne Home Assistant OS (Docker)

Ohne Supervisor liest die App ihre Einstellungen aus Umgebungsvariablen. Beispiel für `docker-compose.yml` im Repo-Root:

```yaml
services:
  fp400-zones:
    build: ./fp400_zones
    restart: unless-stopped
    ports:
      - "127.0.0.1:8099:8099"
    environment:
      MQTT_URL: mqtt://mqtt.example.invalid:1883
      MQTT_USER: ""
      MQTT_PASSWORD: ""
      BASE_TOPIC: zigbee2mqtt
      AUTO_SETUP: "true"
    volumes:
      - ./data:/app/data
```

Ersetze `mqtt.example.invalid` durch deinen Broker. Starte mit `docker compose up -d --build`; der Editor ist auf dem Docker-Host unter `http://localhost:8099` erreichbar. Ohne Supervisor gibt es keine Anmeldung. Das Beispiel bindet deshalb nur an Loopback; für Fernzugriff einen authentifizierenden Reverse-Proxy verwenden. WebSocket-Clients müssen einen zur Host-Adresse passenden HTTP-Origin senden. Für `mqtts://`/`wss://` muss das Serverzertifikat gültig und vertrauenswürdig sein; eine eigene CA lässt sich im Standalone-Container über `NODE_EXTRA_CA_CERTS` bereitstellen.

Weitere Standalone-Variablen: `MQTT_USER`, `MQTT_PASSWORD`, `BASE_TOPIC` (Standard `zigbee2mqtt`), `AUTO_SETUP` (`true`/`false`), `PORT` (Standard `8099`) und `DATA_DIR` (Standard `/app/data`). Zugangsdaten nicht in Git einchecken. Im Add-on gelten stattdessen die [App-Optionen](fp400_zones/DOCS.md#optionen).

## Fehlersuche

- **„Keine Antwort auf zigbee2mqtt/bridge/info“:** Läuft Zigbee2MQTT, und stimmt `base_topic`?
- **Converter-Schritt bleibt rot:** Die Fehlermeldung steht in der Checkliste. Sie kommt direkt von Zigbee2MQTT, Details im Z2M-Log.
- **„Andere FP400-Converter“:** Ein älterer oder fremder FP400-Converter ist installiert und überschreibt die Erkennung. Klick auf „Entfernen“.
- **Keine Positionen:** Klick auf „Neu konfigurieren“. Hilft das nicht, setz in Z2M beim Gerät die Option `fp400_subscribe: true`.
- **Mehr als 2 Personen werden abgeschnitten:** Das ist ein Problem von Ember-Koordinatoren (Silabs) und tritt mit TI/Z-Stack nicht auf.

## Grenzen / Status

- Experimentell, noch nicht an echter Hardware verifiziert.
- Zonen werden aus den Positionen berechnet (Software-Zonen). Native Sensor-Zonen gibt es nur experimentell.
- Bei Ember/Silabs-Koordinatoren werden Frames mit 3+ Personen abgeschnitten ([Koenkk/zigbee-herdsman#1886](https://github.com/Koenkk/zigbee-herdsman/issues/1886)). TI/Z-Stack ist nicht betroffen.

## Danksagung / Quellen

- [Koenkk/zigbee2mqtt#33146](https://github.com/Koenkk/zigbee2mqtt/issues/33146) – Community-Mitschnitte und Analyse
- [RAR/matterjs-server](https://github.com/RAR/matterjs-server) und [RAR/ha-aqara-fp400](https://github.com/RAR/ha-aqara-fp400) – Matter-Modell derselben Cluster, Raster-Definition

Inoffizielles Projekt, nicht mit Aqara verbunden. Aqara ist eine Marke der Lumi United Technology Co., Ltd.

## Deinstallation

1. Falls gewünscht, Layouts exportieren. Falls native Zonen oder Masken geschrieben wurden, diese **vor dem Stoppen** im Editor löschen: native Zonen → „Alle löschen“; die drei Maskenebenen leeren → „Masken schreiben“. Das Löschen nativer Zonen ist ebenfalls experimentell und muss am Gerät geprüft werden.
2. FP400 Zonen stoppen, damit die automatische Einrichtung nichts erneut installiert. In Zigbee2MQTT ausschließlich `aqara-fp400-zones.mjs` unter externen Convertern entfernen. Alternativ mit Home Assistants Aktion `mqtt.publish` an `<base_topic>/bridge/request/converter/remove` den Payload `{"name":"aqara-fp400-zones.mjs"}` senden; `retain` muss aus sein und die erfolgreiche Z2M-Antwort geprüft werden.
3. Zigbee2MQTT stoppen. In dessen Gerätekonfiguration nur `fp400_layout` und gegebenenfalls `fp400_subscribe` bei den betroffenen Sensoren entfernen. `advanced.enable_external_js` nur auf den vorherigen Wert zurücksetzen, wenn keine anderen Converter/Erweiterungen es benötigen. Z2M wieder starten. Montage, Bindings und Reporting bleiben im Sensor erhalten; für einen vollständigen Geräte-Neuanfang muss der FP400 aus Z2M entfernt und gemäß Herstelleranleitung zurückgesetzt werden. Das ist für einen bloßen Wechsel des Converters nicht erforderlich.
4. FP400 Zonen über **Einstellungen → Apps → FP400 Zonen → Deinstallieren** entfernen, anschließend bei Bedarf das Repository entfernen. Die eigenen App-Daten unter `/data` werden mit dem Add-on entfernt. Bei Docker `docker compose down` ausführen und das selbst angelegte Verzeichnis `./data` gezielt löschen.
5. In **Einstellungen → Geräte & Dienste → MQTT** prüfen, ob alte FP400-Zonenentitäten übrig sind; nur diese entfernen. Falls sie wieder erscheinen, die zugehörigen retained Discovery-Nachrichten des FP400 im Broker prüfen und gezielt löschen, niemals das gesamte Discovery-Topic. Andere MQTT-Geräte behalten.
6. Browser-Entwürfe entfernen: auf der geöffneten HA-/Editor-Origin in den Browser-Entwicklerwerkzeugen unter „Local Storage“ nur Schlüssel mit Präfix `fp400.` löschen. Exporte und alte Backups enthalten weiterhin Layouts und ggf. Zugangsdaten; bei gewünschter vollständiger Löschung diese separat entfernen.

## Datenschutz und Fehlermeldungen

Die App kommuniziert mit dem Supervisor und dem konfigurierten MQTT-Broker. Positionen, Anwesenheit, Gerätekennungen und Zonennamen werden lokal zwischen Sensor, Zigbee2MQTT, Broker und Browser verarbeitet. Bei einem externen Broker verlassen sie entsprechend dein Heimnetz. Es gibt keine eigene Telemetrie und keine Aqara-Cloud-Verbindung. Installation und Updates laden Dateien von GitHub, Container- und npm-Registries.

Layouts und Gerätekennungen liegen in `/data/state.json`, in Zigbee2MQTT und als Entwurf im Browser (`fp400.*`). MQTT-Zugangsdaten stehen gegebenenfalls in den Supervisor-Optionen bzw. der Docker-Konfiguration. Backups können diese Daten enthalten. Der Live-Editor zeigt absichtlich Gerätenamen und Positionen; Screenshots und Layout-Exporte daher vor dem Teilen prüfen.

Die App hat keinen separaten Debug-Schalter. Verwende ihren Reiter **Protokoll** und bei Bedarf vorübergehend Zigbee2MQTTs Option `advanced.log_level: debug`; danach zurücksetzen. App-Logs schwärzen bekannte Zugangsdaten, URLs, IPv4-Adressen und IEEE-Kennungen. Z2M-Debug-Logs können dagegen vollständige MQTT-Nachrichten und private Gerätedaten enthalten. Vor dem Melden von Fehlern Zugangsdaten, Namen, Gerätekennungen und Raumdaten entfernen. Home Assistants `logger`-Konfiguration steuert diesen separaten Node-Prozess nicht.

## Lizenz und Mitwirken

[MIT-Lizenz](LICENSE). Fehler mit App-/Z2M-Version, Koordinator und bereinigten Logs im [Issue-Tracker](https://github.com/GERGto/ha-fp400-zones/issues) melden. Entwicklung und lokale Prüfungen: [CONTRIBUTING.md](CONTRIBUTING.md). Änderungen: [Changelog](fp400_zones/CHANGELOG.md). Der interne Converter hat einen eigenen Versionsstand; App, npm-Paket und Release-Tag verwenden die App-Version. Nicht veröffentlichte Änderungen stehen unter „Unreleased“.

## English

FP400 Zonen is an experimental Home Assistant OS app for Aqara FP400 zones using Zigbee2MQTT and MQTT discovery. Add the repository using the button above, install, start and open the sidebar editor. The app installs an external JavaScript converter, configures the sensor and stores up to eight software zones. No Aqara cloud is used. App option translations are available in English and German; the editor is currently German. Minimum HA/Z2M versions and real hardware operation still require verification. Uninstalling the app alone does not remove its converter, Z2M device options, sensor settings, MQTT discovery records, browser drafts or backups. Follow the removal instructions above. See [MIT license](LICENSE), [contributing](CONTRIBUTING.md) and [issues](https://github.com/GERGto/ha-fp400-zones/issues).
