# Proposed follow-up issues from the tile-framing spike (#95)

Issue drafts written by the spike that produced the "Tile framing" section of [docs/assets.md](../assets.md).
Check the backlog before filing. The first two are the implementation; the third collects the in-game checks, the
remaining sheet measurements and the deferred grass rules.

```markdown
## Goal
A pure TypeScript function picks the sheet cell of a self-framed block from its neighbourhood, exactly as
docs/assets.md ("Tile framing") specifies.

## Scope
- `frameBlock(input) → { column, row }` in `packages/renderer` (no React, no DOM): input = centre type, the 8
  neighbours (absent / type), for each edge neighbour that is a relative of the centre whether its own cell keeps
  its rim toward the centre, and the tile's world `x, y`; output = the cell of variant `(7x + 11y) mod 3`.
- Neighbour letters by the "Viewer contract" rules 1–5 of docs/assets.md, in that order (rule 5 for ore ↔ ore is
  provisional: keep it behind one clearly named function so H4 can change it in one place).
- Cell choice by the documented steps: side code from the sheet map, the `d → x` fallback for the 28 side codes
  without a cell, and the corner order for side code `oooo`. The sheet map and the interior looks are restated as a
  typed constant from the doc (our measurement, not a TEdit table).
- A two-pass helper over a tile grid: pass 1 frames every tile that is not a partner type from its 3 × 3; pass 2
  frames partner types (dirt, ash) with the edge-check bits taken from the pass-1 cells.
- Per-id framing properties (stone family, merge partner) as a small typed table restated in docs/assets.md
  ("Tile framing", new sub-section "Framing properties") by this issue, each id cited (A12 line) and, for the
  partner flag, cross-checked against the sheet art (a sheet with rim cells has a partner). No JSON copied from TEdit.
- Shapes are ignored for the cell choice (M4 rule).

## Out of scope
- Drawing, slopes/half-block drawing, grass rules, gemspark 8-way, large-frame patterns, rows 15–21 of the taller
  sheets, walls.

## Ownership
- packages/renderer/src/framing/ (new), docs/assets.md ("Tile framing" → "Framing properties" only)

## Spec
- docs/assets.md ("Tile framing")

## Compatibility impact
- Vanilla: Render
- Modded worlds: None

## Acceptance criteria
- Worked examples 1–19 of docs/assets.md ("Tile framing") return the documented cell (variant 0), using the
  contract's result where the row lists TEdit's differing result.
- Both sides of each boundary pair hold through the two-pass helper: 8a/8b (dirt open toward a stone that keeps its
  rim) and 14a/14b (stone falls back to an outline, the dirt to its E closes its W edge).
- Every look of the sheet map is returned for some neighbourhood, for variants 0–2.
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
- For every visible non-frame-important tile (header bitset) of the block family, compute its cell with the
  two-pass helper from the CWM planes (type, active, shape) and cache it per chunk; after an edit recompute the
  5 × 5 area around each changed tile (partner tiles depend on their relatives' cells).
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
- A synthetic world region with worked examples 1–19 maps each listed tile (both tiles of 8a/8b and 14a/14b) to
  the documented source rectangle (asserted on rectangles, no pixels).
- A shape-2 and a shape-1 tile produce the column rectangles of the shape table.
- Editing one tile invalidates exactly the cached cells of its 5 × 5 area.

## Proof
- Test command: `bash scripts/verify.sh`
- Manual test: open a local world in the viewer with `TERRARIA_CONTENT` sheets loaded and compare a dirt/stone
  boundary with the game.
```

```markdown
## Goal
Confirm the tile-framing rules in the game itself, finish the sheet measurements and document the grass rules, so
the open questions O1–O6 of docs/assets.md ("Tile framing") are closed.

## Scope
- Human steps H1–H5 of docs/assets.md ("Tile framing"): results recorded as "observed in game" (G) next to each
  rule, screenshots kept in `local-renders/` only. H4 decides rule 5 (ore ↔ ore) and the ore ↔ dirt rim.
- Measure the remaining sheets (O6) with an improved classifier: the 35 dirt-partner sheets the one-outline-colour
  classifier could not prove, hellstone/ash, and rows 15–21 of the 288 × 396 sheets.
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
- Each of O1–O6 is answered (with the in-game observation or measurement) or restated with a reason why it stays
  open.
- The grass rules let an implementer map any 3 × 3 grass neighbourhood to one cell, with at least six worked examples.

## Proof
- Test command: `bash scripts/verify.sh`
- Manual test: H1–H5 in a small test world.
```
