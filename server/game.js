// Pure simulation. No I/O, no timers, no state outside the world object.
// Players own 1..maxCells cells that all steer toward a shared world-space
// aim point (tx, ty); split/eject launch pieces with decaying impulses.
export const defaults = {
  world: 4000, maxPlayers: 50,
  pellets: 600, pelletMass: 1.5,
  baseMass: 25, massK: 12, maxSpawnFactor: 4,
  eatRatio: 1.25, absorb: 0.8, respawnMs: 3000,
  speedS: 400, speedExp: 0.32, minSpeed: 18, maxSpeed: 160,
  viewRange: 1200,
  maxGold: 300,
  viruses: 18, virusMass: 100, virusThreshold: 115, virusBonus: 10, virusImpulse: 24,
  maxCells: 8, minSplitMass: 50, splitImpulse: 28,
  minEjectMass: 30, ejectCost: 16, ejectMass: 12, ejectImpulse: 22,
  maxEjected: 200, impulseDecay: 0.92,
  mergeBaseMs: 12000, mergeMassMs: 20, mergeCapMs: 20000,
};

export const radius = (m) => 4 * Math.sqrt(m);
export const speed = (m, c = defaults) =>
  Math.max(c.minSpeed, Math.min(c.maxSpeed, c.speedS / Math.pow(m, c.speedExp)));
export const spawnMass = (balance, c = defaults) =>
  Math.min(c.baseMass * c.maxSpawnFactor, c.baseMass + c.massK * Math.log10(1 + (balance || 0) / 10_000));
export const totalMass = (p) => p.cells.reduce((s, c) => s + c.m, 0);

const centroidOf = (p) => {
  const t = totalMass(p) || 1;
  return {
    x: p.cells.reduce((s, c) => s + c.x * c.m, 0) / t,
    y: p.cells.reduce((s, c) => s + c.y * c.m, 0) / t,
  };
};

const rnd = (n) => Math.random() * n;
const newPellet = (c) => ({ x: rnd(c.world), y: rnd(c.world), m: c.pelletMass });

export function createWorld(cfg = {}) {
  const c = { ...defaults, ...cfg };
  return {
    cfg: c, time: 0, nextId: 1,
    players: new Map(),
    pellets: Array.from({ length: c.pellets }, () => newPellet(c)),
    gold: [],
    ejected: [],
    viruses: Array.from({ length: c.viruses }, () => ({ x: rnd(c.world), y: rnd(c.world) })),
  };
}

export function addPlayer(world, { name, addr = null, balance = 0 }) {
  const c = world.cfg;
  const m = spawnMass(balance, c);
  const x = rnd(c.world), y = rnd(c.world);
  const id = world.nextId++;
  const p = {
    id, name: String(name || 'blob').slice(0, 16), addr,
    hue: Math.round((id * 137.508) % 360),
    spawn: m, eats: 0, deadUntil: 0, tx: x, ty: y,
    cells: [{ x, y, m, vx: 0, vy: 0, mergeAt: 0 }],
  };
  world.players.set(p.id, p);
  return p;
}

export const removePlayer = (world, id) => world.players.delete(id);

export function setTarget(world, id, x, y) {
  const p = world.players.get(id);
  if (!p || !Number.isFinite(x) || !Number.isFinite(y)) return;
  p.tx = Math.max(0, Math.min(world.cfg.world, x));
  p.ty = Math.max(0, Math.min(world.cfg.world, y));
}

export const goldMass = (eth) => Math.min(120, 10 + 30 * Math.log10(1 + eth / 0.001));

export function spawnGoldPellet(world, mass) {
  const g = { x: rnd(world.cfg.world), y: rnd(world.cfg.world), m: mass };
  world.gold.push(g);
  while (world.gold.length > world.cfg.maxGold) world.gold.shift(); // bound memory/serialization
  return g;
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
    p.cells.push({
      x: cell.x, y: cell.y, m: cell.m,
      vx: (dx / len) * c.splitImpulse, vy: (dy / len) * c.splitImpulse,
      mergeAt: world.time + mergeMs,
    });
    made++;
  }
  return made;
}

export function eject(world, id) {
  const p = world.players.get(id);
  if (!p || p.deadUntil) return 0;
  const c = world.cfg;
  let fired = 0;
  for (const cell of p.cells) {
    if (cell.m < c.minEjectMass) continue;
    const dx = p.tx - cell.x, dy = p.ty - cell.y, len = Math.hypot(dx, dy) || 1;
    cell.m -= c.ejectCost;
    const clear = radius(cell.m) + 8; // beyond pickup range so the ejector can't instantly reclaim it
    world.ejected.push({
      x: cell.x + (dx / len) * clear, y: cell.y + (dy / len) * clear,
      m: c.ejectMass, vx: (dx / len) * c.ejectImpulse, vy: (dy / len) * c.ejectImpulse,
    });
    fired++;
  }
  while (world.ejected.length > c.maxEjected) world.ejected.shift();
  return fired;
}

export function step(world, dtMs) {
  const c = world.cfg, dt = Math.min(dtMs, 100) / 1000, ticks = Math.min(dtMs, 100) / 50;
  world.time += dtMs;
  const events = [];
  const alive = [...world.players.values()].filter((p) => !p.deadUntil);

  // steering + impulse per cell
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
      if (Math.hypot(cell.x - q.x, cell.y - q.y) < r) { cell.m += q.m; world.pellets[i] = newPellet(c); }
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

  // virus pops: a big-enough cell touching a virus explodes into pieces
  for (const p of alive) {
    for (let vi = world.viruses.length - 1; vi >= 0; vi--) {
      const v = world.viruses[vi];
      for (const cell of p.cells) {
        if (cell.m < c.virusThreshold) continue;
        if (Math.hypot(cell.x - v.x, cell.y - v.y) >= radius(cell.m) - radius(c.virusMass) / 3) continue;
        world.viruses.splice(vi, 1);
        world.viruses.push({ x: rnd(c.world), y: rnd(c.world) }); // keep the count topped up
        cell.m += c.virusBonus;
        const slots = c.maxCells - p.cells.length;
        const n = Math.min(slots + 1, Math.max(2, Math.floor(cell.m / 45)));
        if (n >= 2) {
          const pieceM = cell.m / n;
          const mergeMs = Math.min(c.mergeCapMs, c.mergeBaseMs + pieceM * c.mergeMassMs);
          cell.m = pieceM;
          cell.mergeAt = world.time + mergeMs;
          for (let k = 1; k < n; k++) {
            const a = Math.random() * Math.PI * 2;
            p.cells.push({ x: cell.x, y: cell.y, m: pieceM,
                           vx: Math.cos(a) * c.virusImpulse, vy: Math.sin(a) * c.virusImpulse,
                           mergeAt: world.time + mergeMs });
          }
        }
        events.push({ t: 'pop', id: p.id });
        break;
      }
    }
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
        A.cell.m += c.absorb * B.cell.m;
        A.p.eats++;
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

  // respawns
  for (const p of world.players.values()) {
    if (p.deadUntil && world.time >= p.deadUntil) {
      p.deadUntil = 0;
      const x = rnd(c.world), y = rnd(c.world);
      p.cells = [{ x, y, m: p.spawn, vx: 0, vy: 0, mergeAt: 0 }];
      p.tx = x; p.ty = y;
      events.push({ t: 'respawn', id: p.id });
    }
  }
  return events;
}

const rInt = Math.round;
const r1 = (n) => Math.round(n * 10) / 10;

export function snapshot(world, viewerId = null, { light = false } = {}) {
  const c = world.cfg;
  const viewer = viewerId != null ? world.players.get(viewerId) : null;
  const vc = viewer && viewer.cells.length ? centroidOf(viewer) : { x: c.world / 2, y: c.world / 2 };
  const inView = (e) => Math.hypot(e.x - vc.x, e.y - vc.y) <= c.viewRange;
  const alive = [...world.players.values()].filter((p) => !p.deadUntil);
  const cells = [];
  for (const p of alive) for (const cell of p.cells) {
    if (inView(cell)) cells.push({ pid: p.id, name: p.name, hue: p.hue, x: rInt(cell.x), y: rInt(cell.y), m: r1(cell.m) });
  }
  const snap = {
    me: viewer ? {
      id: viewer.id, x: rInt(vc.x), y: rInt(vc.y), m: r1(totalMass(viewer)), dead: !!viewer.deadUntil,
      cells: viewer.cells.map((x) => ({ x: r1(x.x), y: r1(x.y), m: r1(x.m) })),
    } : null,
    cells,
    gold: world.gold.filter(inView).map((g) => ({ x: rInt(g.x), y: rInt(g.y), m: r1(g.m) })),
    ejected: world.ejected.filter(inView).map((e) => ({ x: rInt(e.x), y: rInt(e.y), m: e.m })),
  };
  if (light) return snap;
  snap.pellets = world.pellets.filter(inView).map((p) => ({ x: rInt(p.x), y: rInt(p.y), m: p.m }));
  snap.viruses = world.viruses.map((v) => ({ x: rInt(v.x), y: rInt(v.y) }));
  snap.board = [...alive].sort((a, b) => totalMass(b) - totalMass(a)).slice(0, 10)
    .map((p) => ({ name: p.name, hue: p.hue, m: rInt(totalMass(p)), eats: p.eats }));
  snap.map = {
    cells: alive.map((p) => {
      const cc = centroidOf(p);
      return { id: p.id, hue: p.hue, x: rInt(cc.x), y: rInt(cc.y), m: rInt(totalMass(p)) };
    }),
    gold: world.gold.map((g) => ({ x: rInt(g.x), y: rInt(g.y) })),
  };
  return snap;
}
