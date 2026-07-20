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
