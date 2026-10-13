# FP400 Zones

Manage your FP400 sensors from one dashboard. Each tile shows presence, zone count and illuminance. Tap a tile to open its room. The interface adapts to phones and supports touch drawing.

## Setup

1. Start the app and open its web UI. Connection problems appear as an actionable banner. MQTT credentials are obtained from the Supervisor when using its MQTT service.
2. Choose **Add sensor**, open pairing and pair the powered FP400 in Zigbee mode. Pairing closes automatically when a newly added FP400 completes its interview, after about four minutes, or manually with **Close pairing**. Existing sensors remain connected.
3. Open the new sensor tile. Choose wall or ceiling mounting, wall/corner position where applicable, and a room name. The name is also applied to Zigbee2MQTT after its confirmation; this changes the device MQTT topic. Existing Home Assistant entity IDs are not explicitly renamed. To synchronize a name entered in an older app version, use Rename and confirm the desired name again.
4. Adjust mounting height with the slider or numeric input. The illustration follows the selected height. Continue waits for sensor state confirmation.
5. Remove people and pets. **Start exit countdown** gives you 10 seconds to leave. Empty-room learning then starts. Allow up to two minutes; the display shows elapsed time and progress against that waiting window. This is not a guaranteed sensor duration. Completion requires a fresh sensor result; a timeout is an error, never success.
6. Enter alone and walk the room boundary twice. Live points form an approximate outer envelope. Confirm the first lap and then both laps manually. You can restart tracing. This estimates the walked area, not actual walls or recesses.
7. Create your first zone. New rooms have no pre-created zones. Name the zone, select Draw or Rectangle, and drag on the grid. Use Erase or Undo to correct it, then **Save changes**.

The physical grid stays at 50 cm per cell; the view fits the estimated room. Mirror view changes only the display orientation. **Run setup** repeats the wizard later while preserving zones. Existing installations with saved zones bypass automatic onboarding.

## Zones and obstacles

Use the **Zones** and **Obstacles** tabs in the same room editor. Create up to eight named zones; their numeric IDs remain stable after deletion or renaming. The green outline means the sensor reports that zone occupied. It never comes from calculating a person's position inside the drawn shape.

Under Obstacles, choose Exclusion (ignored space), Interference (moving objects), or Entry / exit (doorways). Draw the area on the same map using Draw, Rectangle and Erase. Clear selected area empties that mask in the draft. The map's area selector lets phone users switch areas without scrolling back to the list.

**Save changes** transfers all zones AND all obstacle masks to the sensor. It replaces the sensor's zone layout and waits for matching readback before reporting success. Do not close the page while saving. If saving fails, the draft remains unsaved; the sensor may be partly changed. Retry by saving the complete layout again. Export downloads the draft JSON.

Zigbee2MQTT shows saved zone names as labels while preserving zone_1 through zone_8 MQTT keys. The app requests an expose refresh after a saved layout changes. Reload the Zigbee2MQTT device page if it remains open with old labels. Home Assistant names manually overridden by the user are not renamed by this app.

## Upgrading and live viewing

Software zones have been removed in 1.2.0. Existing layouts remain available, but each room must be saved once to transfer its zones to the sensor. Old software-only zones will not continue to calculate occupancy. Native protocol support remains experimental: verify actual entry and exit reports after saving.

Position streams are only renewed while viewing a room or tracing its boundary. They are not needed for stored sensor zones. Leaving or hiding the page stops renewal; the sensor's last request expires within 60 seconds. A disconnected browser's viewer lease expires within 45 seconds. Multiple viewers are independent. Legacy continuous-stream settings are ignored by the new converter.

Dashboard signal bars use the last reported Zigbee2MQTT linkquality value. Focus or hover the icon to read the exact LQI (0-255). Unknown quality shows a question mark. LQI is not a percentage or a guarantee that a sensor is currently online.

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
