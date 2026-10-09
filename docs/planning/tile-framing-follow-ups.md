# Proposed follow-up issues from the tile-framing spikes (#95, #144)

Issue drafts written by the spikes that produced the "Tile framing" section of [docs/assets.md](../assets.md).
Check the backlog before filing. The first two are the block implementation (from #95, updated by #144). #95's third
draft was split: the in-game part (H1–H6) is filed as #120, and #144 did the sheet measurements and the grass
write-up. #144 adds three drafts: an amendment for #120 (H7–H10), a measured grass cell catalogue, and framing
grass, moss and large-frame blocks once those two are done.

```markdown
## Goal
A pure TypeScript function picks the sheet cell of a self-framed block from its neighbourhood, exactly as
docs/assets.md ("Tile framing") specifies.

## Scope
- `frameBlock(input) → { column, row }` in `packages/renderer` (no React, no DOM): input = centre type, the 8
  neighbours (absent / type), for each edge neighbour that is a relative of the centre whether its own cell keeps
  its rim toward the centre, and the tile's world `x, y`; output = the cell of variant `(7x + 11y) mod 3`.
- Neighbour letters by the "Viewer contract" rules 1–5 of docs/assets.md, in that order. The game confirmed rule 5
  for copper beside iron and rule 3 for copper in dirt (G, H4); other ore pairs and non-stone blocks follow the art
  and the contract (O2), so keep rules 3 and 5 behind one clearly named function.
- Cell choice by the documented steps: side code from the sheet map, the `d → x` fallback for the 28 side codes
  without a cell, and the corner order for side code `oooo`. The sheet map and the interior looks are restated as a
  typed constant from the doc (our measurement, not a TEdit table).
- A two-pass helper over a tile grid: pass 1 frames every tile that is not a partner type from its 3 × 3; pass 2
  frames partner types (dirt, ash) with the edge-check bits taken from the pass-1 cells.
- Per-id framing properties (stone family, merge partner) as a small typed table restated in docs/assets.md
  ("Tile framing", new sub-section "Framing properties") by this issue, each id cited (A12 line) and, for the
  partner flag, cross-checked against the sheet art (a sheet with rim cells has a partner; the layout agreement of
  "Measuring the sheet" lists which sheets share stone's layout). No JSON copied from TEdit. Coralstone (315) is
  framed like stone (O6); hellstone takes ash as partner; moss is framed like stone over rows 0–14 until O8 is
  answered; large-frame ids use the default variant until O4 is answered.
- Shapes by the face rule of docs/assets.md ("Slopes and half blocks", R): a side connects only when the centre's
  face and the neighbour's face toward it are whole. Shaped corner neighbours count by presence.

## Out of scope
- Drawing, slopes/half-block drawing, grass rules, gemspark 8-way, large-frame patterns, rows 15–21 of the grass
  and moss sheets, walls.

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
- Tiles of the deferred families (grass, gemspark, cactus/vines/beams) keep the current placeholder; moss and
  large-frame blocks are drawn as the framing function returns them (stone rules, default variant).

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
The in-game check of the tile-framing rules also covers grass, moss, large-frame blocks and jungle grass on mud, so
the cited grass rules and the open questions O4, O8 and O10 of docs/assets.md ("Tile framing") get an observation.

## Scope
- Amend #120 (or file next to it): add human steps H7–H10 of docs/assets.md ("Tile framing" → "Human steps") to the
  generated test world: grass examples G1–G9 (G9 also with stone), green moss on stone in four shapes, a 6 × 8 area
  of stone slab (273) and of luminite brick (409), corrupt and crimson jungle grass on mud next to dirt.
- Record each drawn cell (grass, moss) or each interior cell's position in the six-cell set (large-frame) and the
  partner seen under jungle grass, as G or as a discrepancy, in docs/assets.md.

## Out of scope
- Implementing any of it; gemspark 8-way; walls; mods; the white mask blocks of `Tiles_2` (O9).

## Ownership
- docs/assets.md ("Tile framing"), docs/planning/tile-framing-follow-ups.md; the stamping helper of #120.

## Spec
- docs/assets.md ("Tile framing" → "Grass and moss sheets", "Variant", "Human steps", "Open questions")

## Compatibility impact
- Vanilla: None (documentation and a test-world helper only)
- Modded worlds: None

## Acceptance criteria
- G1–G9 are each marked G or corrected, with the drawn cell stated.
- O4 is answered with the large-frame patterns written by world `x`/`y`, restated from the observation (not from
  TEdit), or restated with the reason it stays open.
- O8 and O10 are answered or restated with the reason they stay open.
- No screenshot, `.wld` file or extracted sprite is committed.

## Proof
- Test command: `bash scripts/verify.sh`
- Manual test: H7–H10 in the generated test world, with the world file hash and game build noted in the PR.
```

```markdown
## Goal
The grass sheets get a measured cell catalogue, so grass can be framed by "draw the cell whose look matches the
neighbourhood" like blocks, instead of from a cited rule list.

## Scope
- Improve `packages/assets/tools/sheet-measure.ts` for grass art: a side holds a grass strip where a face meets air
  and partner art elsewhere, so read each side in two halves (or along the strip) and record grass, partner and
  closed per half; corners likewise. Covered by synthetic-sheet tests.
- Measure `Tiles_2` (22 rows) and restate the catalogue in docs/assets.md ("Grass and moss sheets"): every look,
  its cells v0–v2 and the selection order where several looks fit.
- Cross-check (X) against the cited rules of docs/assets.md: for all 6 561 neighbourhoods, report how often the
  catalogue's choice equals the cited choice and list the differences; use G1–G9 (and #120's H7 results if present).

## Out of scope
- Production code; moss (O8); the white mask blocks (O9); gemspark 8-way; walls.

## Ownership
- packages/assets/tools/, packages/assets/tests/sheet-measure.test.ts, docs/assets.md ("Tile framing" →
  "Grass and moss sheets"), docs/planning/tile-framing-follow-ups.md

## Spec
- docs/assets.md ("Tile framing" → "Measuring the sheet", "Grass and moss sheets")

## Compatibility impact
- Vanilla: None (documentation and a dev tool only)
- Modded worlds: None

## Acceptance criteria
- The three variants of every grass look measure the same, or the doc states why a look's variants differ.
- Every worked example G1–G9 is reproduced by the catalogue, or the difference is listed with its reason.
- The measuring tool's new cases are covered by synthetic-sheet tests; no game file is committed.

## Proof
- Test command: `bash scripts/verify.sh`
```

```markdown
Blocked by: the in-game amendment (H7–H10) and the grass catalogue issue above.

## Goal
The viewer draws grass, moss and large-frame blocks with their real sprite frames, from the measured grass
catalogue and the in-game observations.

## Scope
- Extend the framing function of the block implementation: grass ids select from the measured grass catalogue
  (docs/assets.md, "Grass and moss sheets"); moss uses its own selection including rows 15–21, the same beside stone and dirt
  (R, O8; restate it from the framing observer, scripts/framing); the 24 large-frame ids take the observed position
  patterns of docs/assets.md ("Variant"; R, O4).
- Corrupt and crimson jungle grass (661, 662) take **mud** as partner (G, H10/O10).

## Out of scope
- Gemspark 8-way, the white mask blocks of `Tiles_2`, walls, paint, lighting.

## Ownership
- packages/renderer/src/framing/

## Spec
- docs/assets.md ("Tile framing" → "Grass and moss sheets", "Variant")

## Compatibility impact
- Vanilla: Render
- Modded worlds: None

## Acceptance criteria
- G1–G9 return their documented cells (variant 0).
- A large-frame block returns the observed pattern for a 6 × 8 area, and the function stays deterministic.
- A moss tile in each of H8's four shapes returns the observed cell.

## Proof
- Test command: `bash scripts/verify.sh`
- Manual test: open a local world with grass, moss and stone slabs in the viewer and compare with the game.
```
