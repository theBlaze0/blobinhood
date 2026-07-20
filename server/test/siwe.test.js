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
