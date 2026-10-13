# FP400 Zonen

Zonen für den Aqara FP400 (Spatial Multi-Sensor) in Zigbee2MQTT. Du brauchst keinen Aqara-Hub und keine Cloud.

## Voraussetzungen

- Home Assistant OS mit Supervisor auf `amd64` oder `aarch64`. Die minimale HA-/Z2M-Version ist noch nicht durch einen Hardwaretest belegt.
- Zigbee2MQTT 2.x mit MQTT-Converter-API und Home-Assistant-MQTT-Discovery, mit dem FP400 bereits angelernt (das Anlernen geht notfalls auch aus der App heraus)
- Mosquitto-Broker-App (früher Add-on). Die Zugangsdaten holt sich die App automatisch.

## Einrichtung

1. App starten und **Zur Seitenleiste hinzufügen** aktivieren.
2. In der Seitenleiste **FP400 Zonen** öffnen. Links steht die Checkliste für die Einrichtung:
   - **Externe Converter erlauben:** Neuere Z2M-Installationen haben das standardmäßig ausgeschaltet. Ein Klick schaltet es ein und startet Z2M einmal neu.
   - **FP400-Converter:** Die App installiert den Converter automatisch über Zigbee2MQTT und hält ihn bei App-Updates aktuell.
   - **Sensor:** Die App konfiguriert den Sensor automatisch. Danach einmal durch den Raum laufen. Der Punkt wird grün, sobald Positionen ankommen.
3. Zonen malen, benennen und auf **Layout speichern** klicken. Fertig.

In Home Assistant erscheinen beim Sensor die Entitäten `zone_1` … `zone_8` (belegt/frei), `presence`, `target_count` und `illuminance`.

## Bedienung

- **Malen:** Zone oben auswählen und Zellen anklicken oder ziehen. Rechtsklick radiert.
- **Tasten:** `B` Pinsel, `R` Rechteck, `E` Radierer, `1`–`8` Zone wählen, `Strg+Z` rückgängig.
- **Verzögerung (Sekunden):** So lange bleibt eine Zone nach dem Verlassen noch „belegt“. Das gleicht Radar-Zittern an den Rändern aus.
- **Ausschluss / Störquelle / Ein-Ausgang:** Bereichsmasken, die direkt auf den Sensor geschrieben werden (Knopf „Masken schreiben“). Ausschluss blendet z. B. den Flur hinter einer offenen Tür aus.
- **Montage:** Wand oder Decke, gerade Wand oder Ecke, Höhe. Nach dem Ändern lohnt sich „Hintergrund lernen“; der Raum muss dabei leer sein.
- **Orientierung:** Geh an die linke Wand. Erscheint dein Punkt rechts, setz den Haken bei „horizontal spiegeln“. Das ändert nur die Anzeige, die Zonen bleiben richtig.

Das Layout wird in der Z2M-`configuration.yaml` gespeichert, als Geräteoption `fp400_layout`. Zusätzlich legt die App eine Sicherung an, die in Home-Assistant-Backups enthalten ist.

## Optionen

| Option | Bedeutung |
|---|---|
| `base_topic` | Basis-Topic von Zigbee2MQTT, Standard `zigbee2mqtt` |
| `auto_setup` | Standard `true`: Converter automatisch installieren und Sensor konfigurieren. Ist die Option aus, bleiben die Knöpfe in der Checkliste trotzdem nutzbar. |
| `mqtt_url`, `mqtt_user`, `mqtt_password` | Nur nötig ohne die Mosquitto-App, z. B. `mqtt://mqtt.example.invalid:1883` |

Die drei optionalen MQTT-Werte haben keinen vorbelegten Zugang. Ersetze den Beispielhost durch deinen Broker. Ein gesetztes `mqtt_url` hat Vorrang vor den automatisch ermittelten Supervisor-Zugangsdaten. TLS (`mqtts://`) prüft das Serverzertifikat; ungültige oder nicht vertrauenswürdige Zertifikate werden abgewiesen. Die App fordert weiterhin den MQTT-Dienst des Supervisors an (`mqtt:need`).

Die App schreibt auf ausdrücklichen Klick Sensor-Masken und Montageparameter. Automatische Einrichtung installiert Code in Zigbee2MQTT und kann den Sensor konfigurieren. Diese Änderungen überleben die Deinstallation der App. Vor der Ersteinrichtung die Z2M-Konfiguration sichern.

## Fehlersuche

- **„Keine Antwort auf zigbee2mqtt/bridge/info“:** Läuft Zigbee2MQTT, und stimmt `base_topic`?
- **Converter-Schritt bleibt rot:** Die Fehlermeldung steht in der Checkliste. Sie kommt direkt von Zigbee2MQTT, Details im Z2M-Log.
- **„Andere FP400-Converter“:** Ein älterer oder fremder FP400-Converter ist installiert und überschreibt die Erkennung. Klick auf „Entfernen“.
- **Keine Positionen:** Klick auf „Neu konfigurieren“. Hilft das nicht, setz in Z2M beim Gerät die Option `fp400_subscribe: true`.
- **Mehr als 2 Personen werden abgeschnitten:** Das ist ein Problem von Ember-Koordinatoren (Silabs) und tritt mit TI/Z-Stack nicht auf.

## Grenzen

- Die Zonen werden aus den Positionen berechnet, die der Sensor liefert (Software-Zonen). Die nativen Zonen im Sensor lassen sich unter „Experimentell“ schreiben. Dieses Protokoll ist aber noch nicht bestätigt.
- Das Protokoll stammt aus Community-Mitschnitten (Koenkk/zigbee2mqtt#33146) und dem Matter-Modell derselben Cluster. Es ist keine offizielle Aqara-Dokumentation.

## Datenschutz, Protokolle und Deinstallation

Layouts/Gerätekennungen liegen in `/data/state.json`, Zigbee2MQTT und im lokalen Browser-Speicher (`fp400.*`). Es gibt keine eigene Telemetrie. Ein außerhalb des Heimnetzes konfigurierter MQTT-Broker empfängt die Daten entsprechend extern. Backups und Exporte können Raumdaten und Zugangsdaten enthalten.

Die App-Protokolle sind im Reiter „Protokoll“ sichtbar. Einen eigenen Debug-Schalter gibt es nicht. Für Zigbee2MQTT bei Bedarf vorübergehend `advanced.log_level: debug` verwenden und danach zurücksetzen; vor dem Teilen private Inhalte entfernen.

Zum Entfernen zuerst gewünschte Sensor-Masken/native Zonen zurücksetzen, dann die App stoppen, ihren Converter und ihre Geräteoptionen in Zigbee2MQTT entfernen und die App deinstallieren. Anschließend verbliebene FP400-Discovery-Entitäten, Browser-Entwürfe, Exporte und Backups prüfen. Montage und Bindings im Sensor werden nicht automatisch zurückgesetzt. Die vollständige Schrittfolge steht im [Repository-README](https://github.com/GERGto/ha-fp400-zones#deinstallation).

Keine eigenen HA-Dienste oder Events; Entitäten werden von Zigbee2MQTT per MQTT-Discovery bereitgestellt. Lizenz: [MIT](https://github.com/GERGto/ha-fp400-zones/blob/main/LICENSE). Unterstützung: [Issue-Tracker](https://github.com/GERGto/ha-fp400-zones/issues).
