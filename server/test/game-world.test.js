import test from 'node:test';
import assert from 'node:assert';
import { defaults, radius, speed, spawnMass, createWorld, addPlayer, removePlayer } from '../game.js';

test('spawnMass follows spec formula and cap', () => {
  assert.strictEqual(spawnMass(0, defaults), 25);
  assert.ok(Math.abs(spawnMass(10_000, defaults) - (25 + 12 * Math.log10(2))) < 1e-9);
  assert.strictEqual(spawnMass(1e15, defaults), 100); // capped 4×base
});

test('speed decreases with mass within clamps', () => {
  assert.ok(speed(25, defaults) > speed(100, defaults));
  assert.ok(speed(1e9, defaults) >= defaults.minSpeed);
  assert.ok(speed(1, defaults) <= defaults.maxSpeed);
});

test('createWorld seeds pellets inside bounds', () => {
  const w = createWorld();
  assert.strictEqual(w.pellets.length, defaults.pellets);
  for (const p of w.pellets) {
    assert.ok(p.x >= 0 && p.x <= defaults.world && p.y >= 0 && p.y <= defaults.world);
  }
});

test('addPlayer spawns alive at balance-derived mass; removePlayer deletes', () => {
  const w = createWorld();
  const p = addPlayer(w, { name: 'kris', addr: '0xab', balance: 10_000 });
  assert.ok(w.players.has(p.id));
  assert.ok(Math.abs(p.m - spawnMass(10_000, defaults)) < 1e-9);
  assert.strictEqual(p.deadUntil, 0);
  assert.strictEqual(p.eats, 0);
  removePlayer(w, p.id);
  assert.ok(!w.players.has(p.id));
});

test('radius grows with sqrt of mass', () => {
  assert.strictEqual(radius(25), 4 * 5);
});
