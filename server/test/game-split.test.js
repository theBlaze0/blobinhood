import test from 'node:test';
import assert from 'node:assert';
import { createWorld, addPlayer, split, step, totalMass, setTarget } from '../game.js';

test('split halves each eligible cell toward the aim point, sets merge timers', () => {
  const w = createWorld({ pellets: 0 });
  const p = addPlayer(w, { name: 'a' });
  p.cells[0].m = 80; p.cells[0].x = 2000; p.cells[0].y = 2000;
  setTarget(w, p.id, 3000, 2000);
  assert.strictEqual(split(w, p.id), 1);
  assert.strictEqual(p.cells.length, 2);
  assert.ok(Math.abs(p.cells[0].m - 40) < 1e-9 && Math.abs(p.cells[1].m - 40) < 1e-9);
  assert.ok(p.cells[1].vx > 0 && Math.abs(p.cells[1].vy) < 1e-9); // launched toward target
  const expectMerge = Math.min(20000, 12000 + 80 * 20);
  assert.strictEqual(p.cells[0].mergeAt, expectMerge);
  assert.strictEqual(totalMass(p), 80);
});

test('split respects mass floor and 8-piece cap', () => {
  const w = createWorld({ pellets: 0 });
  const p = addPlayer(w, { name: 'a' });
  p.cells[0].m = 49;
  assert.strictEqual(split(w, p.id), 0);
  p.cells[0].m = 6400;
  split(w, p.id); split(w, p.id); split(w, p.id); // 2, 4, 8
  assert.strictEqual(p.cells.length, 8);
  assert.strictEqual(split(w, p.id), 0); // capped
});

test('siblings push apart pre-merge, merge after both timers pass', () => {
  const w = createWorld({ pellets: 0 });
  const p = addPlayer(w, { name: 'a' });
  p.cells[0].m = 100; p.cells[0].x = 2000; p.cells[0].y = 2000;
  setTarget(w, p.id, 2100, 2000);
  split(w, p.id);
  step(w, 50);
  assert.strictEqual(p.cells.length, 2); // no self-eat, no instant merge
  for (let t = 0; t < 25000; t += 100) { setTarget(w, p.id, 2000, 2000); step(w, 100); }
  assert.strictEqual(p.cells.length, 1); // timers passed, converged, merged
  assert.ok(Math.abs(totalMass(p) - 100) < 1e-9);
});
