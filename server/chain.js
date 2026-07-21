// Robinhood Chain access. Read-only, raw JSON-RPC — no keys, no writes.
export const CHAIN = {
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  v3Factory: '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',
  feeTier: 10000,
  swapTopic: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
};

const pad32 = (hex) => hex.replace(/^0x/i, '').toLowerCase().padStart(64, '0');
const word = (data, i) => BigInt('0x' + data.slice(2 + i * 64, 2 + (i + 1) * 64));
const signed = (w) => (w >= 1n << 255n ? w - (1n << 256n) : w);
const hexBlock = (n) => '0x' + n.toString(16);

export const encBalanceOf = (addr) => '0x70a08231' + pad32(addr);
export const encGetPool = (token) => '0x1698ee82' + pad32(token) + pad32(CHAIN.weth) + pad32(CHAIN.feeTier.toString(16));
export const tokenIsToken0 = (token) => token.toLowerCase() < CHAIN.weth.toLowerCase();

export function decodeSwap(log, tokenIs0) {
  const a0 = signed(word(log.data, 0)), a1 = signed(word(log.data, 1));
  const weth = tokenIs0 ? a1 : a0;
  const abs = (n) => (n < 0n ? -n : n);
  return {
    side: weth > 0n ? 'buy' : 'sell',
    eth: Number(abs(weth)) / 1e18,
    buyer: '0x' + log.topics[2].slice(-40).toLowerCase(),
    tx: log.transactionHash, block: parseInt(log.blockNumber, 16), logIndex: parseInt(log.logIndex, 16),
  };
}

let rpcId = 1;
export async function rpc(method, params = []) {
  const res = await fetch(CHAIN.rpc, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: rpcId++, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await res.json();
  if (body.error) throw new Error(body.error.message || 'rpc error');
  return body.result;
}

export async function balanceOf(token, addr) {
  const ret = await rpc('eth_call', [{ to: token, data: encBalanceOf(addr) }, 'latest']);
  if (!ret || ret === '0x' || ret.length < 66) return 0; // address has no code yet / empty return
  return Number(word(ret, 0) / 10n ** 15n) / 1000; // whole tokens (18 decimals)
}

export async function resolvePool(token) {
  const ret = await rpc('eth_call', [{ to: CHAIN.v3Factory, data: encGetPool(token) }, 'latest']);
  const pool = '0x' + ret.slice(-40);
  return /^0x0{40}$/.test(pool) ? null : pool;
}

export const createWatcherState = () => ({ pool: null, from: null, seen: new Set() });

// One deterministic iteration of the buy watcher. Split out from the timer
// loop so its failure modes are unit-testable. rpc/resolvePool are injectable.
export async function watcherStep(state, { token, is0, onBuy, chunk = 2000, rpc: rpcFn = rpc, resolvePool: resolveFn = resolvePool }) {
  if (!state.pool) {
    const pool = await resolveFn(token);
    if (!pool) return; // still pre-launch — keep polling
    // resolve atomically: only commit pool AFTER we know `from`, so a
    // blockNumber failure here retries cleanly instead of stranding from=null
    const head = parseInt(await rpcFn('eth_blockNumber'), 16);
    state.pool = pool;
    state.from = head + 1;
    console.log(`buy watcher: pool ${pool} resolved for ${token}, watching from block ${state.from}`);
    return;
  }
  const head = parseInt(await rpcFn('eth_blockNumber'), 16);
  if (head < state.from) return;
  const to = Math.min(head, state.from + chunk - 1); // chunk the range so a long backlog can't blow the provider's limit
  const logs = await rpcFn('eth_getLogs', [{ address: state.pool, topics: [CHAIN.swapTopic], fromBlock: hexBlock(state.from), toBlock: hexBlock(to) }]);
  for (const l of logs) {
    try {
      const key = l.transactionHash + ':' + l.logIndex;
      if (state.seen.has(key)) continue; // dedupe: overlapping ranges never double-credit
      state.seen.add(key);
      const t = decodeSwap(l, is0);
      if (t.side === 'buy') { console.log(`buy watcher: ${t.eth} ETH buy by ${t.buyer} (${t.tx})`); onBuy(t); }
    } catch (e) { console.error('buy watcher: skipping bad log —', e.message); } // one poison log can't stall the range
  }
  if (state.seen.size > 5000) state.seen = new Set([...state.seen].slice(-2000)); // bound the dedupe set
  state.from = to + 1; // always advance, even if a log threw
}

export function startBuyWatcher({ token, onBuy, intervalMs = 3000, chunk = 2000 }) {
  let stopped = false, backoff = intervalMs;
  const is0 = tokenIsToken0(token);
  const state = createWatcherState();
  const loop = async () => {
    if (stopped) return;
    try { await watcherStep(state, { token, is0, onBuy, chunk }); backoff = intervalMs; }
    catch (e) { console.error('buy watcher:', e.message); backoff = Math.min(backoff * 2, 30000); }
    if (!stopped) setTimeout(loop, backoff);
  };
  setTimeout(loop, 0);
  return { stop: () => { stopped = true; } };
}
