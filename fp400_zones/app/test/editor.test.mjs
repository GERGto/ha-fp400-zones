import assert from 'node:assert/strict';
import {test} from 'node:test';
import {normalize, addZone, esc, envelope, cellAt, maskSet, maskHas} from '../public/model.js';
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
