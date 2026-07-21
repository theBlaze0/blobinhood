import test from 'node:test';
import assert from 'node:assert';
import { createWatcherState, watcherStep, CHAIN } from '../chain.js';

const W = (bi) => ((bi + (1n << 256n)) % (1n << 256n)).toString(16).padStart(64, '0');
const buyLog = (tx, li, blk = '0x10') => ({
  topics: [CHAIN.swapTopic, '0x' + '0'.repeat(64), '0x' + '0'.repeat(24) + 'ab'.repeat(20)],
  data: '0x' + W(-5n * 10n ** 21n) + W(2n * 10n ** 17n) + W(2n ** 96n) + W(0n) + W(0n),
  transactionHash: tx, blockNumber: blk, logIndex: li,
});

// tokenIsToken0 true for this token (0x00..) so amount1 = WETH; buy
const OPTS = (over) => ({ token: '0x00' + '00'.repeat(19), is0: true, onBuy: () => {}, chunk: 2000, ...over });

test('pool is not committed if blockNumber fails right after resolution (no wedge)', async () => {
  const state = createWatcherState();
  let calls = 0;
  const rpc = async (m) => {
    if (m === 'eth_blockNumber') { calls++; if (calls === 1) throw new Error('RPC 502'); return '0x64'; }
    return '0x';
  };
  const resolvePool = async () => '0x' + 'cd'.repeat(20);
  // first step: pool resolves but blockNumber throws → must propagate, state stays clean
  await assert.rejects(() => watcherStep(state, OPTS({ rpc, resolvePool })));
  assert.strictEqual(state.pool, null, 'pool must NOT be committed when from is unknown');
  assert.strictEqual(state.from, null);
  // second step: blockNumber works → commits cleanly
  await watcherStep(state, OPTS({ rpc, resolvePool }));
  assert.ok(state.pool && state.from === 101);
});

test('a malformed log does not block progress or re-credit good logs', async () => {
  const state = { pool: '0x' + 'cd'.repeat(20), from: 10, seen: new Set() };
  const bad = { topics: [CHAIN.swapTopic], data: '0x', transactionHash: '0xbad', logIndex: '0x0' }; // no topics[2]
  const good = buyLog('0xgood', '0x1');
  const seen = [];
  const rpc = async (m) => m === 'eth_blockNumber' ? '0x14' : [bad, good];
  await watcherStep(state, OPTS({ rpc, resolvePool: async () => state.pool, onBuy: (t) => seen.push(t.tx) }));
  assert.deepStrictEqual(seen, ['0xgood']); // bad skipped, good credited
  assert.ok(state.from > 10); // advanced despite the bad log
});

test('overlapping ranges never double-credit (dedupe by tx:logIndex)', async () => {
  const state = { pool: '0x' + 'cd'.repeat(20), from: 10, seen: new Set() };
  const log = buyLog('0xsame', '0x2');
  const seen = [];
  const opts = (head) => OPTS({ rpc: async (m) => m === 'eth_blockNumber' ? head : [log], resolvePool: async () => state.pool, onBuy: (t) => seen.push(t.tx) });
  await watcherStep(state, opts('0x14'));
  state.from = 10; // simulate a range replay
  await watcherStep(state, opts('0x14'));
  assert.strictEqual(seen.length, 1);
});

test('large backlog is chunked, not requested in one giant range', async () => {
  const state = { pool: '0x' + 'cd'.repeat(20), from: 100, seen: new Set() };
  let requestedTo = null;
  const rpc = async (m, p) => {
    if (m === 'eth_blockNumber') return '0x' + (100000).toString(16);
    requestedTo = parseInt(p[0].toBlock, 16);
    return [];
  };
  await watcherStep(state, OPTS({ rpc, resolvePool: async () => state.pool, chunk: 2000 }));
  assert.strictEqual(requestedTo, 100 + 2000 - 1); // one chunk only
  assert.strictEqual(state.from, 100 + 2000);
});
