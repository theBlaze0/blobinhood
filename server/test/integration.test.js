import test from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { startServer } from '../index.js';

const until = (ws, pred, what) => new Promise((res, rej) => {
  const timer = setTimeout(() => { ws.off('message', h); rej(new Error('timeout waiting ' + what)); }, 5000);
  const h = (raw) => {
    const m = JSON.parse(raw);
    if (m.t === 'err') { clearTimeout(timer); ws.off('message', h); return rej(new Error(m.msg)); }
    if (pred(m)) { clearTimeout(timer); ws.off('message', h); res(m); }
  };
  ws.on('message', h);
});
const once = (ws, type) => until(ws, (m) => m.t === type, type);

test('two anonymous players join, aim, and appear in full snapshots', async () => {
  const srv = startServer({ port: 0, domain: 'test', tokenAddress: '' });
  try {
    const port = await srv.ready;
    const a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await Promise.all([new Promise((r) => a.on('open', r)), new Promise((r) => b.on('open', r))]);

    a.send(JSON.stringify({ t: 'join', name: 'alice' }));
    const ja = await once(a, 'joined');
    b.send(JSON.stringify({ t: 'join', name: 'bob' }));
    await once(b, 'joined');

    a.send(JSON.stringify({ t: 'aim', x: 1000, y: 1000 }));
    const light = await once(a, 'snap');
    assert.ok(light.me && light.me.id === ja.id);
    const full = await until(a, (m) => m.t === 'snap' && m.board, 'full snap');
    assert.ok(full.board.length >= 2);
    a.close(); b.close();
  } finally { await srv.close(); }
});

test('split and eject messages are accepted and rate-limited without crashing', async () => {
  const srv = startServer({ port: 0, domain: 'test', tokenAddress: '' });
  try {
    const port = await srv.ready;
    const a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => a.on('open', r));
    a.send(JSON.stringify({ t: 'join', name: 'alice' }));
    await once(a, 'joined');
    for (let i = 0; i < 20; i++) { a.send(JSON.stringify({ t: 'split' })); a.send(JSON.stringify({ t: 'eject' })); }
    const snap = await once(a, 'snap');
    assert.ok(snap.me.cells.length >= 1); // base mass 25 < 50: still one cell, no crash
    a.close();
  } finally { await srv.close(); }
});

test('spectators are throttled to ~5 Hz while players get 20 Hz', async () => {
  const srv = startServer({ port: 0, domain: 'test', tokenAddress: '' });
  try {
    const port = await srv.ready;
    const spec = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => spec.on('open', r));
    spec.send(JSON.stringify({ t: 'hello' }));
    let count = 0;
    spec.on('message', (raw) => { if (JSON.parse(raw).t === 'snap') count++; });
    await new Promise((r) => setTimeout(r, 1000));
    assert.ok(count >= 3 && count <= 8, `spectator got ${count} snaps/s, want ~5`);
    spec.close();
  } finally { await srv.close(); }
});

test('connections beyond maxConnections are refused', async () => {
  const srv = startServer({ port: 0, domain: 'test', tokenAddress: '', maxConnections: 2 });
  try {
    const port = await srv.ready;
    const a = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const b = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await Promise.all([new Promise((r) => a.on('open', r)), new Promise((r) => b.on('open', r))]);
    const c = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    const first = await new Promise((res, rej) => { // listen from birth: the err rides right behind the handshake
      c.on('message', (raw) => res(JSON.parse(raw)));
      c.on('error', rej);
      setTimeout(() => rej(new Error('no message from refused connection')), 5000);
    });
    assert.strictEqual(first.t, 'err');
    assert.match(first.msg, /full/i);
    await new Promise((r) => c.on('close', r)); // server hangs up
    a.close(); b.close();
  } finally { await srv.close(); }
});

test('spectator hello receives snapshots with null me', async () => {
  const srv = startServer({ port: 0, domain: 'test', tokenAddress: '' });
  try {
    const port = await srv.ready;
    const s = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => s.on('open', r));
    s.send(JSON.stringify({ t: 'hello' }));
    const snap = await once(s, 'snap');
    assert.strictEqual(snap.me, null);
    s.close();
  } finally { await srv.close(); }
});
