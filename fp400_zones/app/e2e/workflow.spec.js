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

test('rectangle tool draws and erase rectangle clears part of an area', async ({page}) => {
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const m = await mock(page);
    const bits = (hex) => [...hex].reduce((n, c) => n + [...parseInt(c, 16).toString(2)].filter((b) => b === '1').length, 0);
    await page.getByRole('link', {name: /Living room/}).click();
    await page.getByRole('button', {name: /Create your first zone/}).click();
    await page.locator('#map').scrollIntoViewIfNeeded();
    const box = await page.locator('#map').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const drag = async (from, to) => {
        await page.mouse.move(cx + from[0], cy + from[1]); await page.mouse.down();
        await page.mouse.move(cx + to[0], cy + to[1], {steps: 4}); await page.mouse.up();
    };
    const cells = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('fp400.v2.draft.sensor-a')))).layout.zones[0].cells;
    await page.getByRole('button', {name: 'Rectangle', exact: true}).click();
    await drag([-60, -60], [60, 60]);
    const drawn = bits(await cells());
    expect(drawn).toBeGreaterThanOrEqual(9);
    await page.getByRole('button', {name: 'Erase rectangle', exact: true}).click();
    await expect(page.getByRole('button', {name: 'Erase rectangle', exact: true})).toHaveAttribute('aria-pressed', 'true');
    await drag([-60, -60], [0, 60]);
    const remaining = bits(await cells());
    expect(remaining).toBeGreaterThan(0);
    expect(remaining).toBeLessThan(drawn);
    await page.getByRole('button', {name: 'Undo', exact: true}).click();
    expect(bits(await cells())).toBe(drawn);
    await page.getByRole('button', {name: 'Save changes'}).click();
    await expect.poll(() => m.requests.find((r) => r.op === 'saveLayout')?.layout.zones[0].cells).toBe(await cells());
    expect(errors).toEqual([]);
});

test('mounting wizard starts from valid values when the sensor reports unknown settings', async ({page}) => {
    const m = await mock(page);
    const office = m.snapshot.devices.find((d) => d.ieee === 'sensor-b');
    office.state = {install_mode: 'unknown', side_install: 'unknown', install_height: 0};
    m.send(m.snapshot);
    await page.getByRole('link', {name: /Office/}).click();
    await page.getByRole('button', {name: /On the ceiling/}).click();
    await page.getByRole('button', {name: 'Continue', exact: true}).click();
    await page.locator('#heightNumber').fill('2.6');
    await page.locator('#heightNumber').dispatchEvent('change');
    await page.getByRole('button', {name: 'Continue', exact: true}).click();
    await expect.poll(() => m.requests.find((r) => r.op === 'mounting')).toMatchObject({mode: 'ceiling', side: 'wall', height: 2600});
});

test('ceiling mounting traces behind the sensor and draws zones on the centred grid', async ({page}) => {
    const errors = []; page.on('pageerror', (e) => errors.push(e.message));
    const m = await mock(page);
    const office = m.snapshot.devices.find((d) => d.ieee === 'sensor-b');
    office.state = {install_mode: 'ceiling', side_install: 'wall', install_height: 3500};
    office.learning = {status: 'complete'};
    m.send(m.snapshot);
    await page.getByRole('link', {name: /Office/}).click();
    for (let i = 0; i < 2; i++) await page.getByRole('button', {name: 'Continue', exact: true}).click();
    await page.getByRole('button', {name: 'Enter room and trace'}).click();
    const lap = [];
    for (let i = 0; i < 24; i++) {
        const a = (i / 24) * 2 * Math.PI;
        lap.push({x: Math.round(180 * Math.cos(a)), y: Math.round(-170 + 280 * Math.sin(a))});
    }
    for (const p of lap) m.send({type: 'state', ieee: 'sensor-b', state: {...office.state, targets: [{id: 1, ...p}], targets_updated_at: Date.now()}});
    await expect(page.locator('#roomSize')).toContainText('24 samples');
    await page.getByRole('button', {name: 'First lap complete'}).click();
    for (const p of lap) m.send({type: 'state', ieee: 'sensor-b', state: {...office.state, targets: [{id: 1, x: p.x + 3, y: p.y + 3}], targets_updated_at: Date.now()}});
    await page.getByRole('button', {name: 'Confirm both laps'}).click();
    const outline = m.requests.find((r) => r.op === 'profile' && r.complete).room.outline;
    expect(Math.min(...outline.map((p) => p.y))).toBeLessThan(-400);
    expect(Math.max(...outline.map((p) => p.y))).toBeGreaterThan(50);
    await page.getByRole('button', {name: /Create your first zone/}).click();
    await expect(page.locator('#mapScale')).toContainText('ceiling mount');
    await page.getByRole('button', {name: 'Show full grid'}).click();
    await expect(page.getByRole('button', {name: 'Fit room'})).toBeVisible();
    await page.locator('#map').scrollIntoViewIfNeeded();
    const box = await page.locator('#map').boundingBox();
    await page.getByRole('button', {name: 'Rectangle', exact: true}).click();
    // Full ceiling grid: below the map centre is y < 0, behind the sensor (above any sticky save bar).
    await page.mouse.move(box.x + box.width / 2 - 20, box.y + box.height * 0.7); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height * 0.65, {steps: 3}); await page.mouse.up();
    await page.getByRole('button', {name: 'Save changes'}).click();
    await expect.poll(() => m.requests.find((r) => r.op === 'saveLayout')?.layout.zones[0].cells).toBeTruthy();
    const cells = m.requests.find((r) => r.op === 'saveLayout').layout.zones[0].cells;
    const rows = [...Array(320).keys()].filter((bit) => (parseInt(cells.slice((bit >> 3) * 2, (bit >> 3) * 2 + 2), 16) & (128 >> (bit & 7)))).map((bit) => bit >> 4);
    expect(rows.length).toBeGreaterThan(0);
    expect(Math.max(...rows)).toBeLessThan(10);
    expect(errors).toEqual([]);
});

test('the fitted room view always includes drawn zones outside the traced outline', async ({page}) => {
    const m = await mock(page);
    const living = m.snapshot.devices.find((d) => d.ieee === 'sensor-a');
    living.state = {install_mode: 'ceiling', side_install: 'wall', install_height: 3500};
    // A small outline traced before ceiling support, plus a saved zone in row 2 (y -400..-350) behind the sensor.
    living.profile = {completedAt: 1, room: {outline: [{x: -300, y: 0}, {x: 300, y: 0}, {x: 0, y: 150}]}};
    const cells = '00'.repeat(4) + '0180' + '00'.repeat(34);
    living.layout = {zones: [{id: 1, name: 'Couch', enabled: true, cells}]};
    m.send(m.snapshot);
    m.send({type: 'state', ieee: 'sensor-a', state: living.state});
    await page.getByRole('link', {name: /Living room/}).click();
    await expect(page.locator('#mapScale')).toContainText('7.0 × 6.5 m · 50 cm cells · ceiling mount');
    await page.getByRole('button', {name: 'Show full grid'}).click();
    await expect(page.locator('#mapScale')).toContainText('8.0 × 10.0 m');
});

test('the map uses the last known ceiling mounting before the sensor reports again', async ({page}) => {
    const m = await mock(page);
    const living = m.snapshot.devices.find((d) => d.ieee === 'sensor-a');
    living.state = {};
    living.profile = {completedAt: 1, installMode: 'ceiling'};
    m.send(m.snapshot);
    await page.getByRole('link', {name: /Living room/}).click();
    await expect(page.locator('#mapScale')).toContainText('ceiling mount');
});

test('ceiling height hint shows the distance error and asks to confirm unusual heights', async ({page}) => {
    const m = await mock(page);
    await page.getByRole('link', {name: /Office/}).click();
    await page.getByRole('button', {name: /On the ceiling/}).click();
    await page.getByRole('button', {name: 'Continue', exact: true}).click();
    const hint = page.locator('#heightHint');
    await page.locator('#heightNumber').fill('2.59');
    await page.locator('#heightNumber').dispatchEvent('change');
    await expect(hint).toContainText('appears at 3.8 m');
    await expect(hint).not.toContainText('unusually high');
    await page.locator('#heightNumber').fill('3.5');
    await page.locator('#heightNumber').dispatchEvent('change');
    await expect(hint).toContainText('3.50 m is unusually high');
    const dialogs = [];
    page.once('dialog', (dialog) => { dialogs.push(dialog.message()); dialog.dismiss(); });
    await page.getByRole('button', {name: 'Continue', exact: true}).click();
    await expect.poll(() => dialogs.length).toBe(1);
    expect(dialogs[0]).toContain('3.50 m');
    expect(m.requests.some((r) => r.op === 'mounting')).toBe(false);
    page.once('dialog', (dialog) => dialog.accept());
    await page.getByRole('button', {name: 'Continue', exact: true}).click();
    await expect.poll(() => m.requests.find((r) => r.op === 'mounting')?.height).toBe(3500);
});
