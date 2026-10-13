# FP400 Zonen

Zonen für den Aqara FP400 (Spatial Multi-Sensor) in Zigbee2MQTT. Du brauchst keinen Aqara-Hub und keine Cloud.

## Voraussetzungen

- Zigbee2MQTT ab Version 2.0, mit dem FP400 bereits angelernt (das Anlernen geht notfalls auch aus der App heraus)
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
| `auto_setup` | Converter automatisch installieren und Sensor konfigurieren. Ist die Option aus, bleiben die Knöpfe in der Checkliste trotzdem nutzbar. |
| `mqtt_url`, `mqtt_user`, `mqtt_password` | Nur nötig ohne die Mosquitto-App, z. B. `mqtt://192.168.1.10:1883` |

## Fehlersuche

- **„Keine Antwort auf zigbee2mqtt/bridge/info“:** Läuft Zigbee2MQTT, und stimmt `base_topic`?
- **Converter-Schritt bleibt rot:** Die Fehlermeldung steht in der Checkliste. Sie kommt direkt von Zigbee2MQTT, Details im Z2M-Log.
- **„Andere FP400-Converter“:** Ein älterer oder fremder FP400-Converter ist installiert und überschreibt die Erkennung. Klick auf „Entfernen“.
- **Keine Positionen:** Klick auf „Neu konfigurieren“. Hilft das nicht, setz in Z2M beim Gerät die Option `fp400_subscribe: true`.
- **Mehr als 2 Personen werden abgeschnitten:** Das ist ein Problem von Ember-Koordinatoren (Silabs) und tritt mit TI/Z-Stack nicht auf.

## Grenzen

- Die Zonen werden aus den Positionen berechnet, die der Sensor liefert (Software-Zonen). Die nativen Zonen im Sensor lassen sich unter „Experimentell“ schreiben. Dieses Protokoll ist aber noch nicht bestätigt.
- Das Protokoll stammt aus Community-Mitschnitten (Koenkk/zigbee2mqtt#33146) und dem Matter-Modell derselben Cluster. Es ist keine offizielle Aqara-Dokumentation.
