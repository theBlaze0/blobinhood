import test from 'node:test';
import assert from 'node:assert';
import { createWorld, addPlayer, snapshot } from '../game.js';

const place = (p, x, y) => { p.cells[0].x = x; p.cells[0].y = y; };

test('snapshot filters by view range and reports me + board', () => {
  const w = createWorld({ pellets: 0, viewRange: 500 });
  const me = addPlayer(w, { name: 'me' });
  const near = addPlayer(w, { name: 'near' });
  const far = addPlayer(w, { name: 'far' });
  place(me, 1000, 1000); place(near, 1200, 1200); place(far, 3900, 3900);
  w.pellets.push({ x: 1100, y: 1000, m: 1.5 }, { x: 3900, y: 3900, m: 1.5 });
  const s = snapshot(w, me.id);
  assert.strictEqual(s.me.id, me.id);
  assert.strictEqual(s.me.cells.length, 1);
  const pids = s.cells.map((c) => c.pid);
  assert.ok(pids.includes(me.id) && pids.includes(near.id) && !pids.includes(far.id));
  assert.strictEqual(s.pellets.length, 1);
  assert.strictEqual(s.board.length, 3);
  assert.ok(s.board[0].m >= s.board[1].m);
});

test('snapshot map layer covers the whole world regardless of view range', () => {
  const w = createWorld({ pellets: 0, viewRange: 100 });
  const a = addPlayer(w, { name: 'a' });
  const b = addPlayer(w, { name: 'b' });
  place(a, 100, 100); place(b, 3900, 3900);
  w.gold.push({ x: 2000, y: 2000, m: 50 });
  const s = snapshot(w, a.id);
  const ids = s.map.cells.map((c) => c.id);
  assert.ok(ids.includes(a.id) && ids.includes(b.id)); // far player still on map
  assert.strictEqual(s.map.gold.length, 1);
  assert.ok(!('name' in s.map.cells[0])); // map layer stays lightweight
});

test('spectator snapshot centers on world middle with null me; ejected included in view', () => {
  const w = createWorld({ pellets: 0, viewRange: 100 });
  const p = addPlayer(w, { name: 'a' });
  place(p, 2000, 2000);
  w.ejected.push({ x: 2010, y: 2000, m: 12, vx: 0, vy: 0 });
  const s = snapshot(w, null);
  assert.strictEqual(s.me, null);
  assert.ok(s.cells.some((c) => c.pid === p.id));
  assert.strictEqual(s.ejected.length, 1);
});
