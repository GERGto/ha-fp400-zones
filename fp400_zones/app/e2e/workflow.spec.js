import {test, expect} from '@playwright/test';

async function mock(page) {
    const snapshot = {type: 'snapshot', version: '1.2.0', converterVersion: '1.3.0', settings: {theme: 'auto'}, steps: [], log: ['Example diagnostic message'], devices: [
        {ieee: 'sensor-a', name: 'Living room', ready: true, configured: true, profile: {completedAt: 1}, state: {presence: true, illuminance: 24}},
        {ieee: 'sensor-b', name: 'Office', ready: true, configured: true, profile: {}, state: {}},
    ]};
    let socket;
    const requests = [];
    await page.routeWebSocket('**/ws', (ws) => {
        socket = ws; ws.send(JSON.stringify(snapshot));
        ws.onMessage((raw) => {
            const req = JSON.parse(raw); requests.push(req);
            const d = snapshot.devices.find((d) => d.ieee === req.ieee);
            let data = null;
            if (req.op === 'settings') snapshot.settings.theme = req.theme;
            if (req.op === 'profile') { d.profile = {...d.profile, ...req, ...(req.complete ? {completedAt: 1} : {})}; data = d.profile; }
            if (req.op === 'saveLayout') d.layout = req.layout;
            if (req.op === 'learn') d.learning = {status: 'countdown', begins: Date.now() + 10000, deadline: Date.now() + 130000};
            ws.send(JSON.stringify({type: 'result', id: req.id, ok: true, data}));
            if (req.op !== 'watch' && req.op !== 'set') ws.send(JSON.stringify(snapshot));
        });
    });
    await page.goto('/');
    return {requests, snapshot, send: (msg) => socket.send(JSON.stringify(msg))};
}
test('dashboard, empty zones, drawing and device isolation work at desktop and mobile sizes', async ({page}, info) => {
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const m = await mock(page);
    await expect(page.getByRole('heading', {name: 'Presence, room by room'})).toBeVisible();
    await page.screenshot({path: `data/dashboard-${info.project.name}.png`, fullPage: true});
    await page.getByRole('link', {name: /Living room/}).click();
    await expect(page.getByRole('button', {name: /Create your first zone/})).toBeVisible();
    await page.getByRole('button', {name: /Create your first zone/}).click();
    await page.getByLabel('Zone 1 name').fill('Reading corner');
    await page.locator('#map').scrollIntoViewIfNeeded();
    const box = await page.locator('#map').boundingBox();
    if (info.project.name !== 'desktop') {
        const cdp = await page.context().newCDPSession(page);
        const x = box.x + box.width / 2, y = box.y + box.height / 2;
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchStart', touchPoints: [{x, y}]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchMove', touchPoints: [{x: x + 25, y: y + 25}]});
        await cdp.send('Input.dispatchTouchEvent', {type: 'touchEnd', touchPoints: []});
        await cdp.detach();
    } else {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 25); await page.mouse.up();
    }
    await page.getByRole('button', {name: 'Save changes'}).click();
    expect(m.requests.find((r) => r.op === 'saveLayout').layout.zones[0].cells).not.toBe('0'.repeat(80));
    await page.screenshot({path: `data/editor-${info.project.name}.png`, fullPage: true});
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.evaluate(() => innerWidth));
    await page.getByRole('link', {name: 'All sensors'}).click();
    await page.getByRole('link', {name: /Office/}).click();
    await expect(page.getByRole('heading', {name: 'Where is your sensor mounted?'})).toBeVisible();
    expect(m.requests.some((r) => r.op === 'watch' && r.ieee === null)).toBe(true);
    expect(errors).toEqual([]);
});
test('guided setup, timer, manual two-lap completion and themes', async ({page}, info) => {
    const m = await mock(page);
    await page.getByRole('link', {name: /Office/}).click();
    await page.getByRole('button', {name: 'On the ceiling'}).click();
    await page.getByRole('button', {name: 'Continue', exact: true}).click();
    await page.getByLabel('Height in metres').fill('2.4');
    await page.getByLabel('Height in metres').press('Tab');
    await page.screenshot({path: `data/mounting-${info.project.name}.png`, fullPage: true});
    await page.getByRole('button', {name: 'Continue', exact: true}).click();
    await page.getByRole('button', {name: 'Start exit countdown'}).click();
    await expect(page.locator('#learnStatus')).toHaveText('Leave the room now');
    await expect(page.getByRole('button', {name: 'Enter room and trace'})).toBeDisabled();
    const d = m.snapshot.devices[1]; d.learning = {status: 'complete'}; d.profile.learnedAt = 1; m.send(m.snapshot);
    await page.getByRole('button', {name: 'Enter room and trace'}).click();
    for (let lap = 0; lap < 2; lap++) {
        for (let i = 0; i < 16; i++) m.send({type: 'state', ieee: 'sensor-b', state: {targets: [{id: 1, x: Math.round(Math.sin(i / 16 * 2 * Math.PI) * 150), y: Math.round(300 + Math.cos(i / 16 * 2 * Math.PI) * 150)}]}});
        await page.getByRole('button', {name: lap ? 'Confirm both laps' : 'First lap complete'}).click();
    }
    await expect(page.getByRole('button', {name: /Create your first zone/})).toBeVisible();
    await page.getByRole('link', {name: 'Settings', exact: true}).click();
    await expect(page.locator('#logs')).toBeHidden();
    await page.getByRole('combobox', {name: 'Theme', exact: true}).selectOption('dark');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByLabel('Show technical details and logs').check();
    await expect(page.locator('#logs')).toContainText('Example diagnostic message');
    await page.screenshot({path: `data/settings-dark-${info.project.name}.png`, fullPage: true});
});

test('native occupancy highlights, obstacle editing and signal quality', async ({page}, info) => {
    const m = await mock(page);
    await expect(page.getByRole('img', {name: 'Zigbee link quality unknown'})).toHaveCount(2);
    m.send({type: 'state', ieee: 'sensor-a', state: {linkquality: 180}});
    await expect(page.getByRole('img', {name: 'Zigbee link quality: 180 / 255 LQI'})).toBeVisible();
    await page.getByRole('link', {name: /Living room/}).click();
    await page.getByRole('button', {name: /Create your first zone/}).click();
    m.send({type: 'state', ieee: 'sensor-a', state: {zone_1: true}});
    await expect(page.locator('[data-zone="1"]')).not.toHaveClass(/sensor-active/);
    m.send({type: 'state', ieee: 'sensor-a', state: {native_zone_1: true}});
    await expect(page.locator('[data-zone="1"]')).toHaveClass(/sensor-active/);
    m.send({type: 'state', ieee: 'sensor-a', state: {native_zone_1: false}});
    await expect(page.locator('[data-zone="1"]')).not.toHaveClass(/sensor-active/);
    await page.getByRole('tab', {name: 'Obstacles', exact: true}).click();
    await expect(page.locator('#zonePanel')).toBeHidden();
    await expect(page.locator('#obstaclePanel')).toBeVisible();
    await page.getByRole('button', {name: /Interference Moving objects/}).click();
    await expect(page.getByLabel('Selected drawing area')).toHaveValue('interference');
    await page.screenshot({path: 'data/obstacles-' + info.project.name + '.png', fullPage: true});
    await expect(page.getByRole('button', {name: 'Use software zones'})).toHaveCount(0);
    await expect(page.locator('body')).toHaveJSProperty('scrollWidth', await page.evaluate(() => innerWidth));
});
