# Release verification: 1.1.0

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
