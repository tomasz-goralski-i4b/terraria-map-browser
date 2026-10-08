# Vanilla format compatibility

The TS viewer resolves a file's format number to a feature profile and uses one header/metadata/tile parser
for all admitted profiles. It does not require a separate resolver or codec for each game patch. The result
is always the same Canonical World Model, so rendering does not dispatch on file version.

The resolver corrects the former vanilla residual-shape validation in both codecs and the .NET writer (see
[residual shapes](tiles.md#residual-shapes-are-vanilla-data)); it contains no mod-sidecar loading. The .NET
reference codec and writer remain at format 326. [ADR 0003](../adr/0003-vanilla-format-profiles.md) records
the decision.

## Admission and evidence

Admission is a deliberate list of known released ranges, separate from structural feature thresholds.
Knowing that a field appeared in 284 does not imply that every number from 284 onward is a supported release.

| Format numbers | Desktop game family | TS viewer read | Evidence in this implementation |
|---|---|---|---|
| 269–279 | 1.4.4 through 1.4.4.9 | Experimental | Independent generated metadata/tile vectors for every number; 279 also passes the [local world check](#local-world-check) |
| 315–319 | 1.4.5.0 through 1.4.5.6 | Experimental | Independent generated metadata/tile vectors for every number |
| 325 | 1.4.5.7 | Experimental | Independent generated metadata/tile vectors |
| 326 | 1.4.5.8 | Existing supported read | Five generated-world fixtures plus shared vectors |
| ≤ 268 | Earlier layouts | Rejected | Additional field/section/tile layouts are not implemented |
| 280–314, 320–324 | No admitted release in this scope | Rejected | Feature thresholds alone are not evidence of a compatible released file |
| ≥ 327 | Unknown/future | Rejected | Never silently interpreted using the last known layout |

These are 18 distinct format numbers, not 18 different parsers. Several game builds share format 315;
the file's format number cannot identify their exact patch version. Extra formats are not advertised as
fixture-verified simply because a synthetic world passes. The browser colours still use the shipped
1.4.5.8 palette; exact visual parity with older games is not established.

## Resolver API

`packages/world-codec/src/world-format.ts` is the runtime definition of admitted ranges and feature gates.
The package exports `resolveWorldFormat`, `SUPPORTED_VANILLA_FORMATS` and profile/feature types.

```ts
import { resolveWorldFormat, readWorldTiles } from "@studio/world-codec";

const profile = resolveWorldFormat(279);
// family: "terraria-1.4.4", evidence: "synthetic"
// metadata.lastPlayed: false; entities.chestSlotCounts: "shared-int16"

const world = readWorldTiles(bytes); // Automatically resolves the version in the file header.
```

The public resolver returns `null` for an unadmitted number, a fraction, NaN or infinity. It does not parse
bytes or validate that a supplied file is a world. Parsing entry points separately validate the signature,
file type, section table, metadata and tile records. Their internal `requireWorldFormat` preserves
`UnsupportedVersion` at offset 0 before any signature or section checks.

Profiles are immutable. They describe the common eleven-section header, four-header-byte RLE tile encoding, the
vanilla id ranges, metadata field presence and entity layout differences. Selection happens outside tile loops. The CWM and
worker protocol are unchanged; the worker uses the same parser and transfers the same plane buffers.

## Vanilla id ranges

Each game release defines a fixed set of block and wall types; a file can hold higher ids only when content
outside that release wrote them (a mod, or a newer game). The profile states the highest block id
(`maxTileId`) and highest wall id (`maxWallId`) of its release range. The tile decoder labels an id up to that
limit `vanilla` and any higher id `unknown` (its raw number kept as `runtimeId`), so a format-279 wall 350 is
never shown as the 1.4.5 wall that later took that number.

| Format numbers | Highest vanilla block id | Highest vanilla wall id |
|---|---|---|
| 269–279 | 692 | 346 |
| 315–319 | 752 | 366 |
| 325–326 | 753 | 366 |

The limits are equal for every format number inside a range (source T41 lists them per save number), and they are
the "highest id", not a count: format 326 has 754 block types, ids 0–753. They are independent of the
header's frame-important count, which only bounds which block ids a file can encode at all. The .NET reference
codec reads only format 326 and uses the same 753/366 limits. Rendering still uses the 1.4.5.8 colour table
for every vanilla id.

## Metadata changes

All admitted versions already contain the eight original special-seed flags, moondial, shimmer-era tile
encoding and the shared metadata prefix. These later fields vary:

| Feature | First format | Metadata row | Reader action |
|---|---|---|---|
| Last played | 284 | 15 | Consume an additional Int64 |
| Permanent holiday flags | 287 | 52 | Consume two booleans |
| Vampire seed | 288 | 53 | Consume one boolean |
| Claimable banners | 289 | 35 | Read a counted UInt16 list |
| Meteor/coin counts | 291 | 54 | Consume two Int32 values |
| Infected seed | 296 | 53 | Consume one boolean |
| Team-spawns seed and positions | 297 | 55 | Boolean, UInt8 count, Int16 coordinate pairs |
| World-generation manifest | 299 | 59 | Read a bounded UTF-8 string |
| Skyblock seed | 302 | 13 | Read a ninth special-seed boolean |
| Dual-dungeons seed | 304 | 56 | Consume one boolean |
| Lightning seeds | 323 | 57 | Consume two booleans |

Read order remains the physical order in [metadata.md](metadata.md), not the numerical order of thresholds:
infected seed precedes meteor/coin counts despite its higher threshold. Formats 299–312 also had a deprecated
UInt32 (row 58); none is admitted, so the parser does not need that branch yet. Layouts 269–279 end after the
moondial cooldown, 315–319 contain the newer metadata but no lightning flags, and 325–326 include lightning.

Strings, list bounds, booleans, dimensions and exact section consumption keep their existing validation.
Version selection cannot hide unread bytes or turn a malformed section into a successfully loaded world.

## Other sections and older families

The resolver describes these entity changes for future reader work. The current TS viewer still treats
those sections as opaque; a resolved profile does not imply implemented entity decoding.

| Element | Before the change | Change threshold | After the change |
|---|---|---|---|
| Chest slot counts | Shared Int16 after chest count | 294 | Int32 per chest |
| Display-doll pose | Absent | 307 | Pose byte |
| Display-doll extra slots | Absent | 308 | Extra-presence byte and additional stacks |
| NPC homeless-despawn | Absent | 315 | Boolean per town NPC |

Framing comes from the input's bit array; there is no version-specific copied framing table. Tile decoding
and owner/reserved-bit/RLE checks are shared. Defined shapes without an active block are accepted and
preserved in every admitted version: our former vanilla validation was incorrect, as confirmed by calling
the unmodified vanilla format-326 writer on synthetic input. See
[residual-shape evidence](tiles.md#residual-shapes-are-vanilla-data). This is not a mod-specific bypass;
undefined shapes and ownerless payload flags remain errors.

Much older worlds need a few genuinely different layout families: fixed header fields appear from 140,
section count changes at 220, the wall high byte at 222 and the fourth tile flag byte/shimmer at 269.
Files through 87 predate the section-table layout. See [header.md](header.md), [tiles.md](tiles.md) and
[sources-and-versions.md](sources-and-versions.md). Supporting them requires describing those differences,
not assigning a separate parser to every patch. No unsupported legacy family is guessed into this parser.

## Reading versus writing

The TS viewer only reads additional formats. It does not convert the input to 326 or modify any source world.
The .NET writer still rejects non-326 worlds. Older-format saving will need target-profile field emission,
content representability checks and preservation of opaque sections; a successful read is not permission
to serialize using a different layout. Unsupported downgrade fields/content must not be silently dropped.

## Extending coverage

1. Verify whether the new number is released and whether its structure changes, using cited primary/source
   evidence and independently generated worlds. Keep game-version naming separate from structural support.
2. Describe each new field or changed layout once in the format docs. Add its threshold or layout variant
   to the shared profile; keep byte order and field order explicit.
3. Add independent vectors that fail before implementation. Cover both sides of changed boundaries,
   framing/RLE, exact section ends and structured error ordering. Reuse the parser and CWM expectations.
4. Extend admission only after its layout is implemented. Unknown gaps stay rejected. For a release that
   shares a layout, existing section readers remain unchanged; admission and evidence are the only updates.
5. Add real generated-world fixtures for each distinct structural family/boundary when available, with
   small metadata/chunk-digest goldens. Promote evidence separately from experimental admission.
6. Implement and compare the same contract independently in .NET before making multi-version support part
   of the stable cross-codec contract. Run `bash scripts/verify.sh` and require `VERIFY: OK`.

The fixture generator deliberately uses three independently named released layouts rather than importing
the production resolver. Tests exercise all 18 admitted versions, unknown gaps, strict section boundaries,
vanilla owner checks, and representative File parsing through a real browser Worker. The existing 326
corpus and differential/shared-vector tests remain in the verification suite.

## Local world check

Real worlds are never committed (AGENTS.md, hard rules), so CI only sees synthetic vectors for formats other
than 326. `packages/world-codec/tests/local-worlds.test.ts` is an opt-in check against worlds on the
developer's machine: set `STUDIO_LOCAL_WORLDS` to a directory of `.wld` files and run

    pnpm vitest run packages/world-codec/tests/local-worlds.test.ts

Each file must decode completely (header, exact metadata and tile section ends, every record), resolve to an
admitted profile, and yield planes whose block/wall references stay inside the palette. Nothing derived from the
worlds is written. Unset, the suite is reported as skipped.

Recorded runs (2026-10-08): two tModLoader 1.4.4.9 worlds (format 279, 13,400 × 3,800 and a second
custom-size world, about 50 MB each) decode in about three seconds in total. Formats 315–319 and 325 have not
yet been checked against a real world.

## Sources and provenance

Rules are restated independently; no third-party code, framing lists, assets or player worlds are vendored.
At TEdit revision `182031b83ce825719f857a6db4ecb6967118abd3`:

- T41: [`Data/versions.json:753–962`](https://github.com/TEdit/Terraria-Map-Editor/blob/182031b83ce825719f857a6db4ecb6967118abd3/src/TEdit.Terraria/Data/versions.json#L753-L962): highest block and wall id per save number, summarized per range in [vanilla id ranges](#vanilla-id-ranges).
- T1: [`Data/versions.json:1–90`](https://github.com/TEdit/Terraria-Map-Editor/blob/182031b83ce825719f857a6db4ecb6967118abd3/src/TEdit.Terraria/Data/versions.json#L1-L90): released game/save-number relationships, summarized as ranges here.
- T11/T12: [`World.FileV2.cs:1996–2509`](https://github.com/TEdit/Terraria-Map-Editor/blob/182031b83ce825719f857a6db4ecb6967118abd3/src/TEdit.Terraria/World.FileV2.cs#L1996-L2509): physical metadata order and field gates.
- T29/T32: [`World.FileV2.cs:1770–1915`](https://github.com/TEdit/Terraria-Map-Editor/blob/182031b83ce825719f857a6db4ecb6967118abd3/src/TEdit.Terraria/World.FileV2.cs#L1770-L1915): chest and NPC layout changes.
- T34: [`TileEntity.cs:502–580`](https://github.com/TEdit/Terraria-Map-Editor/blob/182031b83ce825719f857a6db4ecb6967118abd3/src/TEdit.Terraria/TileEntity.cs#L502-L580): display-doll layout gates.
- Our format-326 evidence: `packages/test-fixtures/worlds/manifest.json`, generated by Terraria 1.4.5.8.

The existing source registry has additional header/tile references and access dates. Structural facts
about older versions are source-derived and synthetic-tested, not claimed to have come from a 326 file.
