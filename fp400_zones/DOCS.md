# FP400 Zones

Manage your FP400 sensors from one dashboard. Each tile shows presence, zone count and illuminance. Tap a tile to open its room. The interface adapts to phones and supports touch drawing.

## Setup

1. Start the app and open its web UI. Connection problems appear as an actionable banner. MQTT credentials are obtained from the Supervisor when using its MQTT service.
2. Choose **Add sensor**, open pairing and pair the powered FP400 in Zigbee mode. Pairing closes after about four minutes, or manually with **Close pairing**. Existing sensors remain connected.
3. Open the new sensor tile. Choose wall or ceiling mounting, wall/corner position where applicable, and a room name.
4. Adjust mounting height with the slider or numeric input. The illustration follows the selected height. Continue waits for sensor state confirmation.
5. Remove people and pets. **Start exit countdown** gives you 10 seconds to leave. Empty-room learning then starts. Allow up to two minutes; the display shows elapsed time and progress against that waiting window. This is not a guaranteed sensor duration. Completion requires a fresh sensor result; a timeout is an error, never success.
6. Enter alone and walk the room boundary twice. Live points form an approximate outer envelope. Confirm the first lap and then both laps manually. You can restart tracing. This estimates the walked area, not actual walls or recesses.
7. Create your first zone. New rooms have no pre-created zones. Name the zone, select Draw or Rectangle, and drag on the grid. Use Erase or Undo to correct it, then **Save changes**.

The physical grid stays at 50 cm per cell; the view fits the estimated room. Mirror view changes only the display orientation. **Run setup** repeats the wizard later while preserving zones. Existing installations with saved zones bypass automatic onboarding.

## Zones and obstacles

Create up to eight zones. Zone IDs stay stable when another zone is deleted. Hold time delays software-zone clearing to reduce boundary flicker. Unsaved drafts are stored separately per sensor in this browser. Saving writes the layout to Zigbee2MQTT and keeps a backup in app storage; Export downloads JSON.

Choose Exclusion, Interference or Entry / exit under **Room obstacles**, draw on the map, and explicitly apply the masks to the sensor. Clear selected area removes its draft mask; apply it to write the empty mask. These masks are separate from zone occupancy.

Zigbee2MQTT MQTT discovery provides `presence`, `illuminance`, `target_count` and `zone_1` through `zone_8`. Empty/unconfigured zone entities may still exist in Home Assistant because converter capabilities are fixed. The app creates no separate HA services or events.

## Live viewing and native zones

Software processing is the default: active software zones require a continuous position stream. Closing the editor cannot stop that stream without breaking those zones.

**Transfer zones to sensor** writes the saved layout and compares readback. **Use verified sensor zones** is available only after successful verification of that layout. Native mode is experimental: walk into and out of every zone and check actual occupancy before relying on it. Software hold delays are not applied to native reports. Use **Use software zones** if native reporting fails.

When native processing is active, or no software zones exist, the app renews a short position subscription only while the editor or boundary tracing view is visible. Hiding/leaving the page stops renewal; the last request expires within 60 seconds. A disconnected browser's lease expires within 45 seconds. Multiple viewers are independent. Saving an edited layout activates software processing until native zones are transferred and verified again. Leave Zigbee2MQTT's legacy `fp400_subscribe` option disabled when this app manages streams.

## Appearance and diagnostics

**Settings > Appearance** offers Home Assistant / system, Light and Dark. Automatic follows the parent Home Assistant theme when accessible; otherwise it uses the device preference. The explicit theme choice applies across sensors.

Logs are hidden by default. Enable **Show technical details and logs** in Settings when troubleshooting. Home Assistant's app Log tab includes operation names, durations and failures. Credentials and device addresses are redacted, but inspect diagnostics before sharing them.

If positions stop, check the app connection and Zigbee2MQTT logs, then reconfigure the sensor in Settings diagnostics. If converter activation is pending, restart Zigbee2MQTT. If room learning times out, ensure the room is empty and inspect Zigbee2MQTT command failures before retrying. Do not repeat pairing merely because a position is stale.

## Configuration

| Option | Purpose |
| --- | --- |
| `base_topic` | Zigbee2MQTT base topic, default `zigbee2mqtt` |
| `auto_setup` | Automatically install/update the converter and configure sensors; default true |
| `mqtt_url` | Optional broker override, for example `mqtt://mqtt.example.invalid:1883` |
| `mqtt_user`, `mqtt_password` | Optional credentials for the overridden broker |

An explicit MQTT URL takes priority over Supervisor discovery. TLS certificates must be trusted. Automatic setup installs code in Zigbee2MQTT; mounting, learning and mask commands affect the sensor. These changes survive uninstalling the app. Back up Zigbee2MQTT first.

Layouts, profiles and device identifiers are stored locally and in Zigbee2MQTT; browser drafts use local storage. There is no app telemetry. See the [repository documentation](https://github.com/GERGto/ha-fp400-zones#data-and-removal) for standalone deployment, privacy and full removal instructions.
