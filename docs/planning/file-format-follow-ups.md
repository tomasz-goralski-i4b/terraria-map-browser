# Proposed follow-up issues from the format spikes

Issue drafts written by the `spike` steps while specifying the `.wld` format (moved out of the format
specification so that chain steps do not read them). Some are already done or filed; check the backlog first.

```markdown
**Status:** done (#5, #6).

## Goal
The reference .NET codec recognises a .wld file and returns its header and section table, or a precise error.

## Scope
- Reader for the file header, section table and frame-important bits exactly as in docs/file-format.md.
- Result type: Ok / Truncated / NotAWorld / UnsupportedVersion / MalformedSectionTable.

## Out of scope
- Metadata, tile payload, other sections, writer, modded worlds.

## Ownership
- dotnet/Terraria.WorldCodec/, dotnet/Terraria.WorldCodec.Tests/

## Compatibility impact
- Vanilla: Render (recognition only)
- Modded worlds: None

## Acceptance criteria
- Vectors A–E from docs/file-format.md give the documented results.
- All M1 fixtures parse with the pointers and frame-important set listed in the manifest/doc.

## Proof
- Fixture: packages/test-fixtures/worlds/*.wld
- Test command: `bash scripts/verify.sh`
```

```markdown
**Status:** not filed.

## Goal
M1 accepts worlds from every 1.4.5.x build, not only 1.4.5.8.

## Scope
- Generate one vanilla fixture per format version 315–325 that has a release, compare header/section layout,
  widen the supported range in docs/file-format.md.

## Out of scope
- Versions before 315; codec changes beyond the range check.

## Ownership
- docs/file-format.md (Versions), packages/test-fixtures/

## Compatibility impact
- Vanilla: Render
- Modded worlds: None

## Acceptance criteria
- Each newly supported version has a fixture and a manifest entry; the version table is updated.

## Proof
- Test command: `bash scripts/verify.sh`
```

```markdown
**Status:** done (#7).

## Goal
The reference .NET codec reads world metadata (name, seed, GUID, id, dimensions, mode, evil) of a 1.4.5.8 world.

## Scope
- Reader for section 1 exactly as in docs/file-format.md ("World metadata"), including all consumed fields,
  ending exactly at pointer[1].
- Result: metadata record or MalformedMetadata { field, offset, reason }.

## Out of scope
- Tiles, other sections, writer, versions other than 326.

## Ownership
- dotnet/Terraria.WorldCodec/, dotnet/Terraria.WorldCodec.Tests/

## Compatibility impact
- Vanilla: Render (metadata only)
- Modded worlds: None

## Acceptance criteria
- Vectors M1–M5 from docs/file-format.md give the documented results.
- All M1 fixtures give name, seed, dimensions and mode from the manifest; evil matches the tiles
  (the world named "SCCR1" in game is the corruption fixture `SCCO1.wld`).
- Width/height ≤ 0 and the safety limits are rejected.

## Proof
- Fixture: packages/test-fixtures/worlds/*.wld
- Test command: `bash scripts/verify.sh`
```

```markdown
**Status:** done (#8).

## Goal
The reference .NET codec decodes the tile section of a 1.4.5.8 world into Tile/ContentRef values.

## Scope
- Tile reader exactly as in docs/file-format.md ("Tile data", "Model mapping"), including the additive
  fields (shape, inactive, wallPaint, invisible/full-bright flags) as .NET tile properties.
- Error MalformedTiles { x, y, offset, reason }.

## Out of scope
- Writer, run-length encoding on save, sections 3–10, mod registry.

## Ownership
- dotnet/Terraria.WorldCodec/, dotnet/Terraria.WorldCodec.Tests/

## Compatibility impact
- Vanilla: Render
- Modded worlds: None

## Acceptance criteria
- Vectors T1–T17 and R1–R10 from docs/file-format.md give the documented results.
- All M1 fixtures decode and stop exactly at pointer[2].
- Ids above 753 (blocks) / 366 (walls) map to unknown { runtimeId }.

## Proof
- Fixture: packages/test-fixtures/worlds/*.wld
- Test command: `bash scripts/verify.sh`
```

```markdown
**Status:** done — the `Tile` type in `packages/world-model` carries every vanilla flag the codec reads.

## Goal
The TS world model can represent every vanilla tile flag that the codec reads, so nothing is lost.

## Scope
- Add the optional fields shape, inactive, wallPaint, invisibleBlock, invisibleWall, fullBrightBlock,
  fullBrightWall to `Tile` in packages/world-model, as listed in docs/file-format.md ("Model mapping");
  update docs/architecture.md's model snippet.

## Out of scope
- TS codec, renderer.

## Ownership
- packages/world-model/, docs/architecture.md (World model section)

## Compatibility impact
- Vanilla: None (model only)
- Modded worlds: None

## Acceptance criteria
- A Tile with all additive fields type-checks; a Tile without them still type-checks (fields optional).

## Proof
- Test command: `bash scripts/verify.sh`
```

```markdown
**Status:** done — evil labels and the manifest↔file check (open question 5), and the classic crimson fixture
`SCCR2.wld`.

## Goal
The M1 fixture corpus labels each world's evil biome correctly and includes a crimson world in classic mode.

## Scope
- Fix SCCR1's `evil` in manifest.json to `corruption` (and rename if the naming key requires it), or regenerate
  a classic crimson world; record which.
- A fixture check that compares the manifest `evil` with the metadata crimson flag.

## Out of scope
- Codec changes.

## Ownership
- packages/test-fixtures/, scripts/check-fixtures.mjs

## Compatibility impact
- Vanilla: None
- Modded worlds: None

## Acceptance criteria
- For every fixture the manifest `evil` equals the crimson flag at metadata row 22 (docs/file-format.md).

## Proof
- Fixture: packages/test-fixtures/worlds/*.wld
- Test command: `bash scripts/verify.sh`
```

Follow-ups from the writer contract (#32). The writer, envelope, backup and in-game check themselves are
planned as #38–#41, #44 and #45 (#38 envelope and #39 tile encoder are done; #40, #41, #44 and #45 are open); these cover what the contract leaves open.

```markdown
**Status:** not filed.

## Goal
The corpus shows how Terraria 1.4.5.8 itself saves the tiles the writer contract treats specially.

## Scope
- A human generates one Small vanilla world in 1.4.5.8 and places, then saves in game: a vertical stack of
  food platters (520) and of logic sensors (423), an ice-rod block (127), a block and a wall with paint 31,
  and a block with illuminant coating; adds it to the manifest with the next sequence number.
- Record in docs/file-format.md (open questions 10 and 11) whether the game merged the 520/423 stacks into
  runs, kept block 127, and how paint 31 / the coating were stored.

## Out of scope
- Codec changes (a needed change becomes its own issue).

## Ownership
- packages/test-fixtures/, docs/file-format.md (Open questions, Writer contract evidence)

## Compatibility impact
- Vanilla: None (evidence only)
- Modded worlds: None

## Acceptance criteria
- The new fixture passes scripts/check-fixtures.mjs and decodes with the M1 rules.
- docs/file-format.md states, with offsets in the new fixture, how each of the listed tiles is stored.

## Proof
- Fixture: packages/test-fixtures/worlds/<new>.wld
- Test command: `bash scripts/verify.sh`
- Manual test: in-game placement as listed in Scope
```

```markdown
**Status:** not filed (open question 14 is still open).

## Goal
Every view of a tile agrees with the writer about "no paint", so round-trip comparisons need no special case.

## Scope
- Decide (and implement in .NET) whether a present paint / wall-paint byte 0 is read as absent in the `Tile`
  view and the export-json region output, as CWM already does (docs/file-format.md open question 14).

## Out of scope
- CWM layout and digests (unchanged either way), the writer.

## Ownership
- dotnet/Terraria.WorldCodec/ (tile view), dotnet/Terraria.WorldCodec.Tests/, docs/file-format.md (Model mapping)

## Compatibility impact
- Vanilla: Render (view only)
- Modded worlds: None

## Acceptance criteria
- Reading `03 01 08 01 00` gives the same `Tile` as reading `02 01`; golden summaries are unchanged.

## Proof
- Test command: `bash scripts/verify.sh`
```

## From the entity sections spike (#153)

The drafts below follow [../file-format/entities.md](../file-format/entities.md). The .NET decoder (#165) and
the previously unfiled TS decoder are implemented together under #165, with independent parsers and shared
entity vectors. The TS implementation follows the .NET implementation in a separate commit. Next come the
Entities panel and the entity test world (#166), followed by the human check in game (#167).

```markdown
**Status:** implemented with #165; pending review and merge. No separate TS issue was filed.

## Goal
The TS codec decodes sections 3–10 of a 1.4.5.8 world read-only, so the viewer can list chests, signs, NPCs and
other entities.

## Scope
- `readWorldEntities` in packages/world-codec: from the section table, decode sections 3–10 exactly as
  in docs/file-format/entities.md ("Decoding rules", sections 3–10) and return the fields of "Proposed read-only
  model"; consumed-only fields are parsed and dropped.
- Each section succeeds or fails on its own: a failure is `MalformedSection { section, field, offset, reason }`
  and does not affect tiles, metadata or the other sections.
- Run it in the world Worker after the tiles; the result is plain data (no per-tile objects).
- `readWorldTiles` returns `entities` for every readable format (269–279, 315–319, 325–326) in that format's
  layout, so the existing Worker protocol transfers the same section results to the viewer.
- Shared `entities.vectors.json` inputs run directly against the independent .NET and TS parsers; their
  schema is `entities-vector.v1.schema.json`. Every result or error field is compared, including absolute offsets.

## Out of scope
- Editing or writing these sections; item/NPC/tile display names; versions other than 326; mods.

## Ownership
- packages/world-codec/

## Spec
- docs/file-format/entities.md (all sections), docs/file-format/metadata.md ("Primitive types")

## Compatibility impact
- Vanilla: Render (read-only entity lists)
- Modded worlds: None

## Acceptance criteria
- Every corpus world decodes with the counts and section sizes of "Corpus evidence" (e.g. SCCO1: 190 chests,
  1212 filled slots, NPCs 37 and 22 with homes (3625, 296) and (2104, 279), six creative powers).
- Synthetic sections cover one record of every kind the corpus lacks: a sign, a mob, each tile-entity kind
  0–10 (incl. a display doll with slot 8 and the misc slot), a pressure plate, a room, bestiary entries.
- A section that stops before or after its pointer, an unknown tile-entity kind, an unknown power id, a Bool
  byte 2 and an NPC extra-bits byte with bit 1 set each fail only their own section, at the documented offset.

## Proof
- Fixture: packages/test-fixtures/worlds/*.wld
- Test command: `bash scripts/verify.sh`
```

```markdown
**Status:** not filed.

## Goal
The viewer lists a world's chests, signs, NPCs and tile entities, and jumps the map to the one the user picks.

## Scope
- Consume the format-326 `WorldTilesResult.entities` section results supplied by the Worker (#165). For
  older formats without `entities`, show that entity decoding is unavailable rather than inventing empty lists.
- An Entities panel in apps/web with one group per section (chests, signs, town NPCs, mobs, tile entities,
  pressure plates, rooms), showing ids (no display names), position and the main fields of
  docs/file-format/entities.md ("Proposed read-only model"); bestiary counts and creative powers as a summary.
- "Go to on map": centre the map on the entry's tile (NPCs and mobs: position ÷ 16) and mark it.
- A section that failed to decode is shown as unreadable with its error; the rest of the panel still works.
- Chest/sign entries whose tile is not a chest/sign tile are marked (derived from the tile planes).

## Out of scope
- Editing entities, item/NPC names and icons, search/filter beyond a simple text filter.

## Ownership
- apps/web/

## Spec
- docs/file-format/entities.md ("Proposed read-only model")

## Compatibility impact
- Vanilla: Render
- Modded worlds: None

## Acceptance criteria
- Loading SCCO1 lists 190 chests and 2 town NPCs; choosing a chest centres the map on its tile.
- A world whose tile-entity section fails still shows its chests and NPCs and names the failed section.

## Proof
- Fixture: packages/test-fixtures/worlds/SCCO1.wld
- Test command: `bash scripts/verify.sh`
- Manual test: load SCCO1, open Entities, go to the first chest and the Guide's home.
```

```markdown
**Status:** implemented (#165), including the previously unfiled TS decoder above; pending review and merge.

## Goal
The reference .NET codec decodes sections 3–10 read-only, and both codecs agree on shared vectors.

## Scope
- Decoder in dotnet/Terraria.WorldCodec for sections 3–10 as in docs/file-format/entities.md; `inspect` prints
  per-section counts.
- Entity vectors (one record per kind, plus the failures listed in the TS decoder issue) in contracts/vectors/,
  run by xUnit and Vitest.

## Out of scope
- Writing these sections (ReadForSave keeps them verbatim, unchanged), versions other than 326, mods.

## Ownership
- dotnet/Terraria.WorldCodec/, dotnet/Terraria.WorldCodec.Tests/, dotnet/Terraria.WorldInspector/, contracts/

## Spec
- docs/file-format/entities.md (all sections)

## Compatibility impact
- Vanilla: Render
- Modded worlds: None

## Acceptance criteria
- The corpus counts and section sizes of "Corpus evidence" are reproduced for all five worlds.
- The shared entity vectors pass in xUnit and Vitest.

## Proof
- Test command: `bash scripts/verify.sh`
```

The entity sections are checked in game the same way as tile framing (#158 generates the world, #120 is the
human check): the generator writes every record the spec describes, the game loads and **re-saves** the world,
and the game's own save is the evidence. The two drafts below close the gaps of entities.md ("Coverage limit")
and open questions 15–17.

```markdown
**Status:** filed (#166). Blocked by: #158, #165.

## Goal
The test-world generator also stamps an Entities section — every object of docs/file-format/entities.md with
its section 3–10 record — so the TEdit-only layouts can be checked in game without building anything by hand.

## Scope
- An **Entities** section in the #158 case catalogue (`dotnet/Terraria.WorldCodec.Synthetic/`). Each case
  places the object's tiles (frame-important frames, top-left anchor) and writes the matching record into its
  section, encoded exactly as in docs/file-format/entities.md:

| Case | Gap it closes | Tiles placed | Record written |
|---|---|---|---|
| E1 signs | section 4 | sign 55, grave marker 85, announcement box 425, tattered sign 573 | one text each: plain, with a line break, non-ASCII ("Zażółć"), empty |
| E2 chest | section 3 name, stack, prefix | chest 21 | name "E2", a max stack, a prefixed item, an empty slot between filled ones |
| E3–E13 tile entities | section 6, kinds 0–10 | training dummy 378, item frame 395, logic sensor 423, display doll 470, weapon rack 471, hat rack 475, food platter 520, pylon 597, Dead Cells jar 698, kite anchor 723, critter anchor 724 | one per kind; the doll with item, dye and misc slots incl. slot 8; hat rack with 2 items + 2 dyes |
| E14 pressure plate | section 7 | a weighted pressure plate (tile id: open question 15 — the case stays "to observe" until known) | its position |
| E15 house | section 8 | a closed room with walls, door, light, table, chair | no room entry (the human assigns housing in game) |
| E16 bestiary | section 9 | — | two kill entries, one seen, one chatted (keys: open question 15) |
| E17 powers | section 10 | — | ids 0, 8–10, 12–14 with non-default values |
| E18 shimmered NPC | section 5 | — | one shimmered town NPC id |

- The generator manifest lists per case: section, coordinates, the record written and its byte offsets.
- `Terraria.WorldInspector` prints the decoded record of a case from the manifest coordinates.

## Out of scope
- Running the game (the human check below); editing entities in the editor; modded items; committing the
  generated world or manifest.

## Ownership
- `dotnet/Terraria.WorldCodec.Synthetic/`, `dotnet/Terraria.WorldCodec.Tests/`, `dotnet/Terraria.WorldInspector/`

## Spec
- docs/file-format/entities.md (all sections), docs/assets.md ("Tile framing" → "Human steps")

## Compatibility impact
- Vanilla: None (test tooling only; output is a disposable world)
- Modded worlds: None

## Acceptance criteria
- Reading the output back with the .NET entity decoder gives every case's record at its manifest coordinates,
  and every section 3–10 ends at its pointer.
- Every object's tiles are placed with the frames of its anchor, inside the cleared strip, 2 tiles apart.
- The same inputs give a byte-identical world and manifest; an existing output path is refused.

## Proof
- Test command: `bash scripts/verify.sh`
- Manual test: generate the world and open it in Terraria 1.4.5.8 (the checks are the next issue).
```

```markdown
**Status:** filed (#167, human). Blocked by: #166.

## Goal
Confirm in Terraria 1.4.5.8 that the entity layouts of docs/file-format/entities.md are what the game reads and
writes, and answer open questions 15–17.

## Scope
- Generate the test world (note world and manifest hashes), open it in 1.4.5.8 and check each case E1–E18:
  sign texts read correctly, the chest shows its name and items, every tile entity shows its item/doll/hat
  and works (pylon, sensor), Journey powers show the written values, the bestiary shows the written entries.
- In game, additionally: assign housing to a town NPC in the E15 house; kill and talk to a few NPCs; save while
  enemies are on screen (mobs); then **save and exit**.
- Decode the game-saved world and compare every section 3–10 with the generated one, record by record. Record in
  docs/file-format/entities.md ("Corpus evidence") what the game kept, changed, dropped or added (e.g. the town
  manager entry for E15, the mob list, the NPC extra-bits byte, positions not on the top-left tile), with offsets.
- Answer or narrow open questions 15–17 (incl. the weighted pressure plate tile id and the bestiary key format).

## Out of scope
- Changing the generator or the codecs (a needed change becomes its own issue); committing any `.wld` file or
  screenshot.

## Ownership
- docs/file-format/entities.md, docs/file-format/open-questions.md

## Spec
- docs/file-format/entities.md, docs/file-format/open-questions.md (15–17)

## Compatibility impact
- Vanilla: None (documentation only)
- Modded worlds: None

## Acceptance criteria
- Each case E1–E18 has a recorded in-game result (shown correctly / discrepancy).
- The game-saved world decodes with entities.md, and every record difference from the generated world is
  explained in the doc or filed as a spec correction.
- Open questions 15–17 are answered or restated with the reason they stay open.

## Proof
- Test command: `bash scripts/verify.sh`
- Manual test: the in-game steps above, with world/manifest hashes and the game build noted in the PR.
```
