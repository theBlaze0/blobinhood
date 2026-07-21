# Blobin Hood v1.1 Split & Eject Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Spacebar splits the player's blob (multi-cell, auto-remerge), Q ejects small collectible blobs, per spec `2026-07-20-split-eject-design.md`.

**Architecture:** Refactor `server/game.js` so a player owns 1–8 `cells` (each `{x,y,m,vx,vy,mergeAt}`) steering toward a world-space aim point; split/eject are new pure functions; per-cell enemy eating with `fatal` only on last cell. Shell adds `split`/`eject` messages with rate limits; client adds keybinds, world-space aim, multi-cell + ejected rendering.

**Tech Stack:** unchanged (Node 22 ESM, `ws`, vanilla canvas client, `node --test`).

## Global Constraints

- Tuning (spec-pinned): `maxCells 8`, `minSplitMass 50`, `splitImpulse 28`, `minEjectMass 30`, `ejectCost 16`, `ejectMass 12`, `ejectImpulse 22`, `maxEjected 200`, `impulseDecay 0.92/tick(50ms)`, merge `min(20000, 12000 + preSplitMass·20)` ms.
- Aim is a world-space point clamped to `[0, world]`; every cell steers toward it.
- Sibling cells never eat each other; merge when both past `mergeAt` and centers closer than `max(rA, rB)`.
- Enemy eat per cell (1.25× / `dist < rA − rB/3`, 80% absorb); `dead` message only when victim's last cell dies.
- Rate limits: split ≥250 ms apart, eject ≥100 ms apart, aim unchanged.
- Run tests: `cd ~/blobinhood && node --test server/test/*.test.js`

---

### Task 1: Multi-cell refactor (movement, aim point, snapshot) — green baseline

**Files:**
- Modify: `server/game.js` (rewrite player/cell structure, `setTarget`, `step` movement/eating, `snapshot`, `creditBuy`)
- Modify: `server/test/game-world.test.js`, `server/test/game-step.test.js`, `server/test/game-snapshot.test.js` (adapt to cell shapes)

**Interfaces (produces):**
- `player = {id, name, addr, spawn, eats, deadUntil, tx, ty, cells:[{x,y,m,vx,vy,mergeAt}]}`
- `totalMass(p) -> Number` (exported); `setTarget(world,id,x,y)` stores clamped world-point `tx,ty`
- snapshot: `cells:[{pid,name,x,y,m}]` per-cell; `me:{id,x,y,m,dead,cells:[{x,y,m}]}` (centroid + total); `map.cells:[{id,x,y,m}]` per-player centroid/total; new top-level `ejected` array (in-view)
- `world.ejected = []` on create

- [ ] **Step 1: Adapt existing tests to the cell shape.** Key replacements (same assertions, new access paths):
  - `game-world.test.js`: `p.m` → `p.cells[0].m`; add `assert.strictEqual(p.cells.length, 1)` and `totalMass(p) === p.cells[0].m`.
  - `game-step.test.js`: `place(p,x,y)` → `const place=(p,x,y)=>{p.cells[0].x=x;p.cells[0].y=y;p.tx=x;p.ty=y;}`; mass reads/writes via `p.cells[0].m`; movement test uses `setTarget(w,p.id, 3000, 2000)` (a point) and asserts `p.cells[0].x > 2000`; eat test asserts `events.some(e=>e.t==='eat' && e.fatal)` for the single-cell victim.
  - `game-snapshot.test.js`: `s.cells.map(c=>c.id)` → `.map(c=>c.pid)`; `s.map.cells` entries keep `{id,x,y,m}` per player.
- [ ] **Step 2: Run tests — expect failures** (`node --test server/test/*.test.js`).
- [ ] **Step 3: Rewrite `server/game.js`** — full replacement of the affected functions:

```js
export const defaults = { /* previous values, plus: */
  maxCells: 8, minSplitMass: 50, splitImpulse: 28,
  minEjectMass: 30, ejectCost: 16, ejectMass: 12, ejectImpulse: 22,
  maxEjected: 200, impulseDecay: 0.92,
  mergeBaseMs: 12000, mergeMassMs: 20, mergeCapMs: 20000,
};

export const totalMass = (p) => p.cells.reduce((s, c) => s + c.m, 0);
const centroidOf = (p) => {
  const t = totalMass(p) || 1;
  return { x: p.cells.reduce((s, c) => s + c.x * c.m, 0) / t,
           y: p.cells.reduce((s, c) => s + c.y * c.m, 0) / t };
};

// createWorld: add `ejected: []` to the returned object.

export function addPlayer(world, { name, addr = null, balance = 0 }) {
  const c = world.cfg;
  const m = spawnMass(balance, c);
  const x = Math.random() * c.world, y = Math.random() * c.world;
  const p = { id: world.nextId++, name: String(name || 'blob').slice(0, 16), addr,
              spawn: m, eats: 0, deadUntil: 0, tx: x, ty: y,
              cells: [{ x, y, m, vx: 0, vy: 0, mergeAt: 0 }] };
  world.players.set(p.id, p);
  return p;
}

export function setTarget(world, id, x, y) {
  const p = world.players.get(id);
  if (!p || !Number.isFinite(x) || !Number.isFinite(y)) return;
  p.tx = Math.max(0, Math.min(world.cfg.world, x));
  p.ty = Math.max(0, Math.min(world.cfg.world, y));
}

export function creditBuy(world, addr, mass) {
  if (!addr) return null;
  for (const p of world.players.values()) {
    if (p.addr && p.addr.toLowerCase() === addr.toLowerCase() && !p.deadUntil) {
      p.cells.sort((a, b) => b.m - a.m)[0].m += mass;
      return p;
    }
  }
  return null;
}

export function step(world, dtMs) {
  const c = world.cfg, dt = Math.min(dtMs, 100) / 1000, ticks = Math.min(dtMs, 100) / 50;
  world.time += dtMs;
  const events = [];
  const alive = [...world.players.values()].filter((p) => !p.deadUntil);

  for (const p of alive) for (const cell of p.cells) {
    const dx = p.tx - cell.x, dy = p.ty - cell.y, dist = Math.hypot(dx, dy);
    if (dist > 3) {
      const v = Math.min(speed(cell.m, c) * dt, dist);
      cell.x += (dx / dist) * v; cell.y += (dy / dist) * v;
    }
    cell.x += cell.vx * ticks; cell.y += cell.vy * ticks;
    cell.vx *= Math.pow(c.impulseDecay, ticks); cell.vy *= Math.pow(c.impulseDecay, ticks);
    cell.x = Math.max(0, Math.min(c.world, cell.x));
    cell.y = Math.max(0, Math.min(c.world, cell.y));
  }

  // sibling push-apart / merge
  for (const p of alive) {
    for (let i = 0; i < p.cells.length; i++) for (let j = i + 1; j < p.cells.length; j++) {
      const a = p.cells[i], b = p.cells[j];
      if (a.gone || b.gone) continue;
      const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1;
      const rA = radius(a.m), rB = radius(b.m);
      if (world.time >= a.mergeAt && world.time >= b.mergeAt && d < Math.max(rA, rB)) {
        const t = a.m + b.m;
        a.x = (a.x * a.m + b.x * b.m) / t; a.y = (a.y * a.m + b.y * b.m) / t;
        a.m = t; b.gone = true;
      } else if (d < rA + rB) {
        const push = (rA + rB - d) / d * 0.5;
        a.x -= dx * push * 0.5; a.y -= dy * push * 0.5;
        b.x += dx * push * 0.5; b.y += dy * push * 0.5;
      }
    }
    p.cells = p.cells.filter((x) => !x.gone);
  }

  // pellets / gold / ejected pickup per cell
  for (const p of alive) for (const cell of p.cells) {
    const r = radius(cell.m);
    for (let i = world.pellets.length - 1; i >= 0; i--) {
      const q = world.pellets[i];
      if (Math.hypot(cell.x - q.x, cell.y - q.y) < r) { cell.m += q.m; world.pellets[i] = { x: Math.random() * c.world, y: Math.random() * c.world, m: c.pelletMass }; }
    }
    for (let i = world.gold.length - 1; i >= 0; i--) {
      const q = world.gold[i];
      if (Math.hypot(cell.x - q.x, cell.y - q.y) < r) { cell.m += q.m; world.gold.splice(i, 1); }
    }
    for (let i = world.ejected.length - 1; i >= 0; i--) {
      const q = world.ejected[i];
      if (Math.hypot(cell.x - q.x, cell.y - q.y) < r) { cell.m += q.m; world.ejected.splice(i, 1); }
    }
  }

  // ejected blob physics
  for (const e of world.ejected) {
    e.x = Math.max(0, Math.min(c.world, e.x + e.vx * ticks));
    e.y = Math.max(0, Math.min(c.world, e.y + e.vy * ticks));
    e.vx *= Math.pow(c.impulseDecay, ticks); e.vy *= Math.pow(c.impulseDecay, ticks);
  }

  // enemy eating, per cell
  const flat = [];
  for (const p of alive) for (const cell of p.cells) flat.push({ p, cell });
  flat.sort((a, b) => b.cell.m - a.cell.m);
  for (let i = 0; i < flat.length; i++) {
    const A = flat[i];
    if (A.cell.gone) continue;
    for (let j = i + 1; j < flat.length; j++) {
      const B = flat[j];
      if (B.cell.gone || A.p.id === B.p.id || A.cell.m < c.eatRatio * B.cell.m) continue;
      if (Math.hypot(A.cell.x - B.cell.x, A.cell.y - B.cell.y) < radius(A.cell.m) - radius(B.cell.m) / 3) {
        A.cell.m += c.absorb * B.cell.m; A.p.eats++;
        B.cell.gone = true;
        events.push({ t: 'eat', eater: A.p.id, eaten: B.p.id, fatal: false });
      }
    }
  }
  for (const p of alive) {
    if (!p.cells.some((x) => x.gone)) continue;
    p.cells = p.cells.filter((x) => !x.gone);
    if (p.cells.length === 0) {
      p.deadUntil = world.time + c.respawnMs;
      const last = events.filter((e) => e.t === 'eat' && e.eaten === p.id).pop();
      if (last) last.fatal = true;
    }
  }

  for (const p of world.players.values()) {
    if (p.deadUntil && world.time >= p.deadUntil) {
      p.deadUntil = 0;
      const x = Math.random() * c.world, y = Math.random() * c.world;
      p.cells = [{ x, y, m: p.spawn, vx: 0, vy: 0, mergeAt: 0 }];
      p.tx = x; p.ty = y;
      events.push({ t: 'respawn', id: p.id });
    }
  }
  return events;
}

export function snapshot(world, viewerId = null) {
  const c = world.cfg;
  const viewer = viewerId != null ? world.players.get(viewerId) : null;
  const vc = viewer && viewer.cells.length ? centroidOf(viewer) : { x: c.world / 2, y: c.world / 2 };
  const inView = (e) => Math.hypot(e.x - vc.x, e.y - vc.y) <= c.viewRange;
  const alive = [...world.players.values()].filter((p) => !p.deadUntil);
  const cells = [];
  for (const p of alive) for (const cell of p.cells) if (inView(cell)) cells.push({ pid: p.id, name: p.name, x: cell.x, y: cell.y, m: cell.m });
  return {
    me: viewer ? { id: viewer.id, x: vc.x, y: vc.y, m: totalMass(viewer), dead: !!viewer.deadUntil,
                   cells: viewer.cells.map((x) => ({ x: x.x, y: x.y, m: x.m })) } : null,
    cells,
    pellets: world.pellets.filter(inView),
    gold: world.gold.filter(inView),
    ejected: world.ejected.filter(inView),
    board: [...alive].sort((a, b) => totalMass(b) - totalMass(a)).slice(0, 10)
      .map((p) => ({ name: p.name, m: Math.round(totalMass(p)), eats: p.eats })),
    map: {
      cells: alive.map((p) => { const cc = centroidOf(p); return { id: p.id, x: Math.round(cc.x), y: Math.round(cc.y), m: Math.round(totalMass(p)) }; }),
      gold: world.gold.map((g) => ({ x: Math.round(g.x), y: Math.round(g.y) })),
    },
  };
}
```

(`spawnGoldPellet`, `goldMass`, `radius`, `speed`, `spawnMass`, `createWorld`+`ejected`, `removePlayer` unchanged apart from noted additions.)

- [ ] **Step 4: Run tests — all pass.**
- [ ] **Step 5: Commit** `git commit -am "refactor: multi-cell players with world-point aim"`

---

### Task 2: split() + merge

**Files:**
- Modify: `server/game.js`
- Test: `server/test/game-split.test.js` (new)

**Interfaces (produces):** `split(world, id) -> Number` (pieces created)

- [ ] **Step 1: Write the failing test**

```js
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
  split(w, p.id); split(w, p.id); split(w, p.id); // 2,4,8
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
  for (let t = 0; t < 25000; t += 100) { p.tx = 2000; p.ty = 2000; step(w, 100); }
  assert.strictEqual(p.cells.length, 1); // timers passed, converged, merged
  assert.ok(Math.abs(totalMass(p) - 100) < 1e-9);
});
```

- [ ] **Step 2: Run — fails** (`split` not exported).
- [ ] **Step 3: Implement**

```js
export function split(world, id) {
  const p = world.players.get(id);
  if (!p || p.deadUntil) return 0;
  const c = world.cfg;
  let made = 0;
  for (const cell of [...p.cells].sort((a, b) => b.m - a.m)) {
    if (p.cells.length >= c.maxCells) break;
    if (cell.m < c.minSplitMass) continue;
    const mergeMs = Math.min(c.mergeCapMs, c.mergeBaseMs + cell.m * c.mergeMassMs);
    const dx = p.tx - cell.x, dy = p.ty - cell.y, len = Math.hypot(dx, dy) || 1;
    cell.m /= 2;
    cell.mergeAt = world.time + mergeMs;
    p.cells.push({ x: cell.x, y: cell.y, m: cell.m,
                   vx: (dx / len) * c.splitImpulse, vy: (dy / len) * c.splitImpulse,
                   mergeAt: world.time + mergeMs });
    made++;
  }
  return made;
}
```

- [ ] **Step 4: Run — all pass.** **Step 5: Commit** `git commit -am "feat: spacebar split with auto-remerge"`

---

### Task 3: eject()

**Files:**
- Modify: `server/game.js`
- Test: `server/test/game-eject.test.js` (new)

**Interfaces (produces):** `eject(world, id) -> Number` (blobs fired)

- [ ] **Step 1: Write the failing test**

```js
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
  setTarget(w, a.id, 600, 500);
  eject(w, a.id);
  const blob = w.ejected[0];
  b.cells[0].x = blob.x; b.cells[0].y = blob.y; b.tx = blob.x; b.ty = blob.y;
  const before = b.cells[0].m;
  step(w, 50);
  assert.ok(b.cells[0].m >= before + 12 - 1e-9);
  assert.strictEqual(w.ejected.length, 0);
});
```

- [ ] **Step 2: Run — fails.** **Step 3: Implement**

```js
export function eject(world, id) {
  const p = world.players.get(id);
  if (!p || p.deadUntil) return 0;
  const c = world.cfg;
  let fired = 0;
  for (const cell of p.cells) {
    if (cell.m < c.minEjectMass) continue;
    const dx = p.tx - cell.x, dy = p.ty - cell.y, len = Math.hypot(dx, dy) || 1;
    cell.m -= c.ejectCost;
    world.ejected.push({ x: cell.x + (dx / len) * radius(cell.m), y: cell.y + (dy / len) * radius(cell.m),
                         m: c.ejectMass, vx: (dx / len) * c.ejectImpulse, vy: (dy / len) * c.ejectImpulse });
    fired++;
  }
  while (world.ejected.length > c.maxEjected) world.ejected.shift();
  return fired;
}
```

- [ ] **Step 4: Run — all pass.** **Step 5: Commit** `git commit -am "feat: Q ejects collectible blobs"`

---

### Task 4: Shell protocol — split/eject messages, rate limits, fatal-only death

**Files:**
- Modify: `server/index.js`
- Modify: `server/test/integration.test.js` (add protocol test)

- [ ] **Step 1: Add to the integration test**

```js
test('split and eject messages are accepted and rate-limited without crashing', async () => {
  const srv = startServer({ port: 0, domain: 'test', tokenAddress: '' });
  const port = await srv.ready;
  const a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => a.on('open', r));
  a.send(JSON.stringify({ t: 'join', name: 'alice' }));
  await once(a, 'joined');
  for (let i = 0; i < 20; i++) { a.send(JSON.stringify({ t: 'split' })); a.send(JSON.stringify({ t: 'eject' })); }
  const snap = await once(a, 'snap');
  assert.ok(snap.me.cells.length >= 1); // base mass 25 < 50: still one cell, no crash
  a.close(); await srv.close();
});
```

- [ ] **Step 2: Run — fails** (`snap.me.cells` undefined until Task 1 shell restart picks it up — verify red for the right reason).
- [ ] **Step 3: Implement in `server/index.js`:** client record gains `lastSplit: 0, lastEject: 0`; message handler adds:

```js
        } else if (m.t === 'split') {
          if (!c.playerId) return;
          const now = Date.now();
          if (now - c.lastSplit < 250) return;
          c.lastSplit = now;
          G.split(world, c.playerId);
        } else if (m.t === 'eject') {
          if (!c.playerId) return;
          const now = Date.now();
          if (now - c.lastEject < 100) return;
          c.lastEject = now;
          G.eject(world, c.playerId);
        }
```

and the tick loop's dead-notification becomes fatal-only:

```js
    for (const e of events) if (e.t === 'eat' && e.fatal) {
      for (const [ws, c] of clients) if (c.playerId === e.eaten) send(ws, { t: 'dead', respawnIn: world.cfg.respawnMs });
    }
```

- [ ] **Step 4: Run — all pass.** **Step 5: Commit** `git commit -am "feat: split/eject protocol with rate limits"`

---

### Task 5: Client — keybinds, world-space aim, multi-cell + ejected rendering

**Files:**
- Modify: `web/app.js`

- [ ] **Step 1: Implement.** Changes:
  - `state.cam = { x: 2000, y: 2000, zoom: 0.5 }` — updated inside `draw()` after computing `camX/camY/zoom`.
  - Aim sends world coords: `sendWhenReady({ t: 'aim', x: state.cam.x + (cx - canvas.width/2)/state.cam.zoom, y: state.cam.y + (cy - canvas.height/2)/state.cam.zoom })` (keep the 50 ms throttle; store last mouse position and ALSO resend on each snap so a stationary cursor still steers).
  - Keys:
    ```js
    addEventListener('keydown', (e) => {
      if (!state.playing || document.activeElement === $('name')) return;
      if (e.code === 'Space') { e.preventDefault(); sendWhenReady({ t: 'split' }); }
      if (e.code === 'KeyQ') sendWhenReady({ t: 'eject' });
    });
    ```
  - Render `cur.ejected` (bright `#7cffb0` dots, r 4) between pellets and gold.
  - Cell ownership check becomes `c.pid === state.myId`; name labels drawn once per player (on that player's largest in-view cell) to avoid 8 duplicate labels.
  - Camera: `me.x/me.y` (already the centroid), zoom from `me.m` (total) as before.
  - Leaderboard `me` highlight: compare `r.name === nameOf(state.myId)` still works — `nameOf` now finds by `pid`.
- [ ] **Step 2: Visual verify** with bots (aim at random world points every few seconds: `{t:'aim', x: Math.random()*4000, y: Math.random()*4000}`) + CDP probe screenshots: one normal view, one after `?autoplay=me` with a scripted `{t:'split'}` sent via `state.ws.send` through Runtime.evaluate — expect two "me" pieces.
- [ ] **Step 3: Commit** `git commit -am "feat: client split/eject keys, world-point aim, ejected rendering"`

---

### Task 6: README, full verify, merge, deploy

- [ ] **Step 1:** README gameplay table gains rows: split (Space, ≥50 mass, 8 cap, merge `12s+m·20ms` cap 20s), eject (Q, −16/+12, anyone collects).
- [ ] **Step 2:** Full suite green; wallet-safety grep gate still clean (`grep -o "method: '[a-zA-Z_]*'" web/app.js | sort -u` → exactly the two).
- [ ] **Step 3:** Merge to master, push GitHub, `bash deploy/deploy.sh`, verify `https://blobinhood.online/health` (or via `--resolve` if DNS not yet set) and `/commit` shows the new hash.
