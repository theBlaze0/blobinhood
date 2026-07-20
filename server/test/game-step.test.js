import test from 'node:test';
import assert from 'node:assert';
import { createWorld, addPlayer, setTarget, step, spawnGoldPellet, creditBuy, goldMass, radius } from '../game.js';

const place = (p, x, y) => { p.x = x; p.y = y; };

test('setTarget + step moves player toward target, clamped to bounds', () => {
  const w = createWorld({ pellets: 0 });
  const p = addPlayer(w, { name: 'a' });
  place(p, 2000, 2000);
  setTarget(w, p.id, 1, 0);
  step(w, 1000);
  assert.ok(p.x > 2000 && Math.abs(p.y - 2000) < 1e-9);
  place(p, 1, 2000); setTarget(w, p.id, -1, 0); step(w, 1000);
  assert.ok(p.x >= 0);
});

test('player eats pellet on contact and gains its mass', () => {
  const w = createWorld({ pellets: 1 });
  const p = addPlayer(w, { name: 'a' });
  w.pellets[0] = { x: 500, y: 500, m: 1.5 };
  place(p, 500, 500);
  const before = p.m;
  step(w, 16);
  assert.ok(Math.abs(p.m - (before + 1.5)) < 1e-9);
  assert.strictEqual(w.pellets.length, 1); // respawned elsewhere
});

test('bigger eats smaller at >=1.25x and 80% absorb; equal sizes do not eat', () => {
  const w = createWorld({ pellets: 0 });
  const big = addPlayer(w, { name: 'big' });
  const small = addPlayer(w, { name: 'small' });
  big.m = 40; small.m = 30; // 1.33x
  place(big, 1000, 1000); place(small, 1000, 1000);
  const events = step(w, 16);
  assert.ok(events.some((e) => e.t === 'eat' && e.eater === big.id && e.eaten === small.id));
  assert.ok(Math.abs(big.m - (40 + 0.8 * 30)) < 1e-9);
  assert.ok(small.deadUntil > 0);
  assert.strictEqual(big.eats, 1);

  const w2 = createWorld({ pellets: 0 });
  const a = addPlayer(w2, { name: 'a' }), b = addPlayer(w2, { name: 'b' });
  a.m = 30; b.m = 30; place(a, 1000, 1000); place(b, 1000, 1000);
  assert.strictEqual(step(w2, 16).filter((e) => e.t === 'eat').length, 0);
});

test('dead player respawns at spawn mass after respawnMs', () => {
  const w = createWorld({ pellets: 0 });
  const big = addPlayer(w, { name: 'big' }), small = addPlayer(w, { name: 'small' });
  big.m = 40; small.m = 30;
  place(big, 1000, 1000); place(small, 1000, 1000);
  step(w, 16);
  const events = step(w, 3000);
  assert.ok(events.some((e) => e.t === 'respawn' && e.id === small.id));
  assert.strictEqual(small.m, small.spawn);
  assert.strictEqual(small.deadUntil, 0);
});

test('gold pellets and creditBuy', () => {
  const w = createWorld({ pellets: 0 });
  const g = spawnGoldPellet(w, 50);
  assert.strictEqual(w.gold.length, 1);
  const p = addPlayer(w, { name: 'a', addr: '0xAbC' });
  place(p, g.x, g.y);
  const before = p.m;
  step(w, 16);
  assert.ok(Math.abs(p.m - (before + 50)) < 1e-9);
  assert.strictEqual(w.gold.length, 0);
  assert.strictEqual(creditBuy(w, '0xabc', 10), p); // case-insensitive
  assert.ok(Math.abs(p.m - (before + 60)) < 1e-9);
  assert.strictEqual(creditBuy(w, '0xdead', 10), null);
});

test('goldMass follows spec formula', () => {
  assert.ok(Math.abs(goldMass(0.001) - (10 + 30 * Math.log10(2))) < 1e-9);
  assert.strictEqual(goldMass(1e9), 120);
});
