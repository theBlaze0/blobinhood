// Robinhood Chain access. Read-only, raw JSON-RPC — no keys, no writes.
export const CHAIN = {
  rpc: 'https://rpc.mainnet.chain.robinhood.com',
  weth: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73',
  v3Factory: '0x1f7d7550B1b028f7571E69A784071F0205FD2EfA',
  feeTier: 10000,
  swapTopic: '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
};

const pad32 = (hex) => hex.replace(/^0x/, '').toLowerCase().padStart(64, '0');
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
  return Number(word(ret, 0) / 10n ** 15n) / 1000; // whole tokens (18 decimals)
}

export async function resolvePool(token) {
  const ret = await rpc('eth_call', [{ to: CHAIN.v3Factory, data: encGetPool(token) }, 'latest']);
  const pool = '0x' + ret.slice(-40);
  return /^0x0{40}$/.test(pool) ? null : pool;
}

export function startBuyWatcher({ token, onBuy, intervalMs = 3000 }) {
  let stopped = false, pool = null, from = null, backoff = intervalMs;
  const is0 = tokenIsToken0(token);
  const tick = async () => {
    if (stopped) return;
    try {
      if (!pool) {
        pool = await resolvePool(token);
        if (pool) from = (await rpc('eth_blockNumber').then((h) => parseInt(h, 16))) + 1;
      } else {
        const head = parseInt(await rpc('eth_blockNumber'), 16);
        if (head >= from) {
          const logs = await rpc('eth_getLogs', [{ address: pool, topics: [CHAIN.swapTopic], fromBlock: hexBlock(from), toBlock: hexBlock(head) }]);
          for (const l of logs) {
            const t = decodeSwap(l, is0);
            if (t.side === 'buy') onBuy(t);
          }
          from = head + 1;
        }
      }
      backoff = intervalMs;
    } catch { backoff = Math.min(backoff * 2, 30000); }
    if (!stopped) setTimeout(tick, backoff);
  };
  setTimeout(tick, 0);
  return { stop: () => { stopped = true; } };
}
