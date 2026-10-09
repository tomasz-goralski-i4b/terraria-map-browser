# ADR 0003 — Observe tile framing by calling the game's framing on synthetic input

- **Status:** Accepted (2026-10-09)
- **Affects:** `docs/assets.md` ("Tile framing"), `scripts/framing`, the "We do not copy TEdit/tModLoader code" and
  "Decompiled Terraria code is never a source" hard rules in `AGENTS.md`, the framing follow-ups (#141, #146, #147)

## Context

Blocks without stored frames (dirt, stone, ores, grass, moss, …) pick their sprite cell from their neighbours when
the game loads them. `docs/assets.md` describes that choice as a *viewer contract*, built from three kinds of
evidence: rules cited from TEdit (read, restated, never copied), measurements of the sheet art (S), and in-game
screenshots of a generated test world (G, #120, #158).

The screenshots answered the questions they could, but several open questions cannot be settled by looking at
pixels:

- many sheet cells are pixel-identical, so a screenshot cannot tell which one the game chose (large frames,
  coralstone, parts of moss);
- the complete rules for shapes, corner priorities and moss needed far more neighbourhoods than a screenshot
  catalogue can hold;
- whether the game re-rolls variants on reload needed matched reloads.

ADR 0002 already allows observing the game's **behaviour** for the map palette: the game's own map functions are
called on synthetic input and only their results are recorded. Framing can be observed the same way.

## Decision

Tile framing may be observed by calling the installed game's own framing on synthetic input
(`scripts/framing/observe.ps1`):

- **Black box, as in ADR 0002.** The installed `TerrariaServer.exe` is loaded in a 32-bit .NET Framework host; its
  tile data is initialized by its own initialization methods; synthetic tiles are placed in a synthetic `Main.tile`
  array; `WorldGen.TileFrame` is called and only the `frameX`/`frameY` it writes are recorded. Member names come from
  runtime reflection and public API documentation. **No game code is read or decompiled**, and nothing is copied
  from TEdit or tModLoader.
- **Results are evidence, not shipped data.** The observer's output is game-derived and is never committed. The
  rules in `docs/assets.md` are our own description of what it records, written in our own words and marked with
  the evidence letter **R** (observed at runtime). Committing observed tables (for example as test vectors for the
  framing implementation) needs its own decision, like the map palette's data-only exception.
- **Opt-in conformance.** `scripts/framing/observe.test.mjs` runs the observer against a local installation when
  `TERRARIA_ASSEMBLY` is set and checks the documented rules against it; CI never sets it, and the test reports itself
  as skipped.
- **Inputs come from our own tools.** The catalogue cases are read from the generated observation world of #158 with
  our own codec (`scripts/framing/export-cases.mjs`); the exhaustive neighbourhoods, shapes and slabs are generated
  by the observer.

**User approval:** APPROVED by @tomasz-goralski-i4b on 2026-10-09, explicitly in the task conversation ("zrób
wszystko co potrzebne do weryfikacji", after being told that extending ADR 0002's behaviour observation to framing
is a rule change that is theirs to make). This approval covers observing framing behaviour as described above. It
does not constitute permission from Re-Logic, approval to ship observed tables, or approval to merge.

## Alternatives

1. **More screenshots.** Cheap to run, but cannot separate pixel-identical cells and needs a human per question.
2. **Read the framing code** (decompiled). Forbidden by the hard rules and not needed: behaviour answers the
   questions.
3. **Trust TEdit's framer.** It is a port with its own gaps (A13 states it ports the game) and its large-frame
   patterns, grass cells and corner order disagree with the game in places the observer found.

## Consequences

- `AGENTS.md` names framing observation next to the map palette in its behaviour-observation rule.
- `docs/assets.md` gains R evidence: the open questions O1–O8 and O10 are answered or narrowed with exact frames,
  and the rules that the game contradicts are corrected (corner rim priority, grass examples, moss).
- The framing implementation (#141) and the drawing issues (#146, #147) can check themselves against the game
  locally; CI keeps using the documented examples.
- The observer depends on the game's internal names (`Main.Initialize_TileAndNPCData1/2`, `Main.SetupTileMerge`,
  `WorldGen.TileFrame`, `Tile.frameNumber`, …). A game update that renames them makes the observer fail loudly with
  "Unsupported framing observation contract"; two sentinels (a dirt interior, stone beside dirt) make it fail when
  the initialization is incomplete instead of recording wrong frames.

## Rights

The observer records numbers the game computes for inputs we generate. Nothing it reads is shipped. This is a
judgement, not legal advice, and not permission from Re-Logic.
