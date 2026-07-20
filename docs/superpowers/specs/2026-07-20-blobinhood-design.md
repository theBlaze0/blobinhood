# Blobin Hood — Design

**Date:** 2026-07-20
**Status:** Approved in conversation (name: Blobin Hood, domain blobinhood.online (bought: .online, .io was the original pick)), user-reviewed

## Purpose

Blobin Hood ("your bag is your blob"): a playable agar.io mirror for the user's upcoming Pons-launchpad coin on
Robinhood Chain. "Your bag is your blob": a player's coin balance sets their
spawn size; live on-chain buys drop golden pellets into the arena. Stakes are
cosmetic only — no tokens ever move. The site must be visibly trustworthy to
wallet-connecting users.

## Constraints & context

- Coin not launched yet; token address is config. Game must run pre-launch
  (everyone spawns at base mass; no golden pellets until the pool exists).
- Chain facts identical to the pons-buys Buy Tank project: chain id 4663,
  RPC `https://rpc.mainnet.chain.robinhood.com`, WETH
  `0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73`, V3 factory
  `0x1f7d7550B1b028f7571E69A784071F0205FD2EfA`, fee 10000, Swap topic
  `0xc42079f9…ca67`, explorer robinhoodchain.blockscout.com.
- Hosting: user's existing DO droplet, Caddy HTTPS + websocket proxy on a
  subdomain, systemd service (same ops pattern as chipin.poker).
- Public GitHub repo; site footer links the running commit.

## Trust requirements (first-class)

1. Frontend may only ever call `eth_requestAccounts` and `personal_sign`.
   The codebase contains no `eth_sendTransaction`, no `eth_signTypedData`,
   no approval flows. Signing is gas-less and free.
2. Sign-in message is SIWE-style (EIP-4361): domain, address, one-time
   server nonce (5-minute expiry, single use), issued-at, and the statement:
   "This signature only proves wallet ownership. It costs nothing, sends
   nothing, and grants this site no access to your funds."
3. Spectator mode without a wallet is the landing state; a "how sign-in
   works" explainer shows the exact message before any wallet prompt.
4. Frontend is dependency-free (view-source auditable). Server deps limited
   to `ws`, `@noble/curves`, `@noble/hashes`.
5. HTTPS-only, strict CSP, no third-party scripts or analytics.

## Gameplay (v1 core loop)

- One arena, 4000×4000 world units, soft cap 50 players.
- Mouse (or touch drag) sets a target direction; server moves the cell.
  Speed scales down with mass (`speed = S / mass^0.32`, clamped) — agar feel.
- ~600 static pellets (respawning) worth small mass.
- Eat rule: A eats B when A.mass ≥ 1.25 × B.mass and centers overlap enough
  (`dist < A.r − B.r/3`). Eater gains 80% of eaten mass.
- Eaten players respawn after 3 s at their spawn mass, random safe location.
- Spawn mass from coin balance at sign-in:
  `mass = BASE + K · log10(1 + balance/10_000)`, capped at 4×BASE
  (BASE = 25, K = 12; balance in whole tokens). Non-holders/spectators-turned-
  players get BASE.
- Live buys (server watches the pool like Buy Tank, 3 s poll): each buy
  spawns a golden pellet at a random spot worth
  `mass = min(120, 10 + 30 · log10(1 + eth/0.001))`. If
  the buyer address is currently signed in, that player's cell also gains
  the same mass instantly with a gold flash.
- Leaderboard: top-10 by mass, plus per-session "eats" count. Cosmetic only.
- Mass decay: none in v1 (rounds are short-lived, cap is low).

## Architecture

Three units in one repo (`~/blobinhood`):

1. **`server/game.js` — pure simulation.** No I/O, no timers. Exports
   `createWorld(cfg)`, `addPlayer/removePlayer`, `setTarget(id, vec)`,
   `step(world, dt)`, `spawnGoldPellet(mass)`, `creditBuy(address, mass)`,
   `snapshot(world, viewerId)` (nearby entities only). Fully unit-testable.
2. **`server/index.js` — shell.** Node 22 + `ws`. Owns: 20 Hz tick calling
   `step`; 10 Hz per-client snapshot broadcast; SIWE nonce issue/verify
   (`personal_sign` recovery via @noble secp256k1 + keccak); chain reads by
   raw JSON-RPC `fetch` (balanceOf at sign-in; pool Swap polling ported from
   Buy Tank incl. rate-limit pacing); input validation (target vector only,
   rate-limited); spectator connections receive snapshots without a player.
3. **`web/index.html` — static client.** Dependency-free canvas renderer:
   camera follow + mass-based zoom, snapshot interpolation, name tags,
   golden-pellet and gold-flash effects, leaderboard, death/respawn UI,
   spectate-by-default, wallet connect + SIWE sign, trust explainer panel,
   footer with commit link. Visual language carried over from Buy Tank
   (dark navy, green cells, gold buys).

### Protocol (websocket, JSON)

- C→S: `{t:'hello'}` (spectate) | `{t:'nonce', addr}` | `{t:'join', addr,
  sig, name}` (sig optional: absent = anonymous player at BASE mass) |
  `{t:'aim', x, y}` (unit vector, ≤20/s).
- S→C: `{t:'nonce', msg}` | `{t:'joined', id, world}` | `{t:'snap', me,
  cells, pellets, gold, board}` | `{t:'dead', respawnIn}` | `{t:'err', msg}`.
- Anonymous play is allowed (name only, BASE mass); signing in is what links
  your bag and your buys.

## Error handling

- RPC failures: balance read failure at join → join succeeds at BASE mass
  with a "balance unavailable" notice; pool poller retries with backoff
  (Buy Tank pattern) and never crashes the tick loop.
- Bad signature / expired nonce → `err`, client shows retry; no partial join.
- Disconnect = cell removed (no ghost cells); reconnect = fresh join.
- Server restart: world resets (no persistence in v1).
- Tick overrun protection: `step` receives real dt, clamped at 100 ms.

## Testing

- `node --test` unit tests for game.js: speed/mass math, eat rules incl.
  25% threshold edge, respawn timing, spawn-mass formula, snapshot filtering.
- SIWE verify tested against fixture signatures generated by a test key.
- Headless bot client (node websocket) integration test: two bots join,
  one outgrows and eats the other, leaderboard updates.
- Visual pass via headless chromium screenshots (Buy Tank workflow).

## Out of scope (v1)

Split/eject/viruses, mass decay, multiple rooms/sharding, persistent stats,
accounts, chat, mobile-first polish, and — permanently for this design —
any mechanic that moves or approves tokens.

## Deployment

Public GitHub repo `blobinhood`. Droplet: `node server/index.js` under systemd;
Caddy subdomain block serving `web/` statically and proxying `/ws` with
websocket upgrade. Config via env: `TOKEN_ADDRESS` (empty pre-launch),
`PORT`, `DOMAIN` (for SIWE domain binding). Exact subdomain chosen at deploy
time.
