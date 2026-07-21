# Blobin Hood — Pre-Launch Security & Robustness Audit

**Date:** 2026-07-20 · **Reviewed at commit:** ba65496 · **Method:** manual review + two independent adversarial subagents (auth/abuse, chain/money-path).

## Verdict

The core trust claim **holds**: the site only ever calls the wallet with
`eth_requestAccounts` and `personal_sign`; the server is strictly read-only
on-chain, holds no keys, and has no transaction path. Sign-in cannot
impersonate an address without that address's own signature over a fresh,
single-use, server-issued nonce.

Twelve issues were found (none allowing fund movement). All launch-relevant
ones are **fixed** on the `harden` branch. See below.

## Fixed

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | High | Buy watcher wedged forever if `eth_blockNumber` failed just after pool resolution (`from` stranded null → `hexBlock(null)` throws every tick) | Atomic resolution: `pool` committed only after `from` is known (`watcherStep`) |
| 2 | High | A malformed/exception log mid-range re-credited already-processed buys every tick; no dedupe | Per-log try/catch + `tx:logIndex` dedupe set + `from` always advances |
| 3 | High | Unbounded `world.gold`; `goldMass` floor of 10 let dust wash-trades mint mass | Cap `world.gold` (drop oldest); ignore buys < 0.0002 ETH |
| 4 | High | Unbounded `nonces` map + no rate limit → memory/CPU DoS on the 961 MB shared droplet | Per-connection token bucket (40 msg/s), ≤1 nonce/s, map cap 10k + 60s expiry sweep |
| 5 | High | No `maxPayload` → 100 MiB frame DoS | `maxPayload: 8192` |
| 6 | Medium | No per-IP connection cap / no WS origin check → connection exhaustion & drive-by sockets | `maxPerIp` (60, via X-Forwarded-For) + Origin allowlist |
| 7 | Medium | Tick/snapshot timers unguarded; no process handlers → one throw exits the process | try/catch per timer + `uncaughtException`/`unhandledRejection` handlers |
| 8 | Medium | SIWE verified client-supplied message text (substring nonce match only) | Server stores the canonical message and verifies the signature over *that*; client text ignored |
| 9 | Medium | Unbounded getLogs catch-up range after an outage would exceed provider limits | Range chunked (2000 blocks/step) |
| 10 | Medium | Watcher swallowed all errors silently | Errors logged; startup logs `chain features: ON/OFF` |
| 11 | Medium | `TOKEN_ADDRESS` unvalidated; `0X`-prefix produced permanently-failing calldata | Validated at boot (fail-safe to OFF), normalized lowercase; `pad32` accepts `0X` |
| 12 | Low | Static-path prefix check missing separator; `joined` sent `p.m` (undefined); `balanceOf('0x')` threw; no `error` handler on sockets; missing `frame-ancestors`/`nosniff` | All fixed |

## Accepted / deferred (documented, non-blocking)

- **Swap `recipient` vs true buyer** — multi-hop/aggregator buys credit the
  router, not the human; those get a gold pellet but no personal growth.
  Acceptable degradation; resolving `tx.from` is a future nicety.
- **1-block RPC lag / load-balanced-node skew** — negligible for ephemeral
  gold; not worth a batched call now.
- **Player-name control/RTL chars** — cosmetic spoofing only; XSS is already
  closed (escaped in DOM, inert on canvas, strict CSP).
- **Signature malleability** — not exploitable (nonce single-use, never
  stored as an identifier).

## Standing launch guidance

- Real token launch: `TOKEN_ADDRESS=0xYourCoin bash deploy/deploy.sh`.
- Watch `docker logs deploy-blobinhood-1` for `chain features: ON`, pool
  resolution, and per-buy lines.
- The 50-player arena cap binds before the hardware does; a full arena is
  ~13% of one dev core. Spectators are throttled to ~5 Hz and connections
  cap at 200 global / 60 per IP.
