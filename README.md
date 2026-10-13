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

- Home Assistant OS oder Supervised
- Zigbee2MQTT ≥ 2.0
- Mosquitto-Broker-App
- FP400 im Zigbee-Modus

## Installation

[![Repository hinzufügen](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FGERGto%2Fha-fp400-zones)

Manuell: **Einstellungen → Apps → App-Store → ⋮ → Repositories** → `https://github.com/GERGto/ha-fp400-zones` einfügen → **FP400 Zonen** installieren → starten → **Zur Seitenleiste hinzufügen**.

> Der erste Start baut das Image lokal und dauert ein paar Minuten.

## Einrichtung in 3 Schritten

1. **App öffnen** und die Checkliste links abarbeiten. „Externe Converter erlauben“ ist ein Klick mit Bestätigung und startet Z2M einmal neu (seit Z2M 2.11 bei Neuinstallationen standardmäßig aus).
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

## Ohne Home Assistant OS (Docker)

Ohne Supervisor liest die App ihre Einstellungen aus Umgebungsvariablen. Beispiel für `docker-compose.yml` im Repo-Root:

```yaml
services:
  fp400-zones:
    build: ./fp400_zones
    restart: unless-stopped
    ports:
      - "8099:8099"
    environment:
      MQTT_URL: mqtt://192.168.1.10:1883
      MQTT_USER: ""
      MQTT_PASSWORD: ""
      BASE_TOPIC: zigbee2mqtt
      AUTO_SETUP: "true"
    volumes:
      - ./data:/app/data
```

Danach ist der Editor unter `http://<host>:8099` erreichbar. Ohne Supervisor gibt es keine Ingress-Authentifizierung – den Port nur im eigenen Netz freigeben.

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

## English

FP400 Zonen is a Home Assistant app that adds zones for the Aqara FP400 presence sensor (`lumi.models.4447_8295`) in Zigbee2MQTT, without an Aqara hub or cloud. It installs and updates the required external converter through the Zigbee2MQTT MQTT API, configures the sensor, and provides a zone editor in the Home Assistant sidebar with live positions on a 16 × 20 grid. Up to 8 zones show up as binary sensors `zone_1` … `zone_8`. Install it with the "Add repository" button above (requires Home Assistant OS or Supervised, Zigbee2MQTT ≥ 2.0 and the Mosquitto broker app). The app is experimental and not yet verified on real hardware. Full documentation (German): [fp400_zones/DOCS.md](fp400_zones/DOCS.md).
