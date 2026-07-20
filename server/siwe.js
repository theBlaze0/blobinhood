// SIWE-style (EIP-4361) message building and personal_sign verification.
// The only cryptography on the server: recovering the signer of a gas-less
// signature. Nothing here (or anywhere) can move funds.
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
