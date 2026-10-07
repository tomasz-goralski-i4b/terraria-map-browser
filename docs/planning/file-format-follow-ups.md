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
