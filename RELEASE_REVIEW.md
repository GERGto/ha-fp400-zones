# Release verification: 1.2.2

Read-only MQTT diagnostics confirmed the installed converter matched the released file and the sensor returned an empty native zone table after the failed write. The application had added an outer STRUCT tag and used UINT8 for zone type. The documented Zigbee payload uses struct members directly, ENUM8 for zone type, and a single plain byte for removal. See https://github.com/Koenkk/zigbee2mqtt/issues/33146 (device discussion; native zone command findings).

The corrected encoder is covered by exact byte-level tests plus nonempty wrapped-ZCL readback and mismatch cases. All 23 Node tests pass locally. No diagnostic zone writes were made on the user device; successful physical transfer with this fix still needs confirmation after updating. Raw local captures remain ignored.

# Release verification: 1.2.1

Renaming now waits for Zigbee2MQTT acknowledgment and updates MQTT subscriptions. Joining closes after a new FP400 completes its interview. Broker regression tests verify successful/rejected renames, name validation, topic switching, incomplete interviews and automatic join closure. Desktop and mobile UI tests remain in CI. The README uses the official Home Assistant repository badge.

# Release verification: 1.2.0

Sensor-only zone storage replaces software evaluation. Saving waits for a unique correlated converter result, verifies zone and mask readback, and only then updates backups. Failure does not report success. Device-specific expose labels refresh on layout changes. Position leases are viewer-only. Green highlighting reads native occupancy reports.

Validation includes 21 Node tests and nine Chromium scenarios across desktop and two mobile widths. Tests use simulated sensor/MQTT data; physical firmware behavior remains experimental. Existing rooms require one save after upgrading. See the Checks workflow for both architecture builds and metadata lint.

The preceding review below records version 1.1.0 and its historical behavior. Software-zone behavior described below no longer applies.

﻿# Release verification: 1.1.0

This release remains experimental. It adds a responsive multi-sensor workflow to the existing Home Assistant app; converter version is 1.2.0.

## Local validation

- ESLint and 20 Node tests pass, including MQTT request correlation, failed-save persistence, ingress/WebSocket rejection, malformed layouts, software-zone timing, bounded subscriptions and native occupancy routing.
- Six Chromium browser scenarios pass across desktop, Pixel 7 and 360-pixel mobile viewports. They cover empty-zone creation, mouse/touch drawing, saving, device isolation, guided mounting, learning status, manual two-lap completion, theme switching and hidden diagnostics.
- Desktop and mobile screenshots were inspected. No horizontal overflow was detected in tested editor sizes.
- Production dependency audit reports zero known vulnerabilities at release preparation.
- CI additionally validates add-on metadata and builds Linux amd64/arm64 containers. See the [Checks workflow](https://github.com/GERGto/ha-fp400-zones/actions/workflows/checks.yaml) for the exact release commit results.

Browser/MQTT tests use synthetic devices. They do not prove real sensor firmware behavior or full Supervisor integration. Earlier live diagnostics confirmed position subscriptions and the owner confirmed a working saved zone; the new full onboarding sequence has not been exercised against that physical installation.

## Behavior and limits

- Empty-room learning has a ten-second exit countdown and a two-minute confirmation window. It completes only after a fresh running/success sequence; the firmware's exact learning duration is not claimed.
- Boundary tracing computes the outer envelope of the walk. It does not discover physical walls or change the fixed 50 cm hardware grid.
- Software zones require live positions continuously. Native mode is experimental and requires exact current-layout readback. Verify real occupancy for each zone; readback alone is not an end-to-end reporting test. Saving a layout switches back to software mode.
- Theme detection uses Home Assistant when accessible and otherwise the system setting. Explicit light/dark is available.
- Browser stream leases expire after disconnect; sensor requests expire rather than using an undocumented stop command.

## Security and data handling

The preceding security review restored MQTT TLS verification, added WebSocket request/origin validation, escaped displayed values, rejected malformed converter layouts, updated dependencies and redacted credentials and addresses from app diagnostics. Those checks remain in this release.

Private environment files, MQTT diagnostic captures, browser test data and build output are excluded from Git. The public author name and GitHub noreply commit address are retained as requested. No history rewrite was performed. Existing original example addresses remain in history.

The app still intentionally displays room names and sensor state to an authenticated ingress user. Layout exports, Zigbee2MQTT logs/configuration and backups may contain private data. Standalone deployments have no built-in login and need an authenticated proxy for remote access. See README for storage and removal details.
