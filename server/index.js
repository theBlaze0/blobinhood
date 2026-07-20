// Blobin Hood server shell: HTTP static + websocket game protocol.
// Wallet trust invariant: this server only ever VERIFIES gas-less signatures
// and READS balances. There is no key handling and no transaction code.
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
  const clients = new Map(); // ws -> {playerId|null, aimCount}

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
        if (m.t === 'hello') { /* spectator: snapshots flow to every connection */ }
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
            if (!n || Date.now() > n.exp) return send(ws, { t: 'err', msg: 'sign-in expired — reconnect wallet' });
            if (typeof m.msg !== 'string' || !m.msg.includes(n.nonce) || !verify(m.msg, m.sig, addr)) return send(ws, { t: 'err', msg: 'signature check failed' });
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
          if (++c.aimCount > 2) return; // reset each 100ms snap tick → ≤20/s
          G.setTarget(world, c.playerId, Number(m.x), Number(m.y));
        }
      } catch { send(ws, { t: 'err', msg: 'server error' }); }
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
    close: () => new Promise((res) => {
      clearInterval(tickTimer); clearInterval(snapTimer); watcher?.stop();
      wss.close(); httpServer.close(res);
      for (const ws of clients.keys()) ws.terminate();
    }),
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
