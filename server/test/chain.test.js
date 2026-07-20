import test from 'node:test';
import assert from 'node:assert';
import { tokenIsToken0, decodeSwap, encBalanceOf, CHAIN } from '../chain.js';

const W = (bi) => ((bi + (1n << 256n)) % (1n << 256n)).toString(16).padStart(64, '0');

test('decodeSwap classifies buy/sell from WETH direction', () => {
  const log = {
    topics: [CHAIN.swapTopic, '0x' + '0'.repeat(64), '0x' + '0'.repeat(24) + 'ab'.repeat(20)],
    data: '0x' + W(-5000n * 10n ** 18n) + W(2n * 10n ** 17n) + W(2n ** 96n) + W(0n) + W(0n),
    transactionHash: '0xt', blockNumber: '0x10', logIndex: '0x0',
  };
  const t = decodeSwap(log, true);
  assert.strictEqual(t.side, 'buy');
  assert.ok(Math.abs(t.eth - 0.2) < 1e-9);
  assert.strictEqual(t.buyer, '0x' + 'ab'.repeat(20));
});

test('tokenIsToken0 sorts against WETH', () => {
  assert.strictEqual(tokenIsToken0('0x0a' + '00'.repeat(19)), true);
  assert.strictEqual(tokenIsToken0('0xff' + '00'.repeat(19)), false);
});

test('encBalanceOf builds balanceOf(address) calldata', () => {
  assert.strictEqual(
    encBalanceOf('0x1111111111111111111111111111111111111111'),
    '0x70a082310000000000000000000000001111111111111111111111111111111111111111'
  );
});
