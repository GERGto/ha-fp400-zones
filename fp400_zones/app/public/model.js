export const COLORS = ['#03a9f4', '#e67caa', '#ffb300', '#26a69a', '#9575cd', '#ef6c00', '#ef5350', '#5c6bc0'];
export const REGIONS = {monitoring: 'Exclusion', interference: 'Interference', entry_exit: 'Entry / exit'};
export const emptyMask = () => '0'.repeat(80);
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
export function normalize(raw) {
    const doc = raw && typeof raw === 'object' ? raw : {};
    const seen = new Set();
    return {version: 1, targets_interval: Number.isFinite(doc.targets_interval) ? doc.targets_interval : 1000,
        zones: (Array.isArray(doc.zones) ? doc.zones : []).filter((z) => {
            if (!z || !Number.isInteger(z.id) || z.id < 1 || z.id > 8 || seen.has(z.id)) return false;
            seen.add(z.id); return true;
        }).map((z) => ({id: z.id, name: String(z.name || `Zone ${z.id}`).slice(0, 80), enabled: z.enabled !== false,
            delay: Math.min(600, Math.max(0, Number(z.delay) || 0)), cells: /^[\da-f]{80}$/i.test(z.cells) ? z.cells.toLowerCase() : emptyMask()})),
        regions: Object.fromEntries(Object.keys(REGIONS).map((k) => [k, /^[\da-f]{80}$/i.test(doc.regions?.[k]) ? doc.regions[k].toLowerCase() : emptyMask()]))};
}
export function maskHas(hex, bit) { return !!(parseInt(hex.slice((bit >> 3) * 2, (bit >> 3) * 2 + 2), 16) & (128 >> (bit & 7))); }
export function maskSet(hex, bit, on) {
    const at = (bit >> 3) * 2;
    let byte = parseInt(hex.slice(at, at + 2), 16);
    byte = on ? byte | (128 >> (bit & 7)) : byte & ~(128 >> (bit & 7));
    return hex.slice(0, at) + byte.toString(16).padStart(2, '0') + hex.slice(at + 2);
}
// Sensor grid: 16 columns x 20 rows of 50 cm cells, x in cm (+x = left of the sensor's view), y in cm.
// Wall mounting: row 0 starts at the sensor (y 0..1000). Ceiling mounting: the grid is centred on the
// sensor (y -500..500), verified on hardware by zone occupancy on both sides of y = 0.
export const gridMode = (mode) => mode === 'ceiling' ? 'ceiling' : 'wall';
export function gridBounds(mode) {
    const minY = gridMode(mode) === 'ceiling' ? -500 : 0;
    return {minX: -400, maxX: 400, minY, maxY: minY + 1000};
}
export function cellAt(x, y, mode = 'wall') {
    const col = Math.floor(8 - x / 50), row = Math.floor((y - gridBounds(mode).minY) / 50);
    return col >= 0 && col < 16 && row >= 0 && row < 20 ? row * 16 + col : null;
}
/** Lower-left corner (smallest x and y, in cm) of a grid cell. */
export function cellOrigin(bit, mode = 'wall') {
    return {x: (7 - (bit % 16)) * 50, y: Math.floor(bit / 16) * 50 + gridBounds(mode).minY};
}
export function addZone(layout) {
    const id = Array.from({length: 8}, (_, i) => i + 1).find((i) => !layout.zones.some((z) => z.id === i));
    if (!id) return null;
    // The sensor's absence confirmation is always written as 0 seconds when saving.
    const zone = {id, name: `Zone ${id}`, enabled: true, delay: 0, cells: emptyMask()};
    layout.zones.push(zone); return zone;
}
export function envelope(points, mode = 'wall') {
    const sorted = [...new Map(points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y) && cellAt(p.x, p.y, mode) !== null)
        .map((p) => [`${Math.round(p.x)},${Math.round(p.y)}`, {x: Math.round(p.x), y: Math.round(p.y)}])).values()].sort((a, b) => a.x - b.x || a.y - b.y);
    if (sorted.length < 3) return sorted;
    const cross = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const half = (ps) => { const h = []; for (const p of ps) { while (h.length > 1 && cross(h.at(-2), h.at(-1), p) <= 0) h.pop(); h.push(p); } return h; };
    return [...half(sorted).slice(0, -1), ...half([...sorted].reverse()).slice(0, -1)];
}
export function bounds(points, mode = 'wall') {
    const grid = gridBounds(mode);
    if (!points?.length) return grid;
    return {minX: Math.max(grid.minX, Math.floor((Math.min(...points.map((p) => p.x)) - 50) / 50) * 50),
        maxX: Math.min(grid.maxX, Math.ceil((Math.max(...points.map((p) => p.x)) + 50) / 50) * 50),
        minY: Math.max(grid.minY, Math.floor((Math.min(...points.map((p) => p.y)) - 50) / 50) * 50),
        maxY: Math.min(grid.maxY, Math.ceil((Math.max(...points.map((p) => p.y)) + 50) / 50) * 50)};
}
