# FP400 Zones

A Home Assistant app for setting up and managing multiple Aqara FP400 sensors in Zigbee2MQTT, without an Aqara hub. English interface, responsive mobile editor, and light/dark themes.

## Features

- Sensor dashboard with presence, illuminance and zone counts.
- Guided mounting selection, interactive height adjustment, empty-room learning and live boundary tracing.
- Per-room editor with up to eight zones, obstacle masks, undo and local drafts.
- Automatic converter installation and sensor configuration through Zigbee2MQTT.
- Live viewing sessions with expiring stream requests; verified sensor zone storage.

## Install

Requires Home Assistant OS/Supervisor on amd64 or aarch64, a configured MQTT broker, and Zigbee2MQTT 2.x with the converter MQTT API and Home Assistant MQTT discovery. FP400 must use Zigbee mode. Exact minimum HA/Z2M versions are not verified; device diagnostics were performed with Z2M 2.14.2.

[Add this repository to Home Assistant](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FGERGto%2Fha-fp400-zones)

Or add `https://github.com/GERGto/ha-fp400-zones` under **Settings > Apps > App store > Repositories**. Install **FP400 Zones**, start it, and open its web UI. The container builds locally during installation. This is an app/add-on, not a HACS integration.

Back up Zigbee2MQTT before the first setup. If required, the app offers to enable external JavaScript converters and restart Zigbee2MQTT. This allows installed converter code to execute inside Zigbee2MQTT.

## First room

Select **Add sensor** on the dashboard, pair the FP400, then open its tile. The wizard guides you through mounting, height, empty-room learning and two manually confirmed walks around the room. Create your first zone in the editor and save it. See the [complete workflow and options](fp400_zones/DOCS.md).

Existing saved zones are retained during upgrade and open directly in the editor. **Run setup** repeats calibration without deleting zones. New rooms begin with an empty zone list.

## Sensor zones and live viewing

From 1.2.0, all zone occupancy is reported by the FP400. Software zone processing has been removed. **Save changes** transfers the complete zone layout and all obstacle masks to the sensor, verifies readback, and only then saves the local/Zigbee2MQTT backup. There is no separate transfer or mode-switch button. A failed write stays unsaved and may have partially changed the sensor; retry by saving the complete layout again.

After upgrading, open each existing room and save once to transfer its layout. Until this succeeds, old software-only zones are not evaluated. Test each zone by walking in and out: native sensor protocol support remains experimental. Names are displayed in Zigbee2MQTT while technical keys such as zone_1 stay stable. Green zone borders reflect native occupancy reports only.

The editor renews a 60-second position subscription while visible. Leaving/hiding it stops renewal; disconnected viewer leases expire within 45 seconds. Stored zones never request a continuous stream. Dashboard signal bars show reported Zigbee LQI (0-255), not a percentage or guaranteed online status.

Room tracing estimates the outer envelope of your walk; it is not a measurement of actual walls or recesses. The sensor grid remains 16 by 20 cells of 50 cm. The viewport fits the estimated room.

## Standalone

Node 22 is recommended. From `fp400_zones/app`, install production dependencies with `npm ci --omit=dev`, set `MQTT_URL`, optionally `MQTT_USER` and `MQTT_PASSWORD`, and run `npm start`. Other variables: `BASE_TOPIC` (zigbee2mqtt), `AUTO_SETUP` (true), `PORT` (8099), `DATA_DIR` (app/data). Environment files are not automatically loaded.

Alternatively build `fp400_zones/Dockerfile`, mount persistent storage at `/app/data`, pass the variables above, and bind port 8099 to loopback. Standalone mode has no login: use an authenticated reverse proxy for remote access. WebSockets require a matching Origin. MQTT TLS certificates are verified; a private CA can be supplied with `NODE_EXTRA_CA_CERTS`.

## Data and removal

There is no app telemetry or cloud service. Device identifiers, layout backups and profiles are stored in `/data/state.json`, zone options in Zigbee2MQTT, and drafts/theme/debug preferences in browser storage (`fp400.v2.*`). A remotely configured broker receives sensor data. Exports and backups can contain private room information and credentials.

Before uninstalling, clear unwanted obstacle masks using the editor and remove unwanted native zones in Zigbee2MQTT (`native_zones: clear`, experimental). Stop the app, remove `aqara-fp400-zones.mjs` from Zigbee2MQTT external converters, and remove the `fp400_layout`, `fp400_zone_mode` and `fp400_subscribe` device options. Uninstall the app. Review remaining MQTT discovery entities, browser storage, exports and backups. Sensor mounting and bindings are not automatically reset. Removing the converter can change entity availability.

## Development and support

See [CONTRIBUTING.md](CONTRIBUTING.md), [release notes](fp400_zones/CHANGELOG.md), and [release verification](RELEASE_REVIEW.md). Report issues at the [issue tracker](https://github.com/GERGto/ha-fp400-zones/issues). Protocol support remains experimental and derives from community investigation; it is not an official Aqara integration.

License: [MIT](LICENSE).
