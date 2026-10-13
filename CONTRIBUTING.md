# Contributing

Use Node 22. From `fp400_zones/app`:

```sh
npm ci --ignore-scripts
npm run check
npx playwright install chromium
npx playwright test
```

Browser tests use a simulated WebSocket backend and separate temporary data; they never connect to a real sensor. Protocol tests stub Zigbee2MQTT's builders and do not replace testing real firmware. Run hardware tests deliberately and record firmware/coordinator versions without publishing identifiers or credentials.

Keep UI strings and documentation in English. Check desktop and narrow mobile layouts, touch controls, light/dark themes, per-device state isolation and reconnect behavior. Do not commit `.env`, data directories, screenshots containing personal room information, or raw MQTT captures.

CI runs JavaScript checks, browser flows, add-on metadata lint and container builds for amd64/aarch64. Changes to protocol behavior must document limitations and document migration from older layouts.
