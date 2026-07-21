import test from 'node:test';
import assert from 'node:assert';
import { createWorld, addPlayer, eject, step, setTarget } from '../game.js';

test('eject pays 16, spawns a 12-mass blob toward the target', () => {
  const w = createWorld({ pellets: 0 });
  const p = addPlayer(w, { name: 'a' });
  p.cells[0].m = 100; p.cells[0].x = 2000; p.cells[0].y = 2000;
  setTarget(w, p.id, 3000, 2000);
  assert.strictEqual(eject(w, p.id), 1);
  assert.ok(Math.abs(p.cells[0].m - 84) < 1e-9);
  assert.strictEqual(w.ejected.length, 1);
  assert.strictEqual(w.ejected[0].m, 12);
  assert.ok(w.ejected[0].vx > 0);
});

test('cells under mass 30 cannot eject; cap 200 drops oldest', () => {
  const w = createWorld({ pellets: 0 });
  const p = addPlayer(w, { name: 'a' });
  p.cells[0].m = 29;
  assert.strictEqual(eject(w, p.id), 0);
  p.cells[0].m = 1e9;
  for (let i = 0; i < 205; i++) eject(w, p.id);
  assert.strictEqual(w.ejected.length, 200);
});

test('another player collects an ejected blob', () => {
  const w = createWorld({ pellets: 0 });
  const a = addPlayer(w, { name: 'a' }), b = addPlayer(w, { name: 'b' });
  a.cells[0].m = 100; a.cells[0].x = 500; a.cells[0].y = 500;
  b.cells[0].x = 3900; b.cells[0].y = 3900; b.tx = 3900; b.ty = 3900;
  setTarget(w, a.id, 600, 500);
  eject(w, a.id);
  setTarget(w, a.id, 500, 500); // ejector stays put
  for (let i = 0; i < 40; i++) step(w, 50); // blob impulse decays to rest ~275 units away
  const blob = w.ejected[0];
  b.cells[0].x = blob.x; b.cells[0].y = blob.y; b.tx = blob.x; b.ty = blob.y;
  const before = b.cells[0].m;
  step(w, 50);
  assert.ok(b.cells[0].m >= before + 12 - 1e-9);
  assert.strictEqual(w.ejected.length, 0);
});
