# Changelog

## Unreleased

- **Saving two or more zones no longer fails.** With two or more zones the FP400 sends its zone table APS-fragmented, and Zigbee2MQTT's ember adapter only receives the first 80-byte fragment, so the readback always failed with "offset is out of range" although the zones were stored and reported occupancy. Every zone command now waits for the sensor's own response (status byte, 0 = success). When the table cannot be read, a save counts as verified only if every remove and add command was confirmed; when it can be read (0 or 1 zone, or adapters that reassemble fragments), it is still compared exactly.
- Device reconfiguration no longer resets an existing mounting setup. A ceiling-mounted sensor reported mounting mode 0 during reconfiguration, and the converter then wrote wall mounting, which also cleared the height. Default mounting is now only written to a sensor without a stored mounting height.
- New converter key `mounting` ({request, mode, side, height}) writes and reads back the mounting type, wall position and height and answers with the request ID, so a caller can confirm exactly its own write.
- Converter version 1.3.5. Zigbee2MQTT reconfigures the sensor once after the update; existing mounting settings are kept.
- Diagnostics and the startup log report the actual app version instead of a hard-coded 1.2.2.
- Removed the unused raw `set`/`get` WebSocket actions, which allowed arbitrary MQTT payloads to be published to a sensor.
- Web UI responses send `X-Content-Type-Options`, `Referrer-Policy` and a Content Security Policy.
- New zones default to a 0-second delay, matching the value written to the sensor on save. Removed unused delay handling.
- New **Erase rectangle** tool clears a rectangular part of the selected zone or obstacle area in one drag, with a red live outline.
- Rectangle tool shows a live outline while dragging and commits the area as a single change instead of one draft write per cell.
- The fitted room view always includes every drawn zone and obstacle, so saved areas outside an older or incomplete room outline are no longer cut off. The view toggle is labelled **Show full grid** / **Fit room** according to what it does.
- After an app update, open pages and the Home Assistant companion app no longer keep running cached old scripts. Script and style URLs carry a content hash, the start page is never cached, and an open page reloads itself when the server reports a newer build (with unsaved zone edits it asks you to save or export first). Settings > Diagnostics shows the build.

## 1.2.5

- Saving a room now sets both global presence and every transferred zone's absence confirmation time to 0 seconds. The global timeout was observed to delay zone clearing even with per-zone timeouts set to zero.
- Global and zone settings are read back individually; rejected writes or missing/mismatched confirmation fail the save.
- Converter version 1.3.4. After upgrading, start the app and save each existing room once. The polling fallback for zones without reporting remains unchanged.

## 1.2.4

- Every zone transferred to the sensor now receives a 0-second absence confirmation time automatically, including when an existing layout is saved again.
- Each setting is read back from its zone endpoint. A rejected write or missing/mismatched confirmation fails the save instead of reporting success.
- Global room presence and the 10-second polling fallback remain unchanged.
- Converter version 1.3.3. After upgrading, start the app and save each existing room once to apply the setting.

## 1.2.3

- Handle the FP400's limited reporting table without aborting setup of later zones.
- Read enabled, saved sensor zones without occupancy reporting every 10 seconds. These remain native sensor states; no software zones or continuous position stream are used.
- Back off failed reads to 60 seconds and stop polling when the converter stops.
- Converter version 1.3.2. Restart Zigbee2MQTT after updating to activate the polling lifecycle.
- Sensor absence confirmation and occasional residual radar targets are unchanged; this update does not claim to fix them.

## 1.2.2

- Fixed native Zigbee zone command encoding: enum8 zone type, no outer struct tag, and one-byte removal IDs.
- Exact byte-level regression tests cover a nonempty zone transfer and wrapped ZCL readback.
- Readback failures now include requested/received zone counts. Verification remains strict.
- Converter 1.3.1.

## 1.2.1

- Official Add to Home Assistant repository button in the README.

- Renaming a sensor in setup or the room editor now renames its Zigbee2MQTT friendly name after confirmation, and switches the app MQTT subscription. HA entity IDs are not explicitly renamed.
- Joining closes automatically after a newly paired FP400 completes its interview. Known sensors and incomplete interviews do not close pairing. Failed closure is retried while the pairing window remains active.

## 1.2.0

- Sensor-reported occupied zones are outlined in green.
- Unified Zones / Obstacles tabs with shared drawing tools and a single save action.
- Zigbee2MQTT zone labels use saved names without changing MQTT property IDs.
- Dashboard signal-quality icons replace Ready; updated introductory text.

- Save now transfers all zones and obstacle masks to the FP400 and waits for correlated readback confirmation.
- Removed software zone processing and mode selection. Occupancy always comes from sensor endpoints.
- Live position streams are only renewed while viewing a room, never for saved zones.
- Existing layouts remain available; save once to transfer them. Failed or timed-out writes remain unsaved and can be retried.
- Converter 1.3.0. Sensor zone protocol remains experimental.

## 1.1.0

- New responsive, English interface with a multi-sensor dashboard and dedicated room pages.
- Guided mounting selection, interactive height adjustment, a ten-second exit countdown and sensor-confirmed background learning.
- Two manually confirmed boundary walks with a live estimated outline and automatic room view fitting. Sensor resolution remains 50 cm.
- Empty zone lists, stable zone IDs, touch drawing, rectangle and erase tools, per-sensor drafts and obstacle controls.
- Central light/dark/automatic theme and opt-in diagnostics. More detailed, redacted app operation logs.
- Automatic short position-stream leases while a room is viewed. Software zones retain their required stream; native sensor mode does not.
- Experimental native zone transfer with stricter readback verification and explicit mode selection. Test real occupancy after switching.
- Converter 1.2.0 supports bounded stream durations and native occupancy routing.
- MQTT TLS verification, WebSocket validation, diagnostic redaction and dependency security fixes from the release review.
- Browser tests for desktop and mobile workflows, plus backend, protocol and lifecycle regression tests.

## 1.0.0

- Initial Home Assistant app with a Zigbee2MQTT converter and zone editor.
- MQTT service discovery, ingress and automatic converter installation.
