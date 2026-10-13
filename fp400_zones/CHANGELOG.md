# Changelog

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
