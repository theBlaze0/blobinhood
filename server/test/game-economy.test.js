import test from 'node:test';
import assert from 'node:assert';
import { createWorld, spawnGoldPellet, defaults } from '../game.js';

test('world.gold is capped, dropping oldest', () => {
  const w = createWorld({ pellets: 0 });
  for (let i = 0; i < defaults.maxGold + 50; i++) spawnGoldPellet(w, 10);
  assert.strictEqual(w.gold.length, defaults.maxGold);
});

test('maxGold is a sane bound', () => {
  assert.ok(defaults.maxGold >= 100 && defaults.maxGold <= 1000);
});
