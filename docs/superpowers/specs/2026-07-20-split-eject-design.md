# Blobin Hood v1.1 — Split & Eject Design

**Date:** 2026-07-20
**Status:** Design approved in conversation; pending spec review
**Builds on:** `2026-07-20-blobinhood-design.md` (v1, deployed to blobinhood.online)

## Purpose

Add agar.io's two skill moves: **spacebar splits** your blob, **Q ejects**
small collectible blobs. "Fast & casual" tuning chosen: 8-piece cap, short
merge times, small arena friendly.

## Multi-cell players (core refactor)

- `player.cells = [{x, y, m, vx, vy, mergeAt}]`, 1–8 entries. A player's
  reported mass is the sum. Spawn/respawn = one cell at spawn mass.
- **Aim is a world-space point** (protocol change): client computes
  `target = camera + (mouse − screenCenter)/zoom` and sends `{t:'aim', x, y}`
  in world units; server clamps to arena bounds. Every cell steers toward the
  target at `speed(cellMass)`.
- Impulse velocity `vx, vy` decays ×0.92 per 50 ms tick; added by split
  launch and eject recoil-free launch (blob gets the impulse, not the cell).

## Split (spacebar)

- On `{t:'split'}` (rate limit 4/s): iterate own cells largest-first; each
  cell with `m ≥ 50` and while `cells.length < 8`: halve the cell
  (`m/2` each), new piece spawns at same position launched toward the aim
  target with impulse 28 world-units/tick (≈ a half-viewport lunge as it
  decays), `mergeAt = now + min(20_000, 12_000 + m·20)` ms set on BOTH
  pieces.
- Sibling cells never eat each other. While either is pre-merge they collide
  softly (push-apart like unrelated cells). When two sibling cells overlap
  (centers closer than `max(rA, rB)`) and BOTH are past `mergeAt`, they
  merge: one cell at summed mass, mass-weighted centroid position.

## Eject (Q)

- On `{t:'eject'}` (rate limit 10/s): every own cell with `m ≥ 30` pays
  16 mass; an ejected blob of mass 12 spawns at the cell's edge toward the
  aim target, launched with impulse 22, decaying to rest.
- Ejected blobs live in `world.ejected` (cap 200, oldest dropped), rendered
  as small bright-green dots, and are eaten by ANY cell that touches them
  (owner included) for +12 mass. They never expire otherwise.

## Eat & death semantics

- Player-vs-player eating is per-cell: cell A eats enemy cell B when
  `mA ≥ 1.25·mB` and centers overlap (`dist < rA − rB/3`); A gains 80 %.
- `eat` event carries `fatal: true` only when B was the victim's last cell —
  only then does the victim get `deadUntil`, the `dead` message, and the
  respawn-at-spawn-mass flow. Non-fatal piece losses just shrink the total.
  `eats` count increments per enemy cell eaten.
- Pellets/gold: any cell collects; `creditBuy` adds to the largest cell.

## Protocol & shell

- New C→S: `{t:'split'}`, `{t:'eject'}`; aim payload is now world-space.
  Rate limits enforced in the shell per snap window (split ≤4/s, eject
  ≤10/s, aim unchanged ≤20/s).
- Snapshot: `cells` entries become per-cell `{pid, name, x, y, m}`; `me`
  gains `cells: [{x, y, m}]` plus centroid `x, y` and total `m`; `board`
  and `map` aggregate per player (centroid + total mass).

## Client

- Space → split, Q → eject (keydown, `preventDefault` on Space; keys inert
  while the name input is focused or not playing).
- Camera follows the centroid of own cells; zoom driven by total mass.
- Renders all cells (own pieces highlighted as before), ejected blobs as
  4-px bright dots.
- Aim: on mousemove/touch compute the world-space target from current
  camera/zoom and send it; keep 20/s throttle.
- Mobile split/eject buttons: out of scope for v1.1.

## Bots & tests

- Wandering-bot snippets aim at `pos + dir·1000` world points.
- New/updated `node --test` coverage: split halves mass and respects the
  8-cap and mass-50 floor; merge only after both timers; siblings never eat
  each other; enemy per-cell eat with `fatal` only on last cell; eject
  conserves (−16 payer, +12 blob) and blobs are collectible by others;
  ejected cap 200; aim clamped to bounds. Existing tests updated to the new
  snapshot/cell shapes.

## Out of scope

Viruses, mass decay, mobile buttons, spectate-follow-player, split/eject
animations beyond impulse motion.

## Deploy

Same as v1: `bash deploy/deploy.sh` after merge; no config changes.
