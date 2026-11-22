import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalize, addZone, esc, envelope, cellAt, cellOrigin, bounds, maskSet, maskHas} from '../public/model.js';
test('new rooms start empty and zone IDs remain stable after deletion', () => {
 const a=normalize(null),b=normalize(null); assert.equal(a.zones.length,0); addZone(a); addZone(a); assert.equal(b.zones.length,0);
 a.zones.splice(0,1); assert.equal(a.zones[0].id,2); assert.equal(addZone(a).id,1);
});
test('legacy layouts retain their cells and unsafe names are escaped',()=>{
 const cells='80'+'00'.repeat(39);const a=normalize({zones:[{id:3,name:'<img src=x>',cells,delay:4}]});assert.equal(a.zones[0].cells,cells);assert.equal(esc(a.zones[0].name),'&lt;img src=x&gt;');
 assert.equal(maskHas(maskSet(cells,8,true),8),true);assert.equal(cellAt(0,0),8);
});
test('walk envelope uses supported coordinates and keeps hardware grid fixed',()=>{
 const e=envelope([{x:0,y:0},{x:100,y:0},{x:100,y:100},{x:0,y:100},{x:50,y:50},{x:900,y:100}]);assert.equal(e.length,4);
});

test('ceiling grid is centred on the sensor and matches occupancy measured on hardware', () => {
    assert.equal(cellAt(0, 0, 'ceiling'), 10 * 16 + 8);
    assert.equal(cellAt(0, -1, 'ceiling'), 9 * 16 + 8);
    assert.equal(cellAt(0, -500, 'ceiling'), 8);
    assert.equal(cellAt(0, 500, 'ceiling'), null);
    assert.equal(cellAt(0, -1), null);
    for (const mode of ['wall', 'ceiling']) {
        for (let bit = 0; bit < 320; bit++) {
            const o = cellOrigin(bit, mode);
            assert.equal(cellAt(o.x + 25, o.y + 25, mode), bit);
        }
    }
    // Test zones written to a ceiling-mounted FP400: rows 0-9 and columns 0-7.
    const rows0to9 = 'ff'.repeat(20) + '00'.repeat(20), cols0to7 = 'ff00'.repeat(20);
    const occupied = (mask, x, y) => maskHas(mask, cellAt(x, y, 'ceiling'));
    assert.equal(occupied(rows0to9, 43, -245), true);
    assert.equal(occupied(rows0to9, 205, -20), true);
    assert.equal(occupied(rows0to9, 10, 110), false);
    assert.equal(occupied(rows0to9, -173, 12), false);
    assert.equal(occupied(cols0to7, 205, -20), true);
    assert.equal(occupied(cols0to7, 10, 110), true);
    assert.equal(occupied(cols0to7, -173, 12), false);
});

test('ceiling traces keep points behind the sensor and fit the centred grid', () => {
    const walk = [{x: -150, y: -300}, {x: 150, y: -300}, {x: 150, y: 120}, {x: -150, y: 120}];
    assert.equal(envelope(walk).length, 2);
    assert.equal(envelope(walk, 'ceiling').length, 4);
    assert.deepEqual(bounds(null, 'ceiling'), {minX: -400, maxX: 400, minY: -500, maxY: 500});
    assert.deepEqual(bounds(envelope(walk, 'ceiling'), 'ceiling'), {minX: -200, maxX: 200, minY: -350, maxY: 200});
});
