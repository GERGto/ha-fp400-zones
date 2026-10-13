import {defineConfig, devices} from '@playwright/test';
export default defineConfig({
    testDir: './e2e', timeout: 30000, fullyParallel: false,
    use: {baseURL: 'http://127.0.0.1:18099', trace: 'retain-on-failure'},
    projects: [{name: 'desktop', use: {viewport: {width: 1440, height: 1000}}},
        {name: 'mobile', use: {...devices['Pixel 7']}},
        {name: 'narrow-mobile', use: {...devices['Pixel 7'], viewport: {width: 360, height: 740}}}],
    webServer: {command: 'node server.mjs', url: 'http://127.0.0.1:18099/health', reuseExistingServer: false,
        env: {PORT: '18099', AUTO_SETUP: 'false', MQTT_URL: 'mqtt://127.0.0.1:1', SUPERVISOR_TOKEN: '', DATA_DIR: 'data/browser-test'}},
});
