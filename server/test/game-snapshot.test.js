import test from 'node:test';
import assert from 'node:assert';
import { createWorld, addPlayer, snapshot } from '../game.js';

test('snapshot filters by view range and reports me + board', () => {
  const w = createWorld({ pellets: 0, viewRange: 500 });
  const me = addPlayer(w, { name: 'me' });
  const near = addPlayer(w, { name: 'near' });
  const far = addPlayer(w, { name: 'far' });
  me.x = me.y = 1000; near.x = near.y = 1200; far.x = far.y = 3900;
  w.pellets.push({ x: 1100, y: 1000, m: 1.5 }, { x: 3900, y: 3900, m: 1.5 });
  const s = snapshot(w, me.id);
  assert.strictEqual(s.me.id, me.id);
  const ids = s.cells.map((c) => c.id);
  assert.ok(ids.includes(me.id) && ids.includes(near.id) && !ids.includes(far.id));
  assert.strictEqual(s.pellets.length, 1);
  assert.strictEqual(s.board.length, 3);
  assert.ok(s.board[0].m >= s.board[1].m);
});

test('spectator snapshot centers on world middle with null me', () => {
  const w = createWorld({ pellets: 0, viewRange: 100 });
  const p = addPlayer(w, { name: 'a' });
  p.x = p.y = 2000;
  const s = snapshot(w, null);
  assert.strictEqual(s.me, null);
  assert.ok(s.cells.some((c) => c.id === p.id));
});
