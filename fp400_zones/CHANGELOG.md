# Changelog

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
