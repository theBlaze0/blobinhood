import test from 'node:test';
import assert from 'node:assert';
import { createWorld, addPlayer, step, totalMass, defaults } from '../game.js';

test('world seeds 18 viruses inside bounds', () => {
  const w = createWorld({ pellets: 0 });
  assert.strictEqual(w.viruses.length, 18);
  for (const v of w.viruses) {
    assert.ok(v.x >= 0 && v.x <= defaults.world && v.y >= 0 && v.y <= defaults.world);
  }
});

test('cell >=115 popping a virus explodes into capped pieces, mass conserved +10', () => {
  const w = createWorld({ pellets: 0 });
  const p = addPlayer(w, { name: 'fat' });
  p.cells[0].m = 300;
  const v = w.viruses[0];
  p.cells[0].x = v.x; p.cells[0].y = v.y;
  p.tx = v.x; p.ty = v.y;
  const events = step(w, 16);
  assert.ok(events.some((e) => e.t === 'pop' && e.id === p.id));
  assert.ok(p.cells.length >= 2 && p.cells.length <= defaults.maxCells);
  assert.ok(Math.abs(totalMass(p) - 310) < 1e-6);
  assert.ok(p.cells.every((c) => c.mergeAt > 0));
  assert.strictEqual(w.viruses.length, 18); // replaced elsewhere
});

test('cell under 115 is safe next to a virus', () => {
  const w = createWorld({ pellets: 0 });
  const p = addPlayer(w, { name: 'small' });
  p.cells[0].m = 100;
  const v = w.viruses[0];
  p.cells[0].x = v.x; p.cells[0].y = v.y;
  p.tx = v.x; p.ty = v.y;
  const events = step(w, 16);
  assert.ok(!events.some((e) => e.t === 'pop'));
  assert.strictEqual(p.cells.length, 1);
});

test('players get deterministic, distinct hues', () => {
  const w = createWorld({ pellets: 0 });
  const a = addPlayer(w, { name: 'a' });
  const b = addPlayer(w, { name: 'b' });
  assert.strictEqual(a.hue, Math.round((a.id * 137.508) % 360));
  assert.notStrictEqual(a.hue, b.hue);
});
