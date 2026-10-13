import {COLORS, REGIONS, esc, normalize, addZone, emptyMask, maskHas, maskSet, cellAt, envelope, bounds} from './model.js';

const $ = (id) => document.getElementById(id);
const store = {
    get(key, fallback) { try { return JSON.parse(localStorage.getItem(`fp400.v2.${key}`)) ?? fallback; } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(`fp400.v2.${key}`, JSON.stringify(value)); } catch { /* Private browsing. */ } },
};
let snap = null, ws, serial = 0, current = '', view = 'dashboard', step = 0, active = null, tool = 'paint';
let areaTab = 'zones';
let layout = normalize(null), dirty = false, undo = [], trace = [], pass = 1, traceStart = 0, toastTimer, lastRenderKey = '';
let mounting = {mode: 'wall', side: 'wall', height: 2000}, painting = null, transform = null;
const pending = new Map();
const states = new Map();
const device = () => snap?.devices.find((d) => d.ieee === current);
const state = () => states.get(current) || device()?.state || {};
const displayName = (d) => d.profile?.name || d.name;
const button = (id, label, primary = false, disabled = false) => `<button id="${id}" class="${primary ? 'primary' : ''}" ${disabled ? 'disabled' : ''}>${label}</button>`;
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 6000); }
function call(op, args = {}) {
    if (ws?.readyState !== 1) return Promise.reject(new Error('The app is disconnected. Please wait for reconnection.'));
    const id = ++serial;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('The operation timed out. Check diagnostics before retrying.')); }, 100000);
        pending.set(id, {resolve, reject, timer}); ws.send(JSON.stringify({id, op, ...args}));
    });
}
function action(id, fn) {
    const el = $(id); if (!el) return;
    el.onclick = async () => { el.disabled = true; try { await fn(); } catch (err) { toast(err.message); } finally { el.disabled = false; } };
}
function connect() {
    const base = location.pathname.replace(/index\.html$/, '').replace(/\/?$/, '/');
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}ws`);
    ws.onopen = () => { $('connection').textContent = 'Connected'; watch(); };
    ws.onclose = () => {
        $('connection').textContent = 'Reconnecting…';
        for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error('Connection interrupted')); }
        pending.clear(); setTimeout(connect, 2500);
    };
    ws.onmessage = ({data}) => {
        let msg; try { msg = JSON.parse(data); } catch { return; }
        if (msg.type === 'result') {
            const p = pending.get(msg.id); if (!p) return;
            pending.delete(msg.id); clearTimeout(p.timer);
            if (msg.ok) p.resolve(msg.data); else p.reject(new Error(msg.error));
        } else if (msg.type === 'snapshot') {
            const first = !snap; snap = msg;
            for (const d of snap.devices) if (!states.has(d.ieee)) states.set(d.ieee, d.state || {});
            applyTheme();
            const key = JSON.stringify([snap.devices.map((d) => [d.ieee, d.name, d.ready, d.configured, d.profile, d.learning?.status]), snap.steps, snap.settings]);
            if (first) route();
            else if (key !== lastRenderKey) render();
            lastRenderKey = key;
            refreshLive();
        } else if (msg.type === 'state') {
            states.set(msg.ieee, msg.state);
            if (msg.ieee === current && view === 'setup' && step === 3 && (!msg.state.targets_updated_at || Date.now() - msg.state.targets_updated_at < 15000)) {
                // Ignore duplicate cached coordinates from unrelated sensor reports.
                for (const p of msg.state.targets || []) {
                    if (cellAt(p.x, p.y) === null) continue;
                    if (!trace.length || Math.hypot(p.x - trace.at(-1).x, p.y - trace.at(-1).y) > 8) trace.push({x: p.x, y: p.y});
                }
                if (trace.length > 4000) trace = trace.filter((_, i) => i % 2 === 0);
            }
            refreshLive();
        }
    };
}
function watch() {
    const enabled = current && (view === 'editor' || view === 'setup' && step === 3) && !document.hidden;
    call('watch', {ieee: enabled ? current : null}).catch(() => {});
}
setInterval(watch, 15000);
document.addEventListener('visibilitychange', watch);
window.addEventListener('pagehide', () => { if (ws?.readyState === 1) ws.send(JSON.stringify({id: ++serial, op: 'watch', ieee: null})); });
function saveDraft() { if (current) store.set(`draft.${current}`, {layout, dirty}); }
function changed() { dirty = true; saveDraft(); const s = $('saveLayout'); if (s) s.textContent = 'Save changes'; draw(); }
function route() {
    if (!snap) return;
    saveDraft();
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    const previous = current;
    current = parts[0] === 'device' ? decodeURIComponent(parts[1] || '') : '';
    view = parts[0] === 'settings' ? 'settings' : parts[0] === 'add' ? 'add' : current ? 'editor' : 'dashboard';
    if (current && !device()) { view = 'dashboard'; current = ''; }
    if (current && current !== previous) {
        const draft = store.get(`draft.${current}`, null);
        layout = normalize(draft?.dirty ? draft.layout : device().layout);
        dirty = !!draft?.dirty; active = layout.zones[0]?.id ?? null; undo = []; trace = []; pass = 1;
        const s = state(); mounting = {mode: s.install_mode === 'ceiling' ? 'ceiling' : 'wall', side: s.side_install || 'wall', height: s.install_height || 2000};
    }
    if (current && (parts[2] === 'setup' || (!device().profile?.completedAt && !device().layout?.zones?.length))) {
        view = 'setup';
        if (current !== previous || parts[2] === 'setup') step = device().learning && ['learning', 'countdown'].includes(device().learning.status) ? 2 : 0;
    }
    watch(); render(); window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

function applyTheme() {
    const mode = snap?.settings?.theme || store.get('theme', 'auto');
    let dark = mode === 'dark';
    if (mode === 'auto') {
        dark = matchMedia('(prefers-color-scheme: dark)').matches;
        try {
            const ha = window.parent !== window ? window.parent.document.querySelector('home-assistant')?.hass : null;
            if (typeof ha?.themes?.darkMode === 'boolean') dark = ha.themes.darkMode;
        } catch { /* Cross-origin ingress: use the system preference. */ }
    }
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    draw();
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
setInterval(applyTheme, 5000);

function prerequisites() {
    const issues = snap.steps.filter((s) => s.status !== 'ok');
    if (!issues.length) return '';
    return `<div class="banner"><h2>Connect your sensors</h2><div class="checklist">${issues.map((s) => `<div><strong>${esc(s.label)}</strong><p>${esc(s.detail)}</p>${s.action ? `<button data-setup="${esc(s.id)}">${esc(s.action.label)}</button>` : ''}</div>`).join('')}</div></div>`;
}
function render() {
    if (!snap) return;
    $('app').innerHTML = view === 'dashboard' ? dashboard() : view === 'settings' ? settings() : view === 'add' ? pairing() : view === 'setup' ? wizard() : editor();
    document.querySelectorAll('[data-setup]').forEach((el) => { el.onclick = async () => {
        const a = snap.steps.find((s) => s.id === el.dataset.setup)?.action;
        if (!a || a.confirm && !confirm(a.confirm)) return;
        el.disabled = true; try { await call(a.op); } catch (err) { toast(err.message); } finally { el.disabled = false; }
    }; });
    bind(); refreshLive(); requestAnimationFrame(draw);
}
function signalIcon(value) {
    const known = Number.isFinite(value) && value >= 0 && value <= 255;
    const level = known ? Math.ceil(value / 64) : 0;
    const label = known ? 'Zigbee link quality: ' + value + ' / 255 LQI' : 'Zigbee link quality unknown';
    return '<span class="signal" role="img" tabindex="0" aria-label="' + label + '" title="' + label + '"><svg viewBox="0 0 28 24" aria-hidden="true">' + [0,1,2,3].map((i) => '<rect x="' + (i * 7) + '" y="' + (18 - i * 5) + '" width="5" height="' + (6 + i * 5) + '" rx="1" fill="' + (i < level ? 'var(--primary)' : 'var(--line)') + '"/>').join('') + '</svg>' + (known ? '' : '<small>?</small>') + '</span>';
}
function dashboard() {
    return `<div class="pagehead"><div><div class="eyebrow">Your home</div><h1>Presence, room by room</h1><p>Set up your sensors and configure up to 8 zones.</p></div><a class="primary button-link" href="#/add">＋ Add sensor</a></div>${prerequisites()}<div class="cards">${snap.devices.map((d) => {
        const s = states.get(d.ieee) || d.state || {};
        return `<a class="card device-card" href="#/device/${encodeURIComponent(d.ieee)}"><div class="cardtop"><div class="sensor-icon">◉</div><span data-signal="${esc(d.ieee)}">${signalIcon(s.linkquality)}</span></div><h2>${esc(displayName(d))}</h2><p>Aqara FP400 · ${d.profile?.sensorSavedAt ? 'Sensor zones' : 'Save zones to sensor'}</p><div class="stats"><div><strong data-presence="${esc(d.ieee)}">${s.presence === true ? 'Present' : s.presence === false ? 'Clear' : '—'}</strong><small>Presence</small></div><div><strong>${d.layout?.zones?.length || 0}</strong><small>Zones</small></div><div><strong data-light="${esc(d.ieee)}">${esc(s.illuminance ?? '—')}</strong><small>Lux</small></div></div></a>`;
    }).join('')}<a class="card add-card" href="#/add"><span>＋</span><strong>${snap.devices.length ? 'Add another sensor' : 'Add your first FP400'}</strong><small>Pair a sensor with Zigbee2MQTT</small></a></div>`;
}
function pairing() {
    return `<a class="back" href="#/">← All sensors</a><div class="card pairing"><div class="sensor-icon" style="margin:0 auto 24px">◉</div><h1>Add an FP400</h1><p>Power on your sensor in Zigbee mode. Open pairing, then hold its pairing button until its indicator flashes.</p><p>Pairing is open for up to four minutes. Existing sensors stay connected.</p><div class="timer" id="pairTimer">＋</div><div class="actions" style="justify-content:center">${button('pair', 'Start pairing', true)}${button('closePair', 'Close pairing')}</div><div id="paired" class="checklist" style="margin-top:24px">${snap.devices.map((d) => `<a class="back" href="#/device/${encodeURIComponent(d.ieee)}">${esc(displayName(d))} →</a>`).join('')}</div></div>`;
}
function mountingPicture(mode) {
    return `<svg viewBox="0 0 200 130" aria-hidden="true"><path d="M25 15V110H185" fill="none" stroke="var(--muted)" stroke-width="5"/>${mode === 'ceiling' ? '<path d="M25 15H185" stroke="var(--muted)" stroke-width="5"/><path d="M100 30L45 110H155Z" fill="var(--soft)"/><rect x="85" y="16" width="30" height="15" rx="7" fill="var(--accent)"/>' : '<path d="M40 50L180 20V110Z" fill="var(--soft)"/><rect x="25" y="37" width="18" height="30" rx="7" fill="var(--accent)"/>'}<circle cx="125" cy="78" r="7" fill="var(--muted)"/><path d="M125 87V110" stroke="var(--muted)" stroke-width="6"/></svg>`;
}
function heightPicture() {
    const y = 190 - mounting.height / 5000 * 160;
    return `<svg viewBox="0 0 280 220" aria-label="Sensor height above the floor"><path d="M60 20V195H250" stroke="var(--muted)" stroke-width="5" fill="none"/><rect x="60" y="${y - 12}" width="24" height="24" rx="8" fill="var(--accent)"/><path d="M105 ${y}V195" stroke="var(--accent)" stroke-width="2" stroke-dasharray="5 4"/><text x="120" y="${(y + 195) / 2}" fill="var(--text)" font-size="18">${(mounting.height / 1000).toFixed(2)} m</text><text x="160" y="215" fill="var(--muted)" font-size="12">Floor</text></svg>`;
}
function wizard() {
    const d = device(); if (!d) return '';
    const names = ['Mounting', 'Height', 'Empty room', 'Room boundary'];
    let content = '';
    if (step === 0) content = `<h1>Where is your sensor mounted?</h1><p>Choose the actual mounting position for this room.</p><div class="choices">${['wall', 'ceiling'].map((m) => `<button class="choice" data-mount="${m}" aria-pressed="${mounting.mode === m}">${mountingPicture(m)}${m === 'wall' ? 'On a wall' : 'On the ceiling'}</button>`).join('')}</div>${mounting.mode === 'wall' ? `<label class="field">Wall position<select id="side"><option value="wall">Flat wall</option><option value="left_corner">Left corner</option><option value="right_corner">Right corner</option></select></label>` : ''}<label class="field">Room / sensor name<input id="roomName" maxlength="80" value="${esc(displayName(d))}" placeholder="Living room"></label>`;
    if (step === 1) content = `<h1>Set the mounting height</h1><p>Measure from the floor to the sensor. Drag the slider or enter the height.</p><div class="mount-height"><div id="heightGraphic">${heightPicture()}</div><div><label class="field">Height in metres<input id="heightNumber" type="number" min="0.1" max="5" step="0.05" value="${mounting.height / 1000}"></label><label class="field">Adjust height<input id="heightRange" aria-label="Mounting height" type="range" min="100" max="5000" step="50" value="${mounting.height}"></label></div></div><p class="note">These settings are written to the sensor when you continue.</p>`;
    if (step === 2) {
        const job = d.learning;
        const busy = job && ['countdown', 'learning'].includes(job.status);
        content = `<h1>${job?.status === 'complete' ? 'Room learning complete' : 'Let the room settle'}</h1><p>Remove people and pets from the detection area. After a <strong>10-second exit countdown</strong>, the sensor learns the empty room.</p><p>Allow up to <strong>2 minutes</strong> after the countdown. The exact duration is firmware-dependent; we wait for the sensor’s confirmation.</p><div class="timer ${busy ? 'active' : ''}" id="learnTimer">${job?.status === 'complete' ? '✓' : '10'}</div><p id="learnStatus" style="text-align:center" role="status"></p><div class="progress"><div id="learnProgress" style="width:0%"></div></div>${job?.error ? `<p class="error">${esc(job.error)}</p>` : ''}<div class="actions" style="justify-content:center">${button('learn', job?.status === 'complete' ? 'Learn again' : 'Start exit countdown', true, busy)}${job?.status === 'countdown' ? button('cancelLearn', 'Cancel countdown') : ''}</div>`;
    }
    if (step === 3) content = `<h1>Walk the room boundary twice</h1><p>Enter the room alone. Walk close to each edge at a steady pace, then repeat. Confirm each lap yourself.</p><div class="badge" id="lapBadge">Lap ${pass} of 2</div><div class="map-wrap" style="margin-top:16px"><canvas id="map" aria-label="Live room boundary tracing"></canvas></div><div class="room-summary" id="roomSize"></div><p class="note">The outline estimates the outer envelope of your walk, not physical walls or recesses. The display fits this outline; sensor cells remain 50 × 50 cm.</p><div class="actions">${button('lap', pass === 1 ? 'First lap complete' : 'Confirm both laps', true)}${button('resetTrace', 'Start tracing again')}</div>`;
    return `<div class="wizard"><a class="back" href="#/">← All sensors</a><div class="eyebrow">${esc(displayName(d))} · Setup</div><ol class="steps">${names.map((n, i) => `<li class="${i === step ? 'active' : i < step ? 'done' : ''}">${i + 1}. ${n}</li>`).join('')}</ol>${!d.ready ? prerequisites() + '<div class="banner">Waiting for Zigbee2MQTT to activate the converter. If this persists, restart Zigbee2MQTT.</div>' : ''}<div class="card wizard-body">${content}<div class="wizard-footer">${button('previous', step ? 'Back' : 'All sensors')}<span class="note">Step ${step + 1} of 4</span>${step < 3 ? button('next', step === 2 ? 'Enter room and trace' : 'Continue', true, !d.ready || step === 2 && d.learning?.status !== 'complete') : ''}</div></div></div>`;
}
function editor() {
    const d = device(); if (!d) return '';
    return `<a class="back" href="#/">← All sensors</a><div class="pagehead"><div><div class="eyebrow">Room overview</div><h1>${esc(displayName(d))}</h1><p id="roomPresence">Waiting for sensor data</p></div><div class="actions">${button('rename', 'Rename')}${button('setupAgain', 'Run setup')}</div></div>${!d.ready ? prerequisites() : ''}<div class="editor"><section class="card map-card"><div class="map-header"><strong>Room plan</strong><span class="badge" id="liveBadge">Live view</span></div><div class="tools">${['paint', 'rect', 'erase'].map((t) => `<button data-tool="${t}" aria-pressed="${tool === t}">${{paint: 'Draw', rect: 'Rectangle', erase: 'Erase'}[t]}</button>`).join('')}${button('undo', 'Undo')}${button('fit', 'Fit room')}<select id="activeZone" aria-label="Selected drawing area"><option value="">Choose an area</option>${layout.zones.map((z) => `<option value="${z.id}">${esc(z.name)}</option>`).join('')}${Object.entries(REGIONS).map(([k,v]) => `<option value="${k}">${v}</option>`).join('')}</select></div><div class="map-wrap"><canvas id="map" aria-label="Draw zones and obstacles on the room grid"></canvas></div><div class="map-legend"><span id="mapScale">50 cm cells</span><label><input id="mirror" type="checkbox" ${d.profile?.mirror ? 'checked' : ''}> Mirror view</label></div><p class="note" id="drawHint" style="margin-top:12px">${active ? 'Drag on the grid to draw the selected area.' : 'Add your first zone or select an obstacle tool to draw.'}</p><div class="savebar">${button('saveLayout', dirty ? 'Save changes' : 'Save layout', true)}${button('export', 'Export')}</div></section><aside class="sidebar"><section class="card area-panel"><div class="area-tabs" role="tablist" aria-label="Room areas"><button role="tab" id="zonesTab" aria-selected="${areaTab === 'zones'}">Zones</button><button role="tab" id="obstaclesTab" aria-selected="${areaTab === 'obstacles'}">Obstacles</button></div><div id="zonePanel" ${areaTab === 'zones' ? '' : 'hidden'}><h2>Zones <small>${layout.zones.length}/8</small></h2><div id="zones">${layout.zones.map((z) => `<div class="zone ${active === z.id ? 'selected' : ''}" data-zone="${z.id}"><div class="zone-head"><span class="swatch" style="background:${COLORS[z.id - 1]}"></span><input data-name="${z.id}" aria-label="Zone ${z.id} name" maxlength="80" value="${esc(z.name)}"><span class="badge" data-occupied="${z.id}">—</span></div><div class="zone-controls"><button data-delete="${z.id}" aria-label="Delete zone ${z.id}">×</button></div></div>`).join('')}</div>${layout.zones.length < 8 ? `<button class="new-zone" id="addZone">＋ ${layout.zones.length ? 'Add zone' : 'Create your first zone'}</button>` : ''}<p class="note">Zones and obstacles are transferred and verified when you save.</p></div><div id="obstaclePanel" ${areaTab === 'obstacles' ? '' : 'hidden'}><h2>Adjust detection</h2><p class="note">Choose a purpose, then draw its area on the room plan.</p><div class="segment">${Object.entries(REGIONS).map(([k, v]) => `<button data-region="${k}" aria-pressed="${active === k}"><strong>${v}</strong><small>${{monitoring: 'Space the sensor should ignore', interference: 'Moving objects such as fans or curtains', entry_exit: 'Doorways and room transitions'}[k]}</small></button>`).join('')}</div>${button('clearArea', 'Clear selected area')}<p class="note" style="margin-top:12px">Use Draw, Rectangle or Erase on the map. Save transfers every area together.</p></div></section><section class="card"><h2>Sensor storage</h2><p>Occupancy is evaluated by the FP400. Live positions are requested only while viewing this room.</p><p class="note">Sensor protocol support is experimental. Saving requires matching readback; test occupancy after saving.</p></section></aside></div>`;
}
function settings() {
    const debug = store.get('debug', false);
    return `<div class="settings"><a class="back" href="#/">← All sensors</a><h1>Settings</h1><p>Appearance and diagnostics for all your rooms.</p><section class="card"><h2>Appearance</h2><label class="field">Theme<select id="theme"><option value="auto">Home Assistant / system</option><option value="light">Light</option><option value="dark">Dark</option></select></label><p class="note">Automatic follows Home Assistant when its theme is accessible; otherwise it follows your device.</p></section><section class="card"><h2>Diagnostics</h2><label class="debug-toggle"><input id="debug" type="checkbox" ${debug ? 'checked' : ''}> Show technical details and logs</label><div id="debugPanel" ${debug ? '' : 'hidden'}><p style="margin-top:16px">App ${esc(snap.version)} · Converter ${esc(snap.converterVersion)}</p>${prerequisites()}<div class="actions">${snap.devices.map((d) => `<button data-configure="${esc(d.ieee)}">Reconfigure ${esc(displayName(d))}</button>`).join('')}</div><pre class="logs" id="logs"></pre><p class="note">Detailed operation logs are also available on the Home Assistant app’s Log tab. Remove personal details before sharing diagnostics.</p></div></section><section class="card"><h2>Local drafts</h2><p>Unsaved zone edits are kept separately for each sensor in this browser.</p>${button('clearDrafts', 'Clear browser drafts')}</section></div>`;
}

function bind() {
    action('pair', () => call('permitJoin'));
    action('closePair', () => call('closeJoin'));
    if (view === 'settings') {
        document.querySelectorAll('[data-configure]').forEach((el) => { el.onclick = async () => { el.disabled = true; try { await call('configure', {ieee: el.dataset.configure}); toast('Sensor configured'); } catch (err) { toast(err.message); } finally { el.disabled = false; } }; });
        $('theme').value = snap.settings?.theme || 'auto';
        $('theme').onchange = async (e) => { try { await call('settings', {theme: e.target.value}); store.set('theme', e.target.value); } catch (err) { toast(err.message); } };
        $('debug').onchange = (e) => { store.set('debug', e.target.checked); $('debugPanel').hidden = !e.target.checked; refreshLive(); };
        action('clearDrafts', () => { if (!confirm('Remove all unsaved FP400 drafts from this browser? Saved layouts are kept.')) return; for (const key of Object.keys(localStorage)) if (key.startsWith('fp400.v2.draft.')) localStorage.removeItem(key); toast('Browser drafts cleared'); });
    }
    if (view === 'setup') {
        document.querySelectorAll('[data-mount]').forEach((b) => { b.onclick = () => { mounting.mode = b.dataset.mount; render(); }; });
        if ($('side')) { $('side').value = mounting.side; $('side').onchange = (e) => { mounting.side = e.target.value; }; }
        const height = (mm) => { mounting.height = Math.max(100, Math.min(5000, Math.round(mm) || 2000)); $('heightGraphic').innerHTML = heightPicture(); $('heightRange').value = mounting.height; $('heightNumber').value = mounting.height / 1000; };
        if ($('heightRange')) $('heightRange').oninput = (e) => height(Number(e.target.value));
        if ($('heightNumber')) $('heightNumber').onchange = (e) => height(Number(e.target.value) * 1000);
        action('previous', () => { if (step) { step--; watch(); render(); } else location.hash = '#/'; });
        action('next', async () => {
            if (step === 0) await call('profile', {ieee: current, name: $('roomName').value});
            if (step === 1) {
                await call('mounting', {ieee: current, ...mounting});
            }
            step++; if (step === 3) { trace = []; pass = 1; traceStart = 0; }
            watch(); render();
        });
        action('learn', async () => { await call('learn', {ieee: current}); });
        action('cancelLearn', () => call('cancelLearn', {ieee: current}));
        action('resetTrace', () => { trace = []; pass = 1; traceStart = 0; render(); });
        action('lap', async () => {
            if (trace.length - traceStart < 10 || envelope(trace.slice(traceStart)).length < 3) throw new Error('Walk around more of the room before confirming this lap.');
            if (pass === 1) { pass = 2; traceStart = trace.length; render(); return; }
            device().profile = await call('profile', {ieee: current, room: {outline: envelope(trace)}, complete: true});
            view = 'editor'; location.hash = `#/device/${encodeURIComponent(current)}`; render(); watch();
        });
    }
    if (view === 'editor') {
        action('zonesTab', () => { areaTab = 'zones'; active = layout.zones[0]?.id ?? null; render(); });
        action('obstaclesTab', () => { areaTab = 'obstacles'; active = 'monitoring'; render(); });
        $('activeZone').value = active ?? '';
        $('activeZone').onchange = (e) => { active = e.target.value in REGIONS ? e.target.value : Number(e.target.value) || null; areaTab = typeof active === 'string' ? 'obstacles' : 'zones'; render(); };
        action('rename', async () => { const name = prompt('Room / sensor name', displayName(device())); if (name !== null) await call('profile', {ieee: current, name}); });
        action('setupAgain', () => { if (confirm('Run mounting, room learning and boundary setup again? Your saved zones will be kept.')) location.hash = `#/device/${encodeURIComponent(current)}/setup`; });
        action('addZone', () => { undo.push(structuredClone(layout)); const z = addZone(layout); if (z) active = z.id; changed(); render(); $('map').scrollIntoView({block: 'center', behavior: 'smooth'}); });
        document.querySelectorAll('[data-zone]').forEach((el) => { el.onclick = (e) => { if (e.target.matches('input,button')) return; active = Number(el.dataset.zone); render(); }; });
        document.querySelectorAll('[data-name]').forEach((el) => { el.oninput = () => { layout.zones.find((z) => z.id === Number(el.dataset.name)).name = el.value; changed(); }; });
        document.querySelectorAll('[data-delay]').forEach((el) => { el.onchange = () => { layout.zones.find((z) => z.id === Number(el.dataset.delay)).delay = Math.max(0, Math.min(600, Number(el.value) || 0)); changed(); }; });
        document.querySelectorAll('[data-delete]').forEach((el) => { el.onclick = () => { if (!confirm('Delete this zone from the draft? Save to apply the change.')) return; undo.push(structuredClone(layout)); layout.zones = layout.zones.filter((z) => z.id !== Number(el.dataset.delete)); active = layout.zones[0]?.id ?? null; changed(); render(); }; });
        document.querySelectorAll('[data-region]').forEach((el) => { el.onclick = () => { active = el.dataset.region; render(); }; });
        document.querySelectorAll('[data-tool]').forEach((el) => { el.onclick = () => { tool = el.dataset.tool; render(); }; });
        action('undo', () => { if (undo.length) { layout = undo.pop(); changed(); render(); } });
        action('clearArea', () => { if (active === null) return; undo.push(structuredClone(layout)); setMask(emptyMask()); changed(); });
        action('fit', () => { fullGrid = !fullGrid; draw(); });
        $('mirror').onchange = async (e) => { try { await call('profile', {ieee: current, mirror: e.target.checked}); } catch (err) { toast(err.message); } };
        action('saveLayout', saveLayout);
        action('export', () => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(layout, null, 2)], {type: 'application/json'})); a.download = 'fp400-layout.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); });
    }
    if ($('map')) bindCanvas();
}
async function saveLayout() {
    const id = current;
    const saved = JSON.stringify(layout);
    $('saveLayout').textContent = 'Saving to sensor...';
    try { await call('saveLayout', {ieee: id, layout: JSON.parse(saved)}); }
    catch (err) { if (current === id && $('saveLayout')) $('saveLayout').textContent = 'Retry save to sensor'; throw err; }
    if (current === id && JSON.stringify(layout) === saved) { dirty = false; saveDraft(); if ($('saveLayout')) $('saveLayout').textContent = 'Saved to sensor'; }
    toast('Zones and obstacles verified on sensor.');
}
function refreshLive() {
    if (!snap) return;
    document.querySelectorAll('[data-signal]').forEach((el) => { el.innerHTML = signalIcon(states.get(el.dataset.signal)?.linkquality); });
    document.querySelectorAll('[data-presence]').forEach((el) => { const s = states.get(el.dataset.presence) || {}; el.textContent = s.presence === true ? 'Present' : s.presence === false ? 'Clear' : '—'; });
    document.querySelectorAll('[data-light]').forEach((el) => { el.textContent = states.get(el.dataset.light)?.illuminance ?? '—'; });
    if ($('pairTimer')) { const left = Math.max(0, Math.ceil((snap.permitJoinUntil - Date.now()) / 1000)); $('pairTimer').textContent = left ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : '＋'; $('pair').disabled = left > 0; }
    if ($('logs')) $('logs').textContent = snap.log.join('\n');
    const s = state();
    if ($('roomPresence')) $('roomPresence').textContent = `${s.presence === true ? 'Presence detected' : s.presence === false ? 'Room clear' : 'Waiting for presence'} · ${s.illuminance ?? '—'} lx`;
    if ($('liveBadge')) $('liveBadge').textContent = s.targets_updated_at && Date.now() - s.targets_updated_at < 15000 ? 'Live positions received' : 'Waiting for fresh positions';
    document.querySelectorAll('[data-zone]').forEach((el) => el.classList.toggle('sensor-active', s[`native_zone_${el.dataset.zone}`] === true));
    document.querySelectorAll('[data-occupied]').forEach((el) => { const occupied = s[`native_zone_${el.dataset.occupied}`]; el.textContent = occupied === true ? 'Occupied' : occupied === false ? 'Clear' : '—'; });
    if ($('learnTimer')) {
        const job = device()?.learning;
        const left = job?.status === 'countdown' ? Math.max(0, Math.ceil((job.begins - Date.now()) / 1000)) : null;
        const elapsed = job ? Math.max(0, Math.floor((Date.now() - job.begins) / 1000)) : 0;
        $('learnTimer').textContent = left !== null ? left : job?.status === 'learning' ? `${elapsed}s` : job?.status === 'complete' ? '✓' : '10';
        $('learnStatus').textContent = left !== null ? 'Leave the room now' : job?.status === 'learning' ? 'Learning… stay outside until confirmation' : job?.status === 'complete' ? 'Confirmed by the sensor. You can enter the room.' : 'Ready when you are';
        $('learnProgress').style.width = `${job?.status === 'complete' ? 100 : Math.min(99, elapsed / 120 * 100)}%`;
    }
    if ($('roomSize')) { const b = bounds(envelope(trace)); $('roomSize').textContent = `Estimated extent: ${((b.maxX - b.minX) / 100).toFixed(1)} × ${((b.maxY - b.minY) / 100).toFixed(1)} m · ${trace.length} samples`; }
    draw();
}
setInterval(refreshLive, 1000);

let fullGrid = false;
function selectedMask() { return typeof active === 'number' ? layout.zones.find((z) => z.id === active)?.cells : layout.regions[active]; }
function setMask(hex) { if (typeof active === 'number') { const z = layout.zones.find((z) => z.id === active); if (z) z.cells = hex; } else if (active in REGIONS) layout.regions[active] = hex; }
function draw() {
    const cv = $('map'); if (!cv || !device()) return;
    const width = cv.clientWidth, height = cv.clientHeight; if (!width || !height) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = width * dpr; cv.height = height * dpr;
    const ctx = cv.getContext('2d'); ctx.scale(dpr, dpr);
    const style = getComputedStyle(document.documentElement), color = (k) => style.getPropertyValue(k).trim();
    const outline = view === 'setup' ? envelope(trace) : device().profile?.room?.outline;
    const b = bounds(view === 'setup' || fullGrid ? null : outline);
    const scale = Math.min((width - 36) / (b.maxX - b.minX), (height - 36) / (b.maxY - b.minY));
    const ox = (width - (b.maxX - b.minX) * scale) / 2, oy = (height - (b.maxY - b.minY) * scale) / 2;
    const mirror = !!device().profile?.mirror;
    const xy = (x, y) => [ox + (mirror ? b.maxX - x : x - b.minX) * scale, height - oy - (y - b.minY) * scale];
    transform = {xy, b, scale, ox, oy, width, height, mirror};
    ctx.strokeStyle = color('--line'); ctx.lineWidth = .7;
    for (let x = b.minX; x <= b.maxX; x += 50) { const a = xy(x, b.minY), z = xy(x, b.maxY); ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...z); ctx.stroke(); }
    for (let y = b.minY; y <= b.maxY; y += 50) { ctx.beginPath(); ctx.moveTo(...xy(b.minX, y)); ctx.lineTo(...xy(b.maxX, y)); ctx.stroke(); }
    const fill = (mask, c, hatch = false) => {
        for (let bit = 0; bit < 320; bit++) {
            if (!maskHas(mask, bit)) continue;
            const col = bit % 16, row = Math.floor(bit / 16), x = (7 - col) * 50, y = row * 50;
            if (x < b.minX || x >= b.maxX || y < b.minY || y >= b.maxY) continue;
            const a = xy(x, y + 50), z = xy(x + 50, y);
            ctx.globalAlpha = .27; ctx.fillStyle = c; ctx.fillRect(Math.min(a[0], z[0]), a[1], 50 * scale, 50 * scale);
            ctx.globalAlpha = 1; if (hatch) { ctx.strokeStyle = c; ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...z); ctx.stroke(); }
        }
    };
    if (view === 'editor') {
        for (const z of layout.zones) if (z.enabled) fill(z.cells, COLORS[z.id - 1]);
        for (const [key, mask] of Object.entries(layout.regions)) fill(mask, {monitoring: '#8796a5', interference: '#ef9b26', entry_exit: '#26a69a'}[key], true);
    }
    if (outline?.length > 2) { ctx.strokeStyle = color('--primary'); ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath(); outline.forEach((p, i) => i ? ctx.lineTo(...xy(p.x, p.y)) : ctx.moveTo(...xy(p.x, p.y))); ctx.closePath(); ctx.stroke(); ctx.setLineDash([]); }
    if (view === 'setup') { ctx.fillStyle = color('--primary'); ctx.globalAlpha = .35; for (const p of trace) { ctx.beginPath(); ctx.arc(...xy(p.x, p.y), 2, 0, Math.PI * 2); ctx.fill(); } ctx.globalAlpha = 1; }
    for (const p of (state().targets_updated_at && Date.now() - state().targets_updated_at > 15000 ? [] : state().targets || [])) {
        if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const [x, y] = xy(p.x, p.y);
        ctx.fillStyle = color('--accent'); ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = color('--card'); ctx.lineWidth = 3; ctx.stroke();
    }
    const [sx, sy] = xy(0, 0); if (sy <= height && sy >= 0) { ctx.fillStyle = color('--primary'); ctx.fillRect(sx - 10, sy - 5, 20, 10); }
    if ($('mapScale')) $('mapScale').textContent = `${((b.maxX - b.minX) / 100).toFixed(1)} × ${((b.maxY - b.minY) / 100).toFixed(1)} m · 50 cm cells`;
}
function bindCanvas() {
    const cv = $('map');
    const bitFor = (e) => {
        if (!transform) return null;
        const r = cv.getBoundingClientRect(), t = transform;
        const x = t.mirror ? t.b.maxX - (e.clientX - r.left - t.ox) / t.scale : t.b.minX + (e.clientX - r.left - t.ox) / t.scale;
        const y = t.b.minY + (t.height - t.oy - (e.clientY - r.top)) / t.scale;
        return cellAt(x, y);
    };
    const apply = (bit) => { if (bit === null || !selectedMask()) return; setMask(maskSet(selectedMask(), bit, tool !== 'erase')); changed(); };
    cv.onpointerdown = (e) => {
        if (view !== 'editor' || active === null) return;
        const bit = bitFor(e); if (bit === null) return;
        cv.setPointerCapture(e.pointerId); undo.push(structuredClone(layout)); if (undo.length > 40) undo.shift();
        painting = {start: bit, last: bit}; if (tool !== 'rect') apply(bit);
    };
    cv.onpointermove = (e) => { if (!painting) return; const bit = bitFor(e); if (bit === null) return; painting.last = bit; if (tool !== 'rect') apply(bit); };
    cv.onpointerup = () => {
        if (painting && tool === 'rect') {
            const a = painting.start, b = painting.last;
            for (let row = Math.min(a >> 4, b >> 4); row <= Math.max(a >> 4, b >> 4); row++) for (let col = Math.min(a % 16, b % 16); col <= Math.max(a % 16, b % 16); col++) apply(row * 16 + col);
        }
        painting = null;
    };
    cv.onpointercancel = () => { painting = null; };
    cv.oncontextmenu = (e) => e.preventDefault();
}
window.addEventListener('resize', draw);
connect();
