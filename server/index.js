// Blobin Hood server shell: HTTP static + websocket game protocol.
// Wallet trust invariant: this server only ever VERIFIES gas-less signatures
// and READS balances. There is no key handling and no transaction code.
import http from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import * as G from './game.js';
import { buildMessage, verify, randomNonce } from './siwe.js';
import { balanceOf, startBuyWatcher } from './chain.js';

const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'web');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
let COMMIT = process.env.COMMIT || 'dev';
if (COMMIT === 'dev') { try { COMMIT = execSync('git rev-parse --short HEAD', { cwd: WEB }).toString().trim(); } catch {} }

export function startServer({ port = 8790, domain = 'localhost:8790', tokenAddress = '', maxConnections = 200, maxPerIp = 60 } = {}) {
  const world = G.createWorld();
  const nonces = new Map(); // addrLower -> {nonce, msg, exp}
  const clients = new Map(); // ws -> {playerId|null, aimCount, ...}
  const ipCounts = new Map(); // ip -> live connection count
  const MIN_BUY_ETH = 0.0002; // dust buys don't mint gold/mass (anti wash-trade)
  const domainHost = domain.replace(/^https?:\/\//, '');

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') { res.end('ok'); return; }
    if (req.url === '/commit') { res.end(COMMIT); return; }
    const urlPath = req.url.split('?')[0];
    const file = path.join(WEB, urlPath === '/' ? 'index.html' : urlPath);
    let isFile = false;
    try { isFile = statSync(file).isFile(); } catch {}
    if (!(file === path.join(WEB, 'index.html') || file.startsWith(WEB + path.sep)) || !isFile) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
    res.setHeader('content-security-policy', "default-src 'self'; connect-src 'self' ws: wss:; style-src 'unsafe-inline'; frame-ancestors 'none'");
    res.setHeader('x-content-type-options', 'nosniff');
    res.end(readFileSync(file));
  });

  // Origin allowlist: browsers always send Origin; block drive-by sockets from
  // other sites. Native clients (tests, bots) send no Origin and are allowed.
  const originOk = (origin) => {
    if (!origin) return true;
    try { return new URL(origin).host === domainHost || /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(new URL(origin).host); }
    catch { return false; }
  };
  const wss = new WebSocketServer({
    server: httpServer, path: '/ws',
    maxPayload: 8192, // game messages are tiny; reject giant frames
    verifyClient: ({ origin }) => originOk(origin),
  });
  const send = (ws, m) => { if (ws.readyState === 1) ws.send(JSON.stringify(m)); };

  wss.on('connection', (ws, req) => {
    const ip = (req.headers['x-forwarded-for']?.split(',')[0].trim()) || req.socket.remoteAddress || 'unknown';
    if (clients.size >= maxConnections || (ipCounts.get(ip) || 0) >= maxPerIp) {
      send(ws, { t: 'err', msg: 'server full — try again in a bit' });
      ws.close();
      return;
    }
    ipCounts.set(ip, (ipCounts.get(ip) || 0) + 1);
    clients.set(ws, { playerId: null, joining: false, aimCount: 0, lastSplit: 0, lastEject: 0, lastNonce: 0, tokens: 40, lastMsg: Date.now() });
    ws.on('error', () => {}); // protocol/oversize errors: swallow, the close handler cleans up
    ws.on('close', () => {
      const c = clients.get(ws);
      if (c?.playerId) G.removePlayer(world, c.playerId);
      clients.delete(ws);
      const n = (ipCounts.get(ip) || 1) - 1;
      if (n <= 0) ipCounts.delete(ip); else ipCounts.set(ip, n);
    });
    ws.on('message', async (raw) => {
      let m; try { m = JSON.parse(raw); } catch { return; }
      const c = clients.get(ws);
      if (!c) return;
      // per-connection token bucket: ~40 msg/s sustained, burst 40 — kills floods
      const now = Date.now();
      c.tokens = Math.min(40, c.tokens + (now - c.lastMsg) * 0.04);
      c.lastMsg = now;
      if (c.tokens < 1) return; // silently drop when over budget
      c.tokens -= 1;
      try {
        if (m.t === 'hello') { /* spectator: snapshots flow to every connection */ }
        else if (m.t === 'nonce') {
          if (now - c.lastNonce < 1000) return; // ≤1 nonce/s per connection
          c.lastNonce = now;
          const addr = String(m.addr || '').toLowerCase();
          if (!/^0x[0-9a-f]{40}$/.test(addr)) return send(ws, { t: 'err', msg: 'bad address' });
          const nonce = randomNonce();
          const msg = buildMessage({ domain: domainHost, address: addr, nonce, issuedAt: new Date().toISOString() });
          nonces.set(addr, { nonce, msg, exp: now + 300_000 });
          while (nonces.size > 10000) nonces.delete(nonces.keys().next().value); // bound memory
          send(ws, { t: 'nonce', msg });
        } else if (m.t === 'join') {
          if (c.playerId || c.joining) return send(ws, { t: 'err', msg: 'already playing' });
          if ([...clients.values()].filter((x) => x.playerId).length >= world.cfg.maxPlayers) return send(ws, { t: 'err', msg: 'arena full' });
          c.joining = true; // synchronous guard: closes the race across the await below
          try {
            let addr = null, balance = 0, note = null;
            if (m.addr && m.sig) {
              addr = String(m.addr).toLowerCase();
              const n = nonces.get(addr);
              nonces.delete(addr); // single use, consumed regardless of outcome
              // verify the signature over the EXACT server-issued message, not
              // client-supplied text — pins the reassuring SIWE statement
              if (!n || now > n.exp || !verify(n.msg, m.sig, addr)) return send(ws, { t: 'err', msg: 'sign-in failed — reconnect wallet' });
              if (tokenAddress) {
                try { balance = await balanceOf(tokenAddress, addr); }
                catch { note = 'balance unavailable — spawning at base size'; }
              }
            }
            const p = G.addPlayer(world, { name: m.name, addr, balance });
            c.playerId = p.id;
            send(ws, { t: 'joined', id: p.id, world: world.cfg.world, mass: G.totalMass(p), note });
          } finally { c.joining = false; }
        } else if (m.t === 'aim') {
          if (!c.playerId) return;
          if (++c.aimCount > 2) return; // reset each 100ms snap tick → ≤20/s
          G.setTarget(world, c.playerId, Number(m.x), Number(m.y));
        } else if (m.t === 'split') {
          if (!c.playerId) return;
          if (now - c.lastSplit < 250) return;
          c.lastSplit = now;
          G.split(world, c.playerId);
        } else if (m.t === 'eject') {
          if (!c.playerId) return;
          if (now - c.lastEject < 100) return;
          c.lastEject = now;
          G.eject(world, c.playerId);
        }
      } catch { send(ws, { t: 'err', msg: 'server error' }); }
    });
  });

  // sweep expired nonces so a burst of distinct addresses can't accumulate
  const sweepTimer = setInterval(() => {
    const t = Date.now();
    for (const [k, v] of nonces) if (t > v.exp) nonces.delete(k);
  }, 60_000);

  const tickTimer = setInterval(() => {
    try {
      const events = G.step(world, 50);
      for (const e of events) if (e.t === 'eat' && e.fatal) {
        for (const [ws, c] of clients) if (c.playerId === e.eaten) send(ws, { t: 'dead', respawnIn: world.cfg.respawnMs });
      }
    } catch (e) { console.error('tick error:', e.message); } // one bad tick must not kill the process
  }, 50);
  // 20 Hz light snapshots (moving entities); every 10th is full (pellets/
  // board/map). Spectators get every 4th snap (~5 Hz) — they're uncapped in
  // number, so their cost must stay bounded.
  let snapN = 0;
  const snapTimer = setInterval(() => {
    try {
      snapN++;
      const light = snapN % 10 !== 0;
      const spectatorTick = snapN % 4 === 0;
      for (const [ws, c] of clients) {
        c.aimCount = 0;
        if (!c.playerId && !spectatorTick) continue;
        send(ws, { t: 'snap', ...G.snapshot(world, c.playerId, { light }) });
      }
    } catch (e) { console.error('snapshot error:', e.message); }
  }, 50);

  let watcher = null;
  if (tokenAddress) {
    watcher = startBuyWatcher({ token: tokenAddress, onBuy: (t) => {
      if (t.eth < MIN_BUY_ETH) return; // ignore dust — can't be farmed for mass
      const mass = G.goldMass(t.eth);
      G.spawnGoldPellet(world, mass);
      G.creditBuy(world, t.buyer, mass);
    } });
  }

  const ready = new Promise((res) => httpServer.listen(port, () => res(httpServer.address().port)));
  return {
    ready,
    close: () => new Promise((res) => {
      clearInterval(tickTimer); clearInterval(snapTimer); clearInterval(sweepTimer); watcher?.stop();
      wss.close(); httpServer.close(res);
      for (const ws of clients.keys()) ws.terminate();
    }),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // never let an unexpected throw take the whole game down; log and stay up
  process.on('uncaughtException', (e) => console.error('uncaughtException:', e));
  process.on('unhandledRejection', (e) => console.error('unhandledRejection:', e));

  let tokenAddress = (process.env.TOKEN_ADDRESS || '').trim();
  if (tokenAddress && !/^0x[0-9a-fA-F]{40}$/.test(tokenAddress)) {
    console.error(`TOKEN_ADDRESS "${tokenAddress}" is not a valid 0x address — chain features OFF`);
    tokenAddress = '';
  }
  tokenAddress = tokenAddress.toLowerCase();
  console.log(`chain features: ${tokenAddress ? 'ON (token ' + tokenAddress + ')' : 'OFF'}`);

  const srv = startServer({
    port: Number(process.env.PORT || 8790),
    domain: process.env.DOMAIN || 'localhost:8790',
    tokenAddress,
  });
  srv.ready.then((p) => console.log(`blobinhood listening on :${p}`));
}
