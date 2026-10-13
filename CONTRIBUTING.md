# Contributing

Use Node.js 22.13 or newer in the Node 22 line (the container and CI use Node 22).

```sh
cd fp400_zones/app
npm ci --ignore-scripts
npm run check
npm audit --omit=dev --audit-level=moderate
```

ESLint checks backend, converter, tests and the inline browser script. Node's test runner checks request validation, log redaction, HTTP/WebSocket startup and shutdown, ingress isolation, oversized messages and protocol helpers. Protocol tests stub Zigbee2MQTT's builder API; they do not verify real Z2M API compatibility or radio traffic.

GitHub Actions also runs the Home Assistant app linter and builds the image for `linux/amd64` and `linux/arm64`, without pushing images. HACS and hassfest are for other repository types and are intentionally not used here. The Docker base image follows `node:22-alpine`; npm dependencies are locked, but the complete image is not bit-for-bit reproducible while that base tag moves.

Before releasing, test on a disposable Home Assistant OS installation with a real FP400:

1. Record HA Core, Supervisor, Zigbee2MQTT, sensor firmware and coordinator versions.
2. Install through the repository, obtain MQTT credentials, open ingress and confirm converter installation and sensor setup.
3. Verify all eight zones, hold delays, reconnects and layout persistence across app/Z2M restarts, plus operation with two sensors.
4. Test MQTT TLS with a valid and an untrusted certificate. The latter must fail.
5. Follow every uninstall step in README; inspect Z2M options, converter files, discovery entities, sensor settings and browser storage.
6. Run CI successfully for both architectures and establish the actual minimum supported versions. Only then update the app version in `config.yaml`, `package.json`, `package-lock.json`, and the changelog. The converter version is independent and should be updated when releasing converter changes.

Do not submit real MQTT credentials, device addresses, layouts, backups or unredacted logs. Report security issues privately to the repository owner where possible. Keep changes focused and include a regression test for behavior fixes. Creating tags, publishing releases or rewriting history requires the owner's explicit approval.
