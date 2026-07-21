# Blobin Hood

**blobinhood.online — your bag is your blob.** A playable agar.io mirror for a
[Pons](https://ponsfamily.com/launchpad)-launched coin on Robinhood Chain
(chain id 4663). Your coin balance sets your spawn size, live on-chain buys
drop golden pellets into the arena, and eating other blobs is for leaderboard
glory only — **no tokens ever move**.

## Trust model — read this before connecting a wallet

1. **Sign-only.** The site can ask your wallet exactly two things:
   `eth_requestAccounts` (see your address) and `personal_sign` (a free,
   gas-less signature). There is no transaction, approval, or typed-data code
   anywhere in this repo — verify with
   `grep -ri "sendTransaction\|signTypedData\|approve" server/ web/`.
2. **Domain-bound, single-use sign-in.** The SIWE-style message you sign
   names this domain, includes a one-time server nonce (5-minute expiry), and
   states in plain English that it costs nothing and grants no access to
   funds. A phishing clone cannot replay it.
3. **Spectate first.** The arena is fully watchable without a wallet, and you
   can play anonymously at base size. Connecting is only for linking your bag
   and your buys.
4. **Open source, pinned commit.** The site footer shows the commit it is
   running (`/commit`). Read the code — the client is dependency-free; the
   server's only deps are `ws`, `@noble/curves`, `@noble/hashes`.

## Run

```bash
npm install
TOKEN_ADDRESS=0xYourCoin DOMAIN=blobinhood.online PORT=8790 npm start
```

- `TOKEN_ADDRESS` empty → pre-launch mode: everyone spawns at base mass, no
  balance reads, no buy watcher.
- `DOMAIN` is what appears in the SIWE message (must match the site's host).

Open `http://localhost:8790`. Dev conveniences: `?autoplay=<name>` joins
anonymously on load.

## Test

```bash
node --test server/test/*.test.js
```

Covers the simulation (movement, eat rules, respawn, gold pellets), SIWE
signature verification against real secp256k1 fixtures, swap decoding, and a
websocket integration test with two live clients.

## Gameplay constants

| Rule | Value |
|---|---|
| Arena | 4000×4000, 50 players max |
| Eat | ≥1.25× target's mass, absorb 80% |
| Respawn | 3 s, at spawn mass |
| Spawn mass | `min(100, 25 + 12·log10(1 + balance/10 000))` |
| Gold pellet (per buy) | `min(120, 10 + 30·log10(1 + eth/0.001))` mass |
| Speed | `clamp(400 / m^0.32, 18, 160)` |
| Split (Space) | each cell ≥50 mass halves toward cursor; max 8 pieces; re-merge after `min(20s, 12s + m·20ms)` |
| Eject (Q) | each cell ≥30 mass pays 16, fires a 12-mass blob anyone can collect |

## Deploy (droplet sketch)

systemd unit running `npm start` with the env above; Caddy block:

```
blobinhood.online {
    reverse_proxy /ws localhost:8790
    reverse_proxy localhost:8790
}
```

(The Node server serves `web/` itself with a strict CSP; Caddy just
terminates TLS.)

## Layout

```
server/game.js    pure simulation (no I/O) — unit-tested
server/siwe.js    SIWE message + personal_sign recovery
server/chain.js   read-only Robinhood Chain RPC: balances, buy watcher
server/index.js   http static + websocket shell, 20 Hz tick
web/index.html    static client markup + styles
web/app.js        dependency-free canvas client
docs/superpowers/ design spec and implementation plan
```
