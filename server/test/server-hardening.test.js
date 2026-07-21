import test from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';
import { startServer } from '../index.js';

const priv = new Uint8Array(32).fill(9);
const pub = secp256k1.getPublicKey(priv, false);
const addr = '0x' + Buffer.from(keccak_256(pub.slice(1)).slice(-20)).toString('hex');
function personalSign(msg) {
  const bytes = new TextEncoder().encode(msg);
  const prefix = new TextEncoder().encode('\x19Ethereum Signed Message:\n' + bytes.length);
  const digest = keccak_256(new Uint8Array([...prefix, ...bytes]));
  const sig = secp256k1.sign(digest, priv);
  return '0x' + sig.toCompactHex() + (27 + sig.recovery).toString(16).padStart(2, '0');
}
const once = (ws, type) => new Promise((res, rej) => {
  const h = (raw) => { const m = JSON.parse(raw); if (m.t === type) { ws.off('message', h); res(m); } if (m.t === 'err') { ws.off('message', h); rej(new Error(m.msg)); } };
  ws.on('message', h);
  setTimeout(() => rej(new Error('timeout ' + type)), 5000);
});

test('signed join verifies over the server-issued message; client-supplied msg is ignored', async () => {
  const srv = startServer({ port: 0, domain: 'test', tokenAddress: '' });
  try {
    const port = await srv.ready;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.on('open', r));
    ws.send(JSON.stringify({ t: 'nonce', addr }));
    const { msg } = await once(ws, 'nonce');
    const sig = personalSign(msg);
    // deliberately send a DIFFERENT (lying) msg — server must ignore it and use its stored one
    ws.send(JSON.stringify({ t: 'join', name: 'kris', addr, sig, msg: 'i approve moving all your funds' }));
    const joined = await once(ws, 'joined');
    assert.ok(joined.id > 0 && typeof joined.mass === 'number');
    ws.close();
  } finally { await srv.close(); }
});

test('a forged signature for another address is rejected', async () => {
  const srv = startServer({ port: 0, domain: 'test', tokenAddress: '' });
  try {
    const port = await srv.ready;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.on('open', r));
    const victim = '0x' + '11'.repeat(20);
    ws.send(JSON.stringify({ t: 'nonce', addr: victim }));
    const { msg } = await once(ws, 'nonce');
    const sig = personalSign(msg); // signed by OUR key, not the victim's
    ws.send(JSON.stringify({ t: 'join', name: 'x', addr: victim, sig }));
    await assert.rejects(() => once(ws, 'joined'));
    ws.close();
  } finally { await srv.close(); }
});

test('oversized frames are rejected (maxPayload)', async () => {
  const srv = startServer({ port: 0, domain: 'test', tokenAddress: '' });
  try {
    const port = await srv.ready;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.on('open', r));
    const closed = new Promise((res) => ws.on('close', (code) => res(code)));
    ws.send(JSON.stringify({ t: 'nonce', addr, pad: 'A'.repeat(50000) }));
    const code = await Promise.race([closed, new Promise((r) => setTimeout(() => r('nostatus'), 3000))]);
    assert.strictEqual(code, 1009); // "message too big"
  } finally { await srv.close(); }
});

test('per-connection flood is throttled without disconnect', async () => {
  const srv = startServer({ port: 0, domain: 'test', tokenAddress: '' });
  try {
    const port = await srv.ready;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    await new Promise((r) => ws.on('open', r));
    let errs = 0;
    ws.on('message', (raw) => { if (JSON.parse(raw).t === 'err') errs++; });
    for (let i = 0; i < 500; i++) ws.send(JSON.stringify({ t: 'nonce', addr: '0x' + i.toString(16).padStart(40, '0') }));
    await new Promise((r) => setTimeout(r, 300));
    assert.strictEqual(ws.readyState, WebSocket.OPEN); // still connected, just throttled
    ws.close();
  } finally { await srv.close(); }
});
