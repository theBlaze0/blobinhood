# Blobin Hood Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Playable agar.io mirror for the user's Pons coin on Robinhood Chain — wallet balance sets spawn size, live buys drop golden pellets; cosmetic stakes only, trust-first wallet flow.

**Architecture:** Authoritative Node game server (pure simulation in `server/game.js`, websocket/SIWE/chain shell in `server/index.js`) + dependency-free static canvas client (`web/index.html`). ESM throughout; unit tests with `node --test`.

**Tech Stack:** Node 22, `ws`, `@noble/curves`, `@noble/hashes` (server only). Vanilla JS canvas client. No build step.

## Global Constraints

- Chain: id 4663, RPC `https://rpc.mainnet.chain.robinhood.com`, WETH `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, V3 factory `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`, fee `10000`, Swap topic0 `0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67`.
- Wallet calls allowed in client code: `eth_requestAccounts`, `personal_sign`. NOTHING else — grep must never find `eth_sendTransaction`/`signTypedData`/approve.
- Gameplay constants (spec-pinned): world 4000×4000, cap 50 players, 600 pellets, eat at ≥1.25× mass with 80% absorb, respawn 3000 ms, spawn mass `min(100, 25 + 12·log10(1+balance/10000))`, gold pellet mass `min(120, 10 + 30·log10(1+eth/0.001))`.
- SIWE statement (verbatim, in message and UI): "This signature only proves wallet ownership. It costs nothing, sends nothing, and grants this site no access to your funds."
- Env config: `PORT` (default 8790), `DOMAIN` (SIWE binding, default `localhost:8790`), `TOKEN_ADDRESS` (empty = pre-launch: no balance reads, no buy watcher).
- Run tests: `cd ~/blobinhood && node --test server/test/*.test.js`

---

### Task 1: Scaffold + world/pellets/spawn-mass (pure sim, part 1)

**Files:**
- Create: `package.json`, `server/game.js`, `server/test/game-world.test.js`, `.gitignore`

**Interfaces (produces):**
- `defaults` config object; `radius(mass)`; `speed(mass, cfg)`; `spawnMass(balance, cfg)`
- `createWorld(cfg?) -> world`; `addPlayer(world, {name, addr, balance}) -> player`; `removePlayer(world, id)`

- [ ] **Step 1: Scaffold**

```json
// package.json
{
  "name": "blobinhood",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": { "test": "node --test server/test/*.test.js", "start": "node server/index.js" },
  "dependencies": {
    "ws": "^8.18.0",
    "@noble/curves": "^1.6.0",
    "@noble/hashes": "^1.5.0"
  }
}
```

`.gitignore`: `node_modules/`. Run `npm install` (creates package-lock.json — commit it).

- [ ] **Step 2: Write the failing test**

```js
// server/test/game-world.test.js
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `node --test server/test/*.test.js` — Expected: FAIL (game.js missing)

- [ ] **Step 4: Implement**

```js
// server/game.js — pure simulation. No I/O, no timers, no randomness beyond Math.random.
export const defaults = {
  world: 4000, maxPlayers: 50,
  pellets: 600, pelletMass: 1.5,
  baseMass: 25, massK: 12, maxSpawnFactor: 4,
  eatRatio: 1.25, absorb: 0.8, respawnMs: 3000,
  speedS: 400, speedExp: 0.32, minSpeed: 18, maxSpeed: 160,
  viewRange: 1200,
};

export const radius = (m) => 4 * Math.sqrt(m);
export const speed = (m, c = defaults) =>
  Math.max(c.minSpeed, Math.min(c.maxSpeed, c.speedS / Math.pow(m, c.speedExp)));
export const spawnMass = (balance, c = defaults) =>
  Math.min(c.baseMass * c.maxSpawnFactor, c.baseMass + c.massK * Math.log10(1 + (balance || 0) / 10_000));

const rnd = (n) => Math.random() * n;
const newPellet = (c) => ({ x: rnd(c.world), y: rnd(c.world), m: c.pelletMass });

export function createWorld(cfg = {}) {
  const c = { ...defaults, ...cfg };
  return {
    cfg: c, time: 0, nextId: 1,
    players: new Map(),
    pellets: Array.from({ length: c.pellets }, () => newPellet(c)),
    gold: [],
  };
}

export function addPlayer(world, { name, addr = null, balance = 0 }) {
  const c = world.cfg;
  const m = spawnMass(balance, c);
  const p = {
    id: world.nextId++, name: String(name || 'blob').slice(0, 16), addr,
    x: rnd(c.world), y: rnd(c.world), dx: 0, dy: 0,
    m, spawn: m, eats: 0, deadUntil: 0,
  };
  world.players.set(p.id, p);
  return p;
}

export const removePlayer = (world, id) => world.players.delete(id);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test server/test/*.test.js` — Expected: 5 pass

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: world scaffold, spawn-mass and speed math"
```

---

### Task 2: step() — movement, pellet/gold/player eating, respawn (pure sim, part 2)

**Files:**
- Modify: `server/game.js`
- Test: `server/test/game-step.test.js`

**Interfaces (produces):**
- `setTarget(world, id, x, y)` (unit-vector direction; non-finite ignored)
- `step(world, dtMs)` — advances sim; returns `events` array like `{t:'eat', eater, eaten}` / `{t:'respawn', id}`
- `spawnGoldPellet(world, mass) -> pellet`; `creditBuy(world, addr, mass) -> player|null`; `goldMass(eth)`

- [ ] **Step 1: Write the failing test**

```js
// server/test/game-step.test.js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test server/test/*.test.js` — Expected: step tests FAIL

- [ ] **Step 3: Implement** (append to `server/game.js`)

```js
export function setTarget(world, id, x, y) {
  const p = world.players.get(id);
  if (!p || !Number.isFinite(x) || !Number.isFinite(y)) return;
  const len = Math.hypot(x, y) || 1;
  p.dx = x / len; p.dy = y / len;
}

export const goldMass = (eth) => Math.min(120, 10 + 30 * Math.log10(1 + eth / 0.001));

export function spawnGoldPellet(world, mass) {
  const g = { x: Math.random() * world.cfg.world, y: Math.random() * world.cfg.world, m: mass };
  world.gold.push(g);
  return g;
}

export function creditBuy(world, addr, mass) {
  if (!addr) return null;
  for (const p of world.players.values()) {
    if (p.addr && p.addr.toLowerCase() === addr.toLowerCase() && !p.deadUntil) { p.m += mass; return p; }
  }
  return null;
}

export function step(world, dtMs) {
  const c = world.cfg, dt = Math.min(dtMs, 100) / 1000;
  world.time += dtMs;
  const events = [];
  const alive = [...world.players.values()].filter((p) => !p.deadUntil);

  for (const p of alive) {
    const v = speed(p.m, c) * dt;
    p.x = Math.max(0, Math.min(c.world, p.x + p.dx * v));
    p.y = Math.max(0, Math.min(c.world, p.y + p.dy * v));
    const r = radius(p.m);
    for (let i = world.pellets.length - 1; i >= 0; i--) {
      const q = world.pellets[i];
      if (Math.hypot(p.x - q.x, p.y - q.y) < r) { p.m += q.m; world.pellets[i] = { x: Math.random() * c.world, y: Math.random() * c.world, m: c.pelletMass }; }
    }
    for (let i = world.gold.length - 1; i >= 0; i--) {
      const q = world.gold[i];
      if (Math.hypot(p.x - q.x, p.y - q.y) < r) { p.m += q.m; world.gold.splice(i, 1); }
    }
  }

  alive.sort((a, b) => b.m - a.m);
  for (let i = 0; i < alive.length; i++) {
    const a = alive[i];
    if (a.deadUntil) continue;
    for (let j = i + 1; j < alive.length; j++) {
      const b = alive[j];
      if (b.deadUntil || a.m < c.eatRatio * b.m) continue;
      if (Math.hypot(a.x - b.x, a.y - b.y) < radius(a.m) - radius(b.m) / 3) {
        a.m += c.absorb * b.m; a.eats++;
        b.deadUntil = world.time + c.respawnMs;
        events.push({ t: 'eat', eater: a.id, eaten: b.id });
      }
    }
  }

  for (const p of world.players.values()) {
    if (p.deadUntil && world.time >= p.deadUntil) {
      p.deadUntil = 0; p.m = p.spawn;
      p.x = Math.random() * c.world; p.y = Math.random() * c.world;
      events.push({ t: 'respawn', id: p.id });
    }
  }
  return events;
}
```

- [ ] **Step 4: Run test to verify it passes** — Expected: all pass
- [ ] **Step 5: Commit** — `git add -A && git commit -m "feat: simulation step with eat/respawn/gold"`

---

### Task 3: snapshot() — per-viewer state filtering + leaderboard

**Files:**
- Modify: `server/game.js`
- Test: `server/test/game-snapshot.test.js`

**Interfaces (produces):**
- `snapshot(world, viewerId|null) -> {me, cells, pellets, gold, board}` — entities within `cfg.viewRange` of viewer (or world center for spectators); `me = {id,x,y,m,dead}` or null; `board` = top-10 `{name, m, eats}` by mass.

- [ ] **Step 1: Write the failing test**

```js
// server/test/game-snapshot.test.js
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
```

- [ ] **Step 2: Run to verify it fails**, then **Step 3: Implement** (append):

```js
export function snapshot(world, viewerId = null) {
  const c = world.cfg;
  const viewer = viewerId != null ? world.players.get(viewerId) : null;
  const cx = viewer ? viewer.x : c.world / 2, cy = viewer ? viewer.y : c.world / 2;
  const inView = (e) => Math.hypot(e.x - cx, e.y - cy) <= c.viewRange;
  const alive = [...world.players.values()].filter((p) => !p.deadUntil);
  return {
    me: viewer ? { id: viewer.id, x: viewer.x, y: viewer.y, m: viewer.m, dead: !!viewer.deadUntil } : null,
    cells: alive.filter(inView).map((p) => ({ id: p.id, name: p.name, x: p.x, y: p.y, m: p.m })),
    pellets: world.pellets.filter(inView),
    gold: world.gold.filter(inView),
    board: [...alive].sort((a, b) => b.m - a.m).slice(0, 10).map((p) => ({ name: p.name, m: Math.round(p.m), eats: p.eats })),
  };
}
```

- [ ] **Step 4: Run tests — all pass.** **Step 5: Commit** `git commit -am "feat: view-filtered snapshots and leaderboard"`

---

### Task 4: SIWE module — message build + personal_sign verification

**Files:**
- Create: `server/siwe.js`
- Test: `server/test/siwe.test.js`

**Interfaces (produces):**
- `buildMessage({domain, address, nonce, issuedAt}) -> string` (EIP-4361 layout incl. the verbatim trust statement)
- `verify(message, sigHex, expectedAddr) -> boolean` (recovers signer of personal_sign over the message)
- `randomNonce() -> hex string (16 bytes)`

- [ ] **Step 1: Write the failing test** (fixtures generated with noble itself — signs exactly like a wallet's personal_sign)

```js
// server/test/siwe.test.js
import test from 'node:test';
import assert from 'node:assert';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { buildMessage, verify, randomNonce } from '../siwe.js';

const priv = new Uint8Array(32).fill(7);
const pub = secp256k1.getPublicKey(priv, false);
const addr = '0x' + Buffer.from(keccak_256(pub.slice(1)).slice(-20)).toString('hex');

function personalSign(msg, key) {
  const bytes = new TextEncoder().encode(msg);
  const prefix = new TextEncoder().encode('\x19Ethereum Signed Message:\n' + bytes.length);
  const digest = keccak_256(new Uint8Array([...prefix, ...bytes]));
  const sig = secp256k1.sign(digest, key);
  return '0x' + sig.toCompactHex() + (27 + sig.recovery).toString(16).padStart(2, '0');
}

test('buildMessage contains domain, address, nonce and the trust statement', () => {
  const m = buildMessage({ domain: 'blobinhood.io', address: addr, nonce: 'abc123', issuedAt: '2026-07-20T00:00:00Z' });
  for (const part of ['blobinhood.io', addr, 'abc123', 'costs nothing, sends nothing']) {
    assert.ok(m.includes(part), part);
  }
});

test('verify accepts a correct personal_sign signature', () => {
  const m = buildMessage({ domain: 'blobinhood.io', address: addr, nonce: randomNonce(), issuedAt: '2026-07-20T00:00:00Z' });
  assert.strictEqual(verify(m, personalSign(m, priv), addr), true);
});

test('verify rejects wrong signer and tampered message', () => {
  const m = buildMessage({ domain: 'blobinhood.io', address: addr, nonce: 'n', issuedAt: '2026-07-20T00:00:00Z' });
  const sig = personalSign(m, priv);
  assert.strictEqual(verify(m + 'x', sig, addr), false);
  assert.strictEqual(verify(m, sig, '0x' + '11'.repeat(20)), false);
  assert.strictEqual(verify(m, '0xdeadbeef', addr), false);
});

test('randomNonce is 32 hex chars and unique', () => {
  const a = randomNonce(), b = randomNonce();
  assert.match(a, /^[0-9a-f]{32}$/);
  assert.notStrictEqual(a, b);
});
```

- [ ] **Step 2: Run to verify fail**, then **Step 3: Implement**

```js
// server/siwe.js
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { randomBytes } from 'node:crypto';

export const STATEMENT =
  'This signature only proves wallet ownership. It costs nothing, sends nothing, and grants this site no access to your funds.';

export const randomNonce = () => randomBytes(16).toString('hex');

export function buildMessage({ domain, address, nonce, issuedAt }) {
  return `${domain} wants you to sign in with your Ethereum account:\n${address}\n\n${STATEMENT}\n\nURI: https://${domain}\nVersion: 1\nChain ID: 4663\nNonce: ${nonce}\nIssued At: ${issuedAt}`;
}

export function verify(message, sigHex, expectedAddr) {
  try {
    const raw = sigHex.replace(/^0x/, '');
    if (raw.length !== 130) return false;
    let v = parseInt(raw.slice(128), 16);
    if (v >= 27) v -= 27;
    const bytes = new TextEncoder().encode(message);
    const prefix = new TextEncoder().encode('\x19Ethereum Signed Message:\n' + bytes.length);
    const digest = keccak_256(new Uint8Array([...prefix, ...bytes]));
    const sig = secp256k1.Signature.fromCompact(raw.slice(0, 128)).addRecoveryBit(v);
    const pub = sig.recoverPublicKey(digest).toRawBytes(false);
    const got = '0x' + Buffer.from(keccak_256(pub.slice(1)).slice(-20)).toString('hex');
    return got.toLowerCase() === expectedAddr.toLowerCase();
  } catch { return false; }
}
```

- [ ] **Step 4: Run tests — all pass.** **Step 5: Commit** `git commit -am "feat: SIWE message + personal_sign verification"`

---

### Task 5: Chain module — balance reads + pool buy watcher

**Files:**
- Create: `server/chain.js`
- Test: `server/test/chain.test.js`

**Interfaces (produces):**
- Pure: `tokenIsToken0(token)`, `decodeSwap(log, tokenIs0)` (same semantics as pons-buys), `encBalanceOf(addr)`, `encGetPool(token)`
- Network: `rpc(method, params)`, `balanceOf(token, addr) -> Number (whole tokens)`, `resolvePool(token) -> address|null`, `startBuyWatcher({token, onBuy(t), intervalMs}) -> {stop()}` — resolves pool (retrying while unlaunched), then polls new Swap logs and calls `onBuy(trade)` for buys only; backoff on errors; never throws out.

- [ ] **Step 1: Write the failing test** (pure parts; network covered by Task 6 integration + Task 8 live run)

```js
// server/test/chain.test.js
import test from 'node:test';
import assert from 'node:assert';
import { tokenIsToken0, decodeSwap, encBalanceOf, CHAIN } from '../chain.js';

const W = (bi) => ((bi + (1n << 256n)) % (1n << 256n)).toString(16).padStart(64, '0');

test('decodeSwap classifies buy/sell from WETH direction', () => {
  const log = {
    topics: [CHAIN.swapTopic, '0x' + '0'.repeat(64), '0x' + '0'.repeat(24) + 'ab'.repeat(20)],
    data: '0x' + W(-5000n * 10n ** 18n) + W(2n * 10n ** 17n) + W(2n ** 96n) + W(0n) + W(0n),
    transactionHash: '0xt', blockNumber: '0x10', logIndex: '0x0',
  };
  const t = decodeSwap(log, true);
  assert.strictEqual(t.side, 'buy');
  assert.ok(Math.abs(t.eth - 0.2) < 1e-9);
  assert.strictEqual(t.buyer, '0x' + 'ab'.repeat(20));
});

test('tokenIsToken0 sorts against WETH', () => {
  assert.strictEqual(tokenIsToken0('0x0a' + '00'.repeat(19)), true);
  assert.strictEqual(tokenIsToken0('0xff' + '00'.repeat(19)), false);
});

test('encBalanceOf builds balanceOf(address) calldata', () => {
  assert.strictEqual(
    encBalanceOf('0x1111111111111111111111111111111111111111'),
    '0x70a082310000000000000000000000001111111111111111111111111111111111111111'
  );
});
```

- [ ] **Step 2: Run to verify fail**, then **Step 3: Implement**

```js
// server/chain.js — Robinhood Chain access. Read-only, raw JSON-RPC.
export const CHAIN = {
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  v3Factory: '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',
  feeTier: 10000,
  swapTopic: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
};

const pad32 = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const word = (data, i) => BigInt('0x' + data.slice(2 + i * 64, 2 + (i + 1) * 64));
const signed = (w) => (w >= 1n << 255n ? w - (1n << 256n) : w);
const hexBlock = (n) => '0x' + n.toString(16);

export const encBalanceOf = (addr) => '0x70a08231' + pad32(addr);
export const encGetPool = (token) => '0x1698ee82' + pad32(token) + pad32(CHAIN.weth) + pad32(CHAIN.feeTier.toString(16));
export const tokenIsToken0 = (token) => token.toLowerCase() < CHAIN.weth.toLowerCase();

export function decodeSwap(log, tokenIs0) {
  const a0 = signed(word(log.data, 0)), a1 = signed(word(log.data, 1));
  const weth = tokenIs0 ? a1 : a0;
  const abs = (n) => (n < 0n ? -n : n);
  return {
    side: weth > 0n ? 'buy' : 'sell',
    eth: Number(abs(weth)) / 1e18,
    buyer: '0x' + log.topics[2].slice(-40).toLowerCase(),
    tx: log.transactionHash, block: parseInt(log.blockNumber, 16), logIndex: parseInt(log.logIndex, 16),
  };
}

let rpcId = 1;
export async function rpc(method, params = []) {
  const res = await fetch(CHAIN.rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'rpc error');
  return body.result;
}

export async function balanceOf(token, addr) {
  const ret = await rpc('eth_call', [{ to: token, data: encBalanceOf(addr) }, 'latest']);
  return Number(word(ret, 0) / 10n ** 15n) / 1000; // whole tokens (18 decimals)
}

export async function resolvePool(token) {
  const ret = await rpc('eth_call', [{ to: CHAIN.v3Factory, data: encGetPool(token) }, 'latest']);
  const pool = '0x' + ret.slice(-40);
  return /^0x0{40}$/.test(pool) ? null : pool;
}

export function startBuyWatcher({ token, onBuy, intervalMs = 3000 }) {
  let stopped = false, pool = null, from = null, backoff = intervalMs;
  const is0 = tokenIsToken0(token);
  const tick = async () => {
    if (stopped) return;
    try {
      if (!pool) {
        pool = await resolvePool(token);
        if (pool) from = (await rpc('eth_blockNumber').then((h) => parseInt(h, 16))) + 1;
      } else {
        const head = parseInt(await rpc('eth_blockNumber'), 16);
        if (head >= from) {
          const logs = await rpc('eth_getLogs', [{ address: pool, topics: [CHAIN.swapTopic], fromBlock: hexBlock(from), toBlock: hexBlock(head) }]);
          for (const l of logs) {
            const t = decodeSwap(l, is0);
            if (t.side === 'buy') onBuy(t);
          }
          from = head + 1;
        }
      }
      backoff = intervalMs;
    } catch { backoff = Math.min(backoff * 2, 30000); }
    setTimeout(tick, backoff);
  };
  setTimeout(tick, 0);
  return { stop: () => { stopped = true; } };
}
```

- [ ] **Step 4: Run tests — all pass.** Also smoke live: `node -e "import('./server/chain.js').then(async c=>{console.log(await c.rpc('eth_blockNumber'))})"` — prints a hex block.
- [ ] **Step 5: Commit** `git commit -am "feat: chain module — balance reads and buy watcher"`

---

### Task 6: Server shell — websockets, join flow, tick/broadcast

**Files:**
- Create: `server/index.js`
- Test: `server/test/integration.test.js`

**Interfaces (produces):**
- `startServer({port, domain, tokenAddress}) -> {close()}` (exported; `server/index.js` run directly calls it with env). Static files from `web/` + `/ws` websocket endpoint + `/health`.
- Protocol per spec: C→S `hello|nonce|join|aim`; S→C `nonce|joined|snap|dead|err`.

- [ ] **Step 1: Write the failing integration test**

```js
// server/test/integration.test.js
import test from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { startServer } from '../index.js';

const once = (ws, type) => new Promise((res, rej) => {
  const h = (raw) => { const m = JSON.parse(raw); if (m.t === type) { ws.off('message', h); res(m); } if (m.t === 'err') rej(new Error(m.msg)); };
  ws.on('message', h);
  setTimeout(() => rej(new Error('timeout waiting ' + type)), 5000);
});

test('two anonymous players join, aim, and appear in snapshots', async () => {
  const srv = startServer({ port: 0, domain: 'test', tokenAddress: '' });
  const port = await srv.ready;
  const a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await Promise.all([new Promise((r) => a.on('open', r)), new Promise((r) => b.on('open', r))]);

  a.send(JSON.stringify({ t: 'join', name: 'alice' }));
  const ja = await once(a, 'joined');
  b.send(JSON.stringify({ t: 'join', name: 'bob' }));
  await once(b, 'joined');

  a.send(JSON.stringify({ t: 'aim', x: 1, y: 0 }));
  const snap = await once(a, 'snap');
  assert.ok(snap.me && snap.me.id === ja.id);
  assert.ok(snap.board.length >= 2);

  a.close(); b.close(); await srv.close();
});

test('spectator hello receives snapshots with null me', async () => {
  const srv = startServer({ port: 0, domain: 'test', tokenAddress: '' });
  const port = await srv.ready;
  const s = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  await new Promise((r) => s.on('open', r));
  s.send(JSON.stringify({ t: 'hello' }));
  const snap = await once(s, 'snap');
  assert.strictEqual(snap.me, null);
  s.close(); await srv.close();
});
```

- [ ] **Step 2: Run to verify fail**, then **Step 3: Implement**

```js
// server/index.js
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as G from './game.js';
import { buildMessage, verify, randomNonce } from './siwe.js';
import { balanceOf, startBuyWatcher } from './chain.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
let COMMIT = 'dev'; try { COMMIT = execSync('git rev-parse --short HEAD', { cwd: WEB }).toString().trim(); } catch {}

export function startServer({ port = 8790, domain = 'localhost:8790', tokenAddress = '' } = {}) {
  const world = G.createWorld();
  const nonces = new Map(); // addrLower -> {nonce, exp}
  const clients = new Map(); // ws -> {playerId|null, lastAim, aimCount}

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') { res.end('ok'); return; }
    if (req.url === '/commit') { res.end(COMMIT); return; }
    const file = path.join(WEB, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
    if (!file.startsWith(WEB) || !existsSync(file)) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    res.setHeader('content-security-policy', "default-src 'self'; connect-src 'self' ws: wss:; style-src 'unsafe-inline'");
    res.end(readFileSync(file));
  });

  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };

  wss.on('connection', (ws) => {
    clients.set(ws, { playerId: null, aimCount: 0 });
    ws.on('close', () => { const c = clients.get(ws); if (c?.playerId) G.removePlayer(world, c.playerId); clients.delete(ws); });
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      const c = clients.get(ws);
      if (!c) return;
      try {
        if (m.t === 'hello') { /* spectator: nothing to do, snaps flow to all */ }
        else if (m.t === 'nonce') {
          const addr = String(m.addr || '').toLowerCase();
          if (!/^0x[0-9a-f]{40}$/.test(addr)) return send(ws, { t: 'err', msg: 'bad address' });
          const nonce = randomNonce();
          nonces.set(addr, { nonce, exp: Date.now() + 300_000 });
          send(ws, { t: 'nonce', msg: buildMessage({ domain, address: addr, nonce, issuedAt: new Date().toISOString() }) });
        } else if (m.t === 'join') {
          if (c.playerId) return send(ws, { t: 'err', msg: 'already playing' });
          if ([...clients.values()].filter((x) => x.playerId).length >= world.cfg.maxPlayers) return send(ws, { t: 'err', msg: 'arena full' });
          let addr = null, balance = 0, note = null;
          if (m.addr && m.sig) {
            addr = String(m.addr).toLowerCase();
            const n = nonces.get(addr);
            if (!n || Date.now() > n.exp) return send(ws, { t: 'err', msg: 'nonce expired — reconnect wallet' });
            const msg = m.msg;
            if (typeof msg !== 'string' || !msg.includes(n.nonce) || !verify(msg, m.sig, addr)) return send(ws, { t: 'err', msg: 'signature check failed' });
            nonces.delete(addr); // single use
            if (tokenAddress) {
              try { balance = await balanceOf(tokenAddress, addr); }
              catch { note = 'balance unavailable — spawning at base size'; }
            }
          }
          const p = G.addPlayer(world, { name: m.name, addr, balance });
          c.playerId = p.id;
          send(ws, { t: 'joined', id: p.id, world: world.cfg.world, mass: p.m, note });
        } else if (m.t === 'aim') {
          if (!c.playerId) return;
          if (++c.aimCount > 2) return; // reset each 100ms snap tick → ≤20/s per spec
          G.setTarget(world, c.playerId, Number(m.x), Number(m.y));
        }
      } catch (e) { send(ws, { t: 'err', msg: 'server error' }); }
    });
  });

  const tickTimer = setInterval(() => {
    const events = G.step(world, 50);
    for (const e of events) if (e.t === 'eat') {
      for (const [ws, c] of clients) if (c.playerId === e.eaten) send(ws, { t: 'dead', respawnIn: world.cfg.respawnMs });
    }
  }, 50);
  const snapTimer = setInterval(() => {
    for (const [ws, c] of clients) { c.aimCount = 0; send(ws, { t: 'snap', ...G.snapshot(world, c.playerId) }); }
  }, 100);

  let watcher = null;
  if (tokenAddress) {
    watcher = startBuyWatcher({ token: tokenAddress, onBuy: (t) => {
      const mass = G.goldMass(t.eth);
      G.spawnGoldPellet(world, mass);
      G.creditBuy(world, t.buyer, mass);
    } });
  }

  const ready = new Promise((res) => httpServer.listen(port, () => res(httpServer.address().port)));
  return {
    ready,
    close: () => new Promise((res) => { clearInterval(tickTimer); clearInterval(snapTimer); watcher?.stop(); wss.close(); httpServer.close(res); for (const ws of clients.keys()) ws.terminate(); }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const srv = startServer({
    port: Number(process.env.PORT || 8790),
    domain: process.env.DOMAIN || 'localhost:8790',
    tokenAddress: process.env.TOKEN_ADDRESS || '',
  });
  srv.ready.then((p) => console.log(`blobinhood listening on :${p}`));
}
```

- [ ] **Step 4: Run tests — all pass.** **Step 5: Commit** `git commit -am "feat: websocket server shell with SIWE join flow"`

---

### Task 7: Web client — canvas game, wallet connect, trust panel

**Files:**
- Create: `web/index.html`

No unit tests (visual + protocol exercised by Task 6 tests); verified with headless screenshots and a manual browser run against the local server.

- [ ] **Step 1: Implement `web/index.html`.** Requirements checklist (all must hold):
  - Dark navy theme matching Buy Tank (`#0b1020` bg, green cells, gold pellets).
  - Canvas world rendering: grid background, pellets (small dots), gold pellets (glowing), cells (radius `4·√m` scaled), name tags, camera centered on `me` (world center when spectating), zoom `clamp(1.6 - log10(m)/2, 0.4, 1.4)`, linear interpolation between the last two snapshots.
  - Landing state = spectating with a center panel: name input, **Play** (anonymous join), **Connect wallet & play** button, and a "How sign-in works" details element showing: the two wallet methods used (`eth_requestAccounts`, `personal_sign`), the exact SIWE message template incl. the trust statement, and "we can never move funds — read the code" linking to the GitHub repo at the commit from `/commit`.
  - Wallet flow: `const [addr] = await ethereum.request({method:'eth_requestAccounts'})` → ws `{t:'nonce', addr}` → receive message → `sig = await ethereum.request({method:'personal_sign', params:[msg, addr]})` → `{t:'join', addr, sig, msg, name}`. If `window.ethereum` is missing, show "no wallet detected — you can still play anonymously".
  - Mouse move sends `{t:'aim'}` (throttled to 20/s) as vector from screen center; touch drag equivalent.
  - HUD: leaderboard top-right from `board`; own mass bottom-left; death overlay with respawn countdown from `dead` message; join `note` shown as toast.
  - ws reconnect with backoff on close; "reconnecting…" badge.
  - The ONLY `ethereum.request` methods in the file: `eth_requestAccounts`, `personal_sign` (enforced by Step 3 grep).
- [ ] **Step 2: Visual verification.** Run `TOKEN_ADDRESS= node server/index.js`, connect two bot players with a short node script (reuse the integration-test join messages), then headless-chromium screenshot `http://localhost:8790/` — the spectator view must show both named cells, pellets, and the leaderboard. Support `?autoplay=<name>` in the client (anonymous auto-join on load, dev convenience) so a second screenshot verifies the playing HUD.
- [ ] **Step 3: Wallet-safety grep gate.** `grep -o "ethereum.request({method:'[a-z_A-Z]*'" web/index.html | sort -u` must list exactly `eth_requestAccounts` and `personal_sign`; `grep -i "sendTransaction\|signTypedData\|approve" server/ web/ -r` must return nothing.
- [ ] **Step 4: Commit** `git commit -am "feat: canvas client with SIWE wallet flow and trust panel"`

---

### Task 8: README, live smoke, repo publish prep

**Files:**
- Create: `README.md`

- [ ] **Step 1: Full test suite green** — `node --test server/test/*.test.js`.
- [ ] **Step 2: Live smoke with a real token** — `TOKEN_ADDRESS=0x39ce56f22c704aed562a1c5113a651bfbf7e1ade node server/index.js` (Fatlon, from pons-buys testing): server boots, watcher resolves the pool, no crash after 30 s idle.
- [ ] **Step 3: README** — what it is, trust model (the four guarantees: sign-only, domain-bound nonce, spectate-first, open source), local dev (`npm i && npm start`), env vars, deploy sketch (systemd + Caddy websocket proxy), gameplay constants table, test command.
- [ ] **Step 4: Commit** `git commit -am "docs: README with trust model"`. GitHub publish + droplet deploy happen with the user (needs repo creation + server access decisions).
