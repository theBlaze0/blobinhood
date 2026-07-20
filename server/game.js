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
