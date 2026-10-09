# Proposed follow-up issues for tile framing

Issue drafts for implementing the "Tile framing" section of [docs/assets.md](../assets.md). They were first written by
the spikes #95 and #144; after the runtime observation and the framing database ([ADR 0003](../adr/0003-observe-framing-in-the-game.md))
they rest on the game's own results instead of cited rules. Check the backlog before filing: the block function is
#141, the drawing #146, walls #147.

The earlier drafts for an in-game amendment of #120 (H7–H10) and a measured grass cell catalogue are superseded: #120
is done and closed, and the framing database holds the game's grass and moss selection exactly.

```markdown
## Goal
A pure TypeScript function picks the sheet cell of a self-framed block from its neighbourhood exactly as the game
does, checked against the framing database.

## Scope
- `frameBlock(input) → { column, row }` in `packages/renderer/src/framing/` (no React, no DOM): input = centre type,
  the 8 neighbours (absent / type / shape), for each edge neighbour that is a relative of the centre whether its own
  cell keeps its rim toward the centre, the centre's shape and the tile's world `x, y`; output = the cell of variant
  `(7x + 11y) mod 3` (large-frame types: their position pattern).
- Neighbour letters from the framing database's relations (`relation(centre, other)`: like itself `o`, like air `x`,
  partner `d`, relative with the edge check), never from a hand-written property table.
- Cell choice by the documented steps of docs/assets.md ("Choosing the cell"): side code from the sheet map, the
  `d → x` fallback for the 28 side codes without a cell, the corner order for `oooo` (all four `x` → NW+NE; rim SE,
  SW, NE, NW; notches; plain). Shapes by the face rule; corners by presence. Variants from the database's variant map.
- Grass, moss and other types whose tables do not follow the block layout: select from the database tables directly.
- A two-pass helper over a tile region (CWM planes, no per-tile objects): pass 1 frames every tile that is not a
  partner type from its 3 × 3; pass 2 frames partner types with the edge-check bits taken from the pass-1 cells.

## Out of scope
- Drawing (#146), walls (#147), non-block self-framed ids (cactus, vines, beams), mods.

## Ownership
- packages/renderer/src/framing/ (except the generated database), its tests.

## Spec
- docs/assets.md ("Tile framing"); packages/renderer/src/framing/framing-database.ts

## Compatibility impact
- Vanilla: Render
- Modded worlds: None

## Acceptance criteria
- For every self-framed type and every other self-framed type, `frameBlock` returns the database's cell in all 6 561
  neighbourhoods of the pair (variant 0, the database's reference position), in CI.
- The variant map: v1 and v2 of every v0 cell equal the database's.
- Large-frame and grass-like types return the database's cells at all 24 positions.
- Shapes: the face rule and the corner rule hold for the documented combinations (dirt centre, every shape).
- Both sides of each boundary pair hold through the two-pass helper: worked examples 8a/8b and 14a/14b.
- The function is deterministic (no `Math.random`) and the two-pass helper allocates no per-tile objects.
- Optional, local only: with `TERRARIA_ASSEMBLY` set, neighbourhoods of three types are checked against the game
  through `scripts/framing/observe.ps1 -Mode Check`.

## Proof
- Test command: `bash scripts/verify.sh`
- Manual test: none (pure function).
```

```markdown
## Goal
The browser viewer draws self-framed blocks with their real sprite frames, including half blocks and slopes.

## Scope
- For every visible non-frame-important tile (header bitset) of a self-framed type, compute its cell with the
  two-pass helper of the block function from the CWM planes (type, active, shape) and cache it per chunk; after an
  edit recompute the 5 × 5 area around each changed tile (partner tiles depend on their relatives' cells).
- Draw the cell from the sprite atlas; half blocks and slopes per the shape table of docs/assets.md ("Slopes and
  half blocks"), checked against in-game renders.

## Out of scope
- Walls (#147), paint, lighting, animation, non-block self-framed ids.

## Ownership
- packages/renderer/, apps/web/ (only the wiring that passes the shape plane to the renderer)

## Spec
- docs/assets.md ("Tile framing", "Sprite layout", "Atlas")

## Compatibility impact
- Vanilla: Render
- Modded worlds: None

## Acceptance criteria
- A synthetic world region with worked examples 1–19 maps each listed tile (both tiles of 8a/8b and 14a/14b) to
  the documented source rectangle (asserted on rectangles, no pixels).
- A shape-2 and a shape-1 tile produce the column rectangles of the shape table.
- Editing one tile invalidates exactly the cached cells of its 5 × 5 area.

## Proof
- Test command: `bash scripts/verify.sh`
- Manual test: open a local world in the viewer with `TERRARIA_CONTENT` sheets loaded and compare a dirt/stone
  boundary, grass and slopes with the game.
```
