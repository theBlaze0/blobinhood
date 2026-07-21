# Blobin Hood v1.2 — Viruses & Player Colors

**Date:** 2026-07-20 · **Status:** approved in conversation (18 viruses, classic density)

## Viruses

- `world.viruses` maintained at **18**, random positions; constants:
  `virusMass 100` (radius 40), `virusThreshold 115`, `virusBonus 10`,
  `virusImpulse 24`.
- A cell with `m ≥ 115` whose overlap satisfies the eat rule against the
  virus (`dist < rCell − rVirus/3`) **pops** it: virus is replaced by a new
  one at a random spot (count stays 18), the cell gains `+10` mass and
  **explodes** — redistributed into `n = min(freeSlots+1, max(2, ⌊m/45⌋))`
  equal pieces, extras flung at random angles with impulse 24, all pieces
  getting standard merge timers. At the 8-cell cap (`n < 2`) the cell just
  absorbs the virus.
- Cells under 115 are unaffected (viruses are cover for small players).
- `step` emits `{t:'pop', id}` events (unused by shell for now; available
  for later sound/FX).
- Snapshot: `viruses` array (rounded coords) in **full** snaps only; the
  client hides a virus locally the moment a ≥115-mass cell covers it
  (same trick as pellets).
- Client renders a 16-spike green star, radius 40. Not on the minimap.
- Out of scope: Q-feeding viruses to launch them.

## Player colors

- `player.hue = round((id · 137.508) mod 360)` assigned at `addPlayer`
  (golden-angle spacing — consecutive joins land far apart).
- `hue` carried in snapshot `cells` entries, `board` rows, and `map.cells`.
- Client: blob gradient from `hsl(hue 80% 75%)` → `hsl(hue 60% 38%)`; own
  blob keeps the white ring; leaderboard names and minimap dots use the hue.
  Viruses remain the only spiky green things.

## Plan (TDD, one branch `viruses-colors`)

1. **game.js**: constants, virus seeding, pop/explode in `step`, `hue` in
   `addPlayer`, snapshot fields. Tests: 18 seeded in bounds & replaced
   after pop; ≥115 cell explodes (pieces ≤ cap, mass ≈ m+10 conserved,
   merge timers set); 100-mass cell safe; hues deterministic/distinct;
   snapshot carries `viruses` (full only) + `hue` everywhere.
2. **app.js**: static-layer viruses + local hide, spiked-star renderer,
   hue-based fills/board/minimap.
3. Verify (suite + autopilot + screenshot), merge, deploy (HOODRICH token
   stays configured).
