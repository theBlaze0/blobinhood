// Pure simulation. No I/O, no timers, no state outside the world object.
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
