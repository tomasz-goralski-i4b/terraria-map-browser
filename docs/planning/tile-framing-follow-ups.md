# Proposed follow-up issues from the tile-framing spike (#95)

Issue drafts written by the spike that produced the "Tile framing" section of [docs/assets.md](../assets.md).
Check the backlog before filing. The first two are the implementation; the third collects the in-game checks and
the deferred grass rules.

```markdown
## Goal
A pure TypeScript function picks the sheet cell of a self-framed block from its 3 × 3 neighbourhood, exactly as
docs/assets.md ("Tile framing") specifies.

## Scope
- `frameBlock(input) → { column, row }` in `packages/renderer` (no React, no DOM): input = centre type and shape,
  the 8 neighbours (absent / type), the tile's world `x, y`; output = the cell for variant `(7x + 11y) mod 3`.
- Neighbour classification (absent / connected / merge partner / other) with the recommended model of open question
  O2 (stone-family behaviour for every tile that has a partner; dirt sees its relatives as connected).
- Per-id framing properties (stone family, merge partner) as a small typed table restated in docs/assets.md
  ("Tile framing", new sub-section "Framing properties") by this issue, each id cited (A12 line) and, for the
  partner flag, cross-checked against the sheet art described in the doc (a sheet with dirt-rim cells has dirt as
  its partner). No JSON copied from TEdit.
- Shapes are ignored for the cell choice (M4 rule).

## Out of scope
- Drawing, slopes/half-block drawing, grass rules, gemspark 8-way, large-frame patterns, the back-check, walls.

## Ownership
- packages/renderer/src/framing/ (new), docs/assets.md ("Tile framing" → "Framing properties" only)

## Spec
- docs/assets.md ("Tile framing")

## Compatibility impact
- Vanilla: Render
- Modded worlds: None

## Acceptance criteria
- Worked examples 1–15 of docs/assets.md ("Tile framing") return the documented cell (variant 0).
- All 16 plain cases and the five "all four" corner rules return the documented cells for variants 0–2.
- Every merge-partner row of the decision table returns its cell; an unlisted partner edge set falls back to the
  plain cell.
- The variant is `(7x + 11y) mod 3` and the function is deterministic (no `Math.random`).

## Proof
- Test command: `bash scripts/verify.sh`
- Manual test: none (pure function).
```

```markdown
## Goal
The browser viewer draws dirt, stone, ores and other self-framed blocks with their real sprite frames, including
half blocks and slopes.

## Scope
- For every visible non-frame-important tile (header bitset) of the block family, compute its cell with
  `frameBlock` from the CWM planes (type, active, shape) and cache it per chunk; recompute a 1-tile border around
  any edited region.
- Draw the cell from the sprite atlas; half blocks and slopes per the shape table of docs/assets.md ("Slopes and
  half blocks"): eight 2-pixel columns, shifted per shape.
- Tiles of the deferred families (grass, gemspark, cactus/vines/beams) keep the current placeholder.

## Out of scope
- Grass rules, gemspark 8-way, large-frame patterns, walls framing changes, paint, lighting, animation.

## Ownership
- packages/renderer/, apps/web/ (only the wiring that passes the shape plane to the renderer)

## Spec
- docs/assets.md ("Tile framing", "Sprite layout", "Atlas")

## Compatibility impact
- Vanilla: Render
- Modded worlds: None

## Acceptance criteria
- A synthetic world region with worked examples 1–15 maps each centre tile to the documented source rectangle
  (asserted on rectangles, no pixels).
- A shape-2 and a shape-1 tile produce the column rectangles of the shape table.
- Editing one tile invalidates exactly its 3 × 3 neighbourhood's cached cells.

## Proof
- Test command: `bash scripts/verify.sh`
- Manual test: open a local world in the viewer with `TERRARIA_CONTENT` sheets loaded and compare a dirt/stone
  boundary with the game.
```

```markdown
## Goal
Confirm the tile-framing rules in the game itself and document the grass rules, so the open questions O1–O5 of
docs/assets.md ("Tile framing") are closed.

## Scope
- Human steps H1–H5 of docs/assets.md ("Tile framing"): results recorded as "observed in game" (G) next to each
  rule, screenshots kept in `local-renders/` only.
- Grass: restate the grass rule set (A10 150–249, relaxed corner matching 454–505) in our own words with worked
  examples, and explain the taller grass sheets (`Tiles_2` 110 rows, `Tiles_60` 22 rows).
- Large-frame variant patterns (24 ids): describe them from in-game observation.

## Out of scope
- Code; gemspark 8-way; walls; mods.

## Ownership
- docs/assets.md ("Tile framing"), docs/planning/tile-framing-follow-ups.md

## Spec
- docs/assets.md ("Tile framing")

## Compatibility impact
- Vanilla: None (documentation only)
- Modded worlds: None

## Acceptance criteria
- Each of O1–O5 is answered (with the in-game observation) or restated with a reason why it stays open.
- The grass rules let an implementer map any 3 × 3 grass neighbourhood to one cell, with at least six worked examples.

## Proof
- Test command: `bash scripts/verify.sh`
- Manual test: H1–H5 in a small test world.
```
