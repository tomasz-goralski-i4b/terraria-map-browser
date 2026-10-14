# `.wld` format — Entity sections (sections 3–10)

Part of the format specification; index and conventions: [../file-format.md](../file-format.md).
Primitive types (Bool, String, little-endian integers) are defined in [metadata.md](metadata.md), "Primitive
types". Source ids (T…, F, N) are in [sources-and-versions.md](sources-and-versions.md).

M1 does not parse these sections ([tiles.md](tiles.md), "Sections skipped in M1"). This part specifies them for a
**read-only** decoder that lists them in the editor's Entities panel. Editing them is out of scope.

## Overview

The eight sections follow the tile section in a fixed order. Each one starts at the previous section's pointer
and must end **exactly** at its own pointer (TEdit checks this after every one of them, T28). None of them has
a length prefix or per-record lengths: a section can only be skipped as a whole, by its pointers, and a record
whose layout is unknown makes the rest of its section unreadable.

| Section | Pointer | Content | Present since (T28) | Count field | Min. bytes (empty) |
|---|---|---|---|---|---|
| 3 | `pointer[3]` | chests | always | Int16 | 2 |
| 4 | `pointer[4]` | signs | always | Int16 | 2 |
| 5 | `pointer[5]` | town NPCs, then mobs | always | Bool-terminated lists | 6 (326) |
| 6 | `pointer[6]` | tile entities | 116 (122 for the current layout) | Int32 | 4 |
| 7 | `pointer[7]` | weighted pressure plates | 170 | Int32 | 4 |
| 8 | `pointer[8]` | town manager (room assignments) | 189 | Int32 | 4 |
| 9 | `pointer[9]` | bestiary | 210 | 3 × Int32 | 12 |
| 10 | `pointer[10]` | creative (Journey) powers | 220 | Bool-terminated list | 1 |

Every gate in this part is below 326, so for format 326 **every field described below is present**. The
decoders also read the older formats whose tiles they read (269–279, 315–319, 325); the four gates inside that
range — 294, 307, 308 and 315 — are listed in [compatibility.md](compatibility.md) ("Other sections and older
families") and covered by vectors E34–E44. Before 294 the chest count is followed by one Int16 slot count for
all chests, so the minimum chest record is `9 + 2 × slots` bytes. An empty list still carries the slot count
(`00 00 28 00` = no chests, 40 slots); a negative slot count is an error, and `count × (9 + 2 × slots)` must fit
before the end pointer (error at the chest count). Format 311 (display-doll item slot 8 after
the misc slot) is not a readable format and is rejected.

## Corpus evidence

All five fixtures (F) were walked with a throwaway reader following this part (not committed). In every
fixture every section ended exactly at its pointer, and the footer followed at `pointer[10]` and ended at the
end of the file.

| Fixture | `pointer[2]` (chests start) | 3 chests | 4 signs | 5 NPCs | 6 TEs | 7 plates | 8 rooms | 9 bestiary | 10 powers |
|---|---|---|---|---|---|---|---|---|---|
| SCCO1 | 2970538 | 190 / 23732 B | 0 / 2 B | 2+0 / 71 B | 0 / 4 B | 0 / 4 B | 0 / 4 B | 0,0,0 / 12 B | 6 / 31 B |
| SCCR2 | 2906205 | 168 / 20771 B | 0 / 2 B | 2+0 / 68 B | 0 / 4 B | 0 / 4 B | 0 / 4 B | 0,0,0 / 12 B | 6 / 31 B |
| SECR1 | 2994780 | 176 / 21880 B | 0 / 2 B | 2+0 / 69 B | 0 / 4 B | 0 / 4 B | 0 / 4 B | 0,0,0 / 12 B | 6 / 31 B |
| SJCO1 | 2804301 | 169 / 21024 B | 0 / 2 B | 2+0 / 69 B | 0 / 4 B | 0 / 4 B | 0 / 4 B | 0,0,0 / 12 B | 6 / 31 B |
| SMCO1 | 2941576 | 172 / 21438 B | 0 / 2 B | 2+0 / 69 B | 0 / 4 B | 0 / 4 B | 0 / 4 B | 0,0,0 / 12 B | 6 / 31 B |

Cells are "entries / section bytes"; NPCs are "town NPCs + mobs". Section starts for SCCO1 (each is the
previous pointer): chests 2970538, signs 2994270, NPCs 2994272, tile entities 2994343, plates 2994347, rooms
2994351, bestiary 2994355, powers 2994367, footer 2994398 (file length 2994409).

**Coverage limit.** The corpus consists of freshly generated worlds (SMCO1 was opened once). Chests, the two
town-NPC records and the creative-power list are real data in all five worlds. **Signs, mobs, tile entities,
pressure plates, room assignments, shimmered NPCs and bestiary entries are empty in every fixture**: for those,
only the count/terminator fields are checked against F, and the record layouts rest on TEdit alone (its reader
and writer agree, T29–T40). A generated test world with every entity, opened and re-saved in game, is proposed
in [../planning/file-format-follow-ups.md](../planning/file-format-follow-ups.md) (open question 15).

Hex of SCCO1 from the signs to the footer (offset 2994270 = `0x2DB05E`), split by field:

```
signs   00 00                                   count 0
NPCs    00 00 00 00                             shimmered count 0
        01 25 00 00 00 00                       more; id 37; display name ""
        00 8f 62 47  00 c0 92 45                position 57999.0, 4696.0 (pixels)
        00 29 0e 00 00 28 01 00 00              homeless false; home 3625, 296
        01 00 00 00 00 00                       bits 0x01; variation 0; homeless-despawn false
        01 16 00 00 00 07 4d 61 78 77 65 6c 6c  more; id 22; display name "Maxwell"
        00 7f 03 47  00 40 8a 45                position 33663.0, 4424.0
        01 38 08 00 00 17 01 00 00              homeless true; home 2104, 279
        01 00 00 00 00 00                       bits 0x01; variation 0; homeless-despawn false
        00                                      end of town NPCs
        00                                      end of mobs
TEs     00 00 00 00                             count 0
plates  00 00 00 00                             count 0
rooms   00 00 00 00                             count 0
bestiary 00 00 00 00  00 00 00 00  00 00 00 00  kills 0, seen 0, chatted 0
powers  01 00 00 00                             power 0, Bool false
        01 08 00 00 00 00 00                    power 8, Single 0.0
        01 09 00 00   01 0a 00 00               power 9 false; power 10 false
        01 0c 00 00 00 00 00                    power 12, Single 0.0
        01 0d 00 00                             power 13 false
        00                                      end of powers
footer  01 05 53 43 43 52 31 47 99 ea 67        true; "SCCR1"; world id 1743427911
```

## Decoding rules (all sections)

These apply to every section in this part and mirror the metadata rules, so that a read never depends on
.NET's lenient behaviour:
- A Bool byte other than `00`/`01` is an error.
- Strings are the length-prefixed UTF-8 strings of "Primitive types"; invalid UTF-8 or a length that does not
  fit before the section's end pointer is an error. Decided (#165): a cap of 1048576 UTF-8 bytes per string (as
  for metadata strings other than name and seed), checked before allocating; both codecs enforce it, but no
  shared vector covers it because it needs a section larger than 1 MiB.
- A count is checked before allocating: negative is an error, and `count × minimum record size` must fit in
  the bytes left before the section's end pointer (minimum record sizes are given per section).
- Reading past the section's end pointer, or stopping before it, is an error for that section.
- A failure is reported as `MalformedSection { section, field, offset, reason }` (decided in #165; both codecs
  and the shared vectors in `contracts/vectors/entities.vectors.json` use this name). Because the
  sections are independent and addressed by pointers, a failure in one section **does not** affect the tiles,
  the metadata or the other sections; the Entities panel shows that section as unreadable.

## Section 3 — Chests

| Field | Type | Gate | Notes |
|---|---|---|---|
| count | Int16 | always | number of chest records |
| slots per chest (legacy) | Int16 | < 294 only | one value for all chests; absent in 326 |
| *per chest:* x, y | Int32, Int32 | always | tile coordinates of the chest's **top-left** tile |
| name | String | always | empty for unnamed chests |
| slot count | Int32 | ≥ 294 | per chest; 40 in all 875 chests of F |
| *per slot:* stack | Int16 | always | 0 = empty slot, nothing follows |
| item id | Int32 | stack > 0 | item type id |
| prefix | UInt8 | stack > 0 | item modifier id, 0 = none |

Sources: reader T29, writer T30. Minimum chest record: 13 bytes + 2 per slot; a filled slot adds 5 bytes.
Check on SCCO1: `2 + 190 × (13 + 40 × 2) + 1212 × 5 = 23732` = the section size.

Corpus facts (F, 875 chests): every chest stands on a chest tile — ids 21 (chest), 467 (chest, second sheet)
and 88 (dresser) — and its tile has frame `(36·k, 0)` for 21/467 and `(54·k, 0)` for 88, i.e. the stored
position is the object's top-left tile. No chest is named. Up to 8 chests per world are empty (no filled slot).
Item ids range up to 6165 (TEdit's highest item id for 326 is 6195, T18), stacks up to 290, no negative stack.

Limits and relations:
- Before format 216 TEdit's writer caps the count at 1000 (T30). The format itself only limits it to Int16.
- Chest tiles per TEdit: 21, 88, 441, 467, 468 (T36). TEdit keeps a chest whose tile is not a chest (its filter
  is commented out, T28); the decoder keeps it too (see "Proposed read-only model").
- A negative stack is not produced by the game in F; TEdit treats it as an empty slot. Decided (#165): error at the stack field (vector E29).

## Section 4 — Signs

| Field | Type | Gate | Notes |
|---|---|---|---|
| count | Int16 | always | |
| *per sign:* text | String | always | may contain line breaks |
| x, y | Int32, Int32 | always | tile coordinates (expected: the sign's top-left tile — not observed in F) |

Sources: reader T31, writer T31. Note the field order: the text comes **before** the position (the reverse of
chests). Minimum record: 9 bytes. F: count 0 in every fixture (`00 00`).

Relations: sign tiles per TEdit are 55 (sign), 85 (grave marker), 425 (announcement box), 573 (tattered sign)
(T36). TEdit **drops** a sign whose position is not an active sign tile on load (T28), so a TEdit round trip can
lose signs; the decoder keeps every record. Before 216 TEdit's writer caps the count at 1000 (T31).

## Section 5 — NPCs and mobs

| Field | Type | Gate | Notes |
|---|---|---|---|
| shimmered count | Int32 | ≥ 268 | |
| shimmered NPC ids | Int32 × count | ≥ 268 | town NPC types that were shimmered |
| *town NPC list:* more | Bool | always | `true` = a record follows, `false` ends the list |
| NPC id | Int32 | ≥ 190 | NPC type id (a String name before 190) |
| display name | String | always | the NPC's given name; empty for the Old Man in F |
| position x, y | Single, Single | always | world **pixels** (16 per tile), not tiles |
| homeless | Bool | always | |
| home x, y | Int32, Int32 | always | tile coordinates of the home; present even when homeless |
| extra bits | UInt8 | ≥ 213 | bit 0 = a variation index follows; other bits have no known meaning |
| variation index | Int32 | ≥ 213 and bit 0 | town NPC variant (e.g. shimmered look) |
| homeless despawn | Bool | ≥ 315 | |
| *mob list:* more | Bool | ≥ 140 | `false` ends the list |
| NPC id | Int32 | ≥ 190 | |
| position x, y | Single, Single | ≥ 140 | world pixels |

Sources: reader T32, writer T32. Minimum town NPC record (326): 25 bytes including its `more` byte; minimum
mob record: 13 bytes.

Corpus facts (F): every world has exactly two town NPCs — id 37 (Old Man, empty display name, not homeless,
home by the dungeon) and id 22 (the Guide, named, homeless, home near the spawn point) — no shimmered NPCs and
an empty mob list. The extra-bits byte is always `01` followed by variation index 0; homeless despawn is always
false. In the four never-opened worlds, position ÷ 16 lies within three tiles of the home; in SMCO1 (opened and
saved once) the Guide stands about ten tiles from it, and positions are no longer whole pixels (57120.965).

Relations: the home is a tile coordinate; the position is free-floating and only approximately on a tile.
TEdit's writer always sets bit 0 and writes the variation index (T32). An extra-bits byte with a bit other than
bit 0 set is not covered by any source; decided (#165): error at the extra-bits field (vector E24, open
question 16).

## Section 6 — Tile entities

| Field | Type | Gate | Notes |
|---|---|---|---|
| count | Int32 | ≥ 116 | before 122 the records are 4-byte legacy "dummy" entries (two Int16), skipped by TEdit |
| *per entity:* kind | UInt8 | ≥ 122 | see the table below |
| entity id | Int32 | ≥ 122 | the game's identifier for the entity |
| x, y | Int16, Int16 | ≥ 122 | tile coordinates (note: Int16, unlike chests and signs) |
| payload | per kind | ≥ 122 | no length prefix — an unknown kind cannot be skipped |

An **item stack** below is `item id Int16, prefix UInt8, stack Int16` (5 bytes) — a narrower layout than chest
slots.

| Kind | Name (T35) | Tile ids (T36) | Payload (326) |
|---|---|---|---|
| 0 | training dummy | 378 | NPC slot Int16 |
| 1 | item frame | 395 | item stack |
| 2 | logic sensor | 423 | check kind UInt8, on Bool |
| 3 | display doll (mannequin) | 128, 269, 470 | see below |
| 4 | weapon rack | 334, 471 | item stack |
| 5 | hat rack | 475 | presence UInt8 (bits 0–1 items, bits 2–3 dyes), then the present stacks in that order |
| 6 | food platter | 520 | item stack |
| 7 | teleportation pylon | 597 | none |
| 8 | Dead Cells display jar | 698 | item stack |
| 9 | kite anchor | 723 | item id Int16 |
| 10 | critter anchor | 724 | item id Int16 |

**Display doll** (kind 3), format 326: item-presence UInt8 (bits 0–7 = item slots 0–7), dye-presence UInt8
(bits 0–7 = dye slots 0–7), pose UInt8 (≥ 307), extra-presence UInt8 (≥ 308: bit 0 = misc slot 0, bit 1 =
item slot 8, bit 2 = dye slot 8). Then the present stacks in this order: item slots 0–8, dye slots 0–8, misc
slot 0. Format 311 alone stored item slot 8 after the misc slot (TEdit special-cases it, T34); irrelevant to
326.

Sources: section reader T33, entity reader T34, kinds T35, tile mapping T36. Minimum entity record: 9 bytes.
F: count 0 in every fixture.

Relations: the position is the entity's anchor tile on a tile of the listed ids; whether it is the top-left
tile is not observed in F. TEdit's writer gates the section at ≥ 140 while its reader gates it at ≥ 116
(T20 vs T28) — irrelevant to 326.

## Section 7 — Weighted pressure plates

| Field | Type | Gate | Notes |
|---|---|---|---|
| count | Int32 | ≥ 170 | |
| *per plate:* x, y | Int32, Int32 | ≥ 170 | tile coordinates |

Sources: reader/writer T37. Record: 8 bytes. F: count 0 in every fixture. The tile id of a weighted pressure
plate is not named by TEdit; not established (open question 15).

## Section 8 — Town manager (room assignments)

| Field | Type | Gate | Notes |
|---|---|---|---|
| count | Int32 | ≥ 189 | |
| *per room:* NPC id | Int32 | ≥ 189 | town NPC type assigned to the room |
| x, y | Int32, Int32 | ≥ 189 | tile coordinates of the room's home tile |

Sources: reader/writer T38 (TEdit calls the list "player rooms"). Record: 12 bytes. F: count 0 in every
fixture, although both town NPCs have homes in section 5 — so this list is not simply a copy of the NPC homes.
What adds an entry is not documented by any source (open question 15).

## Section 9 — Bestiary

| Field | Type | Gate | Notes |
|---|---|---|---|
| kill count entries | Int32 | ≥ 210 | |
| *per entry:* NPC key, kills | String, Int32 | ≥ 210 | |
| seen entries | Int32 | ≥ 210 | |
| *per entry:* NPC key | String | ≥ 210 | |
| chatted entries | Int32 | ≥ 210 | |
| *per entry:* NPC key | String | ≥ 210 | |

Sources: reader/writer T39. NPC kinds are identified by **string keys**, not numeric ids; TEdit compares them
case-insensitively. The key format is not observed in F (all three counts are 0).

## Section 10 — Creative (Journey) powers

A list of `more Bool; power id Int16; value` entries, ended by a `false` Bool. The value type depends on the id
(T40):

| Power id | Meaning (T40) | Value |
|---|---|---|
| 0 | time frozen | Bool |
| 5 | god mode (player power) | Bool |
| 8 | time speed | Single |
| 9 | rain frozen | Bool |
| 10 | wind frozen | Bool |
| 11 | increased placement range (player power) | Bool |
| 12 | difficulty slider | Single, 0…1 |
| 13 | infection spread frozen | Bool |
| 14 | enemy spawn rate slider | Single, 0…1 |

Corpus facts (F): **all five worlds, including the non-Journey ones**, store the same six entries — ids 0, 8, 9,
10, 12, 13 with values false, 0.0, false, false, 0.0, false (31 bytes). The section is not Journey-only.

An id outside the table has no known value size and cannot be skipped (TEdit reads no value for it and loses
its position, T40). Decided (#165): error for the section at the power-id field (vector E22, open question 17).

## Proposed read-only model

What a first decoder exposes; everything else is consumed (to reach the end pointer) and not interpreted.
Names are ids only — item, NPC and tile display names are out of scope.

| Section | Exposed per entry | Consumed, opaque |
|---|---|---|
| 3 chests | position, name, slot count, filled slots as (slot index, item id, stack, prefix) | — |
| 4 signs | position, text | — |
| 5 NPCs | town NPC: id, display name, position (pixels, as read), homeless, home; mob: id, position | shimmered ids, extra bits, variation index, homeless despawn |
| 6 tile entities | kind, entity id, position; item-like payloads as stacks (frame, rack, platter, jar, doll, hat rack); anchor item id | dummy NPC slot, logic sensor check/on, doll pose |
| 7 pressure plates | position | — |
| 8 town manager | NPC id, home position | — |
| 9 bestiary | the three counts | the keys and kill counts |
| 10 powers | the (id, value) list | — |

"Go to on map" uses the tile position (chests, signs, tile entities, plates, rooms, NPC home) or position ÷ 16
(NPCs, mobs). Whether an entry stands on a matching tile (e.g. a chest on 21/88/441/467/468) is **derived** in
the view from the tile planes, not decided by the decoder: the decoder never drops records (unlike TEdit for
signs), so a read-only list and a later round trip see the same data.

## Chest extraction, item display and export (#156)

The section-3 layout above is unchanged. #165 already implements independent .NET/TS decoding, including
legacy shared slot counts. #187 owns the Inspector inventory, Entities chest list and item search; #186 owns
the search panel and map highlights. This section supplies their item display, aggregation and export contract.
At the user's request on 2026-10-14, the spike also implements a complete generated item catalog and local
sprite extraction, rather than leaving name/icon extraction as a future feasibility exercise.

### Sources and reproducible evidence

| Source | Revision / location | Evidence used |
|---|---|---|
| Section-3 reader/writer | T29/T30 in [sources-and-versions.md](sources-and-versions.md), TEdit `182031b83ce825719f857a6db4ecb6967118abd3` | Binary record layout, restated above |
| [TEdit texture loader](https://github.com/TEdit/Terraria-Map-Editor/blob/99928583086ff1c0c970c5528c7d72c76da39a53/src/TEdit/Render/Textures.cs#L294-L300) | `99928583086ff1c0c970c5528c7d72c76da39a53`, `src/TEdit/Render/Textures.cs:294–300` | Item sheet lookup uses the local `Images/Item_<id>` family |
| [TEdit item property](https://github.com/TEdit/Terraria-Map-Editor/blob/99928583086ff1c0c970c5528c7d72c76da39a53/src/TEdit.Terraria/Objects/ItemProperty.cs#L56-L58) | same revision, `src/TEdit.Terraria/Objects/ItemProperty.cs:56–58` | Texture aliasing needs a distinct source texture ID; no values copied |
| Our existing assets | [../assets.md](../assets.md), "XNB container", "Atlas"; `packages/assets/src/atlas-types.ts`, `atlas-build.ts:65–72` | Independent XNB/LZX decode and atlas item-sheet entries |
| Our existing decoder | `packages/world-codec/src/entities.ts:5–6,122–133,263–277`; `tiles.ts:15–36` | Sparse slots, per-section errors, column-major tile planes plus palette |
| Local runtime observation | Terraria 1.4.5.8, Steam build `24893155`, observed 2026-10-14; `TerrariaServer.exe` SHA-256 `328872c65a4a7a94f050ead1566f1567af15c3193d4d7008a460507d3686d7c2` | Names, aliases and animation rectangles through reflection and calls, not decompilation |
| Generated corpus | `packages/test-fixtures/worlds/manifest.json`, SHA-256 checked before each read | Counts and samples in the table below |

Runtime members used by our observer: `LanguageManager.Instance`, `SetLanguage("en-US")`, `ReloadLanguage`,
`Lang.InitializeLegacyLocalization`, `Lang.GetItemNameValue`, `Lang.prefix`, `ItemID.Count`, symbolic `ItemID`
fields, `ItemID.Sets.TextureCopyLoad`, `Main.InitializeItemAnimations`, `Main.itemAnimations` and animation
`GetFrame(Texture2D, 0)`. The call observes a first-frame rectangle using decoded sheet dimensions; XNA's
reflected `_width` / `_height` fields populate a dimensions-only texture, with its native finalizer suppressed.
The Windows game needs the 32-bit .NET Framework host. `Program.SavePath` must be initialized before `Main`;
the observer uses the temporary directory and loads no player/world files, following the map-palette exporter.
Unsupported contracts fail the export. No third-party tables, game code or images are committed.

### Extraction model and gaps in #165

Keep `WorldTilesResult.entities.Chests` next to the CWM; the tile planes remain typed arrays. A chest is
`{ x, y, name, slotCount, items: [{ slot, itemId, stack, prefix }] }`. `items` contains occupied slots only;
indices are zero-based and a missing index in `[0, slotCount)` is empty. Keep the actual `slotCount`, never
assume 40. The Inspector can materialize its slot grid on demand; do not expand all worlds into objects per tile.

`chestIndex` is the zero-based **section record order**, useful as a world-session key and export key. It is
not a persistent game chest ID, and must be paired with the world/session revision. Keep duplicate coordinates
as separate records. Loading another world or editing chest contents invalidates the index and totals.

Derive `tileId`, kind and footprint from the CWM at `x * height + y`, resolving the block-plane palette index
(not treating that index as a tile ID). Supported vanilla anchors: 21/467 = chest (2 × 2), 88 = dresser
(3 × 2), 441/468 = trapped chest (2 × 2), from T36. This classification does not prove a valid complete object:
check bounds, footprint tiles and stored frames before indexing its clickable footprint. Preserve and list
records with out-of-bounds, absent, unknown or mismatched anchors; label them and do not index an invented
footprint. The binary decoder intentionally does not filter them. Unsupported anchors remain `kind: "unknown"`.

No binary field is missing for listing, totals or export. Derived kind/footprint, catalog lookup, item-to-chest
index and UI identity belong outside the codec. The decoder reads an Int32 item ID without checking that a
catalog knows it; retain that ID, even when zero/negative/unknown with a positive stack, and display a diagnostic
fallback. A malformed chest section is unreadable, not an empty inventory: disable complete chest exports and
totals for that section, while the other entity sections still work.

### Generated item names and local icons

The generated `terrariaItems` catalog in `@studio/assets` has one entry per ID, including ID 0. It includes
`id`, exact English `name`, `nameStatus` (`resolved`, `unnamed`, `empty`), reflected `symbols`, resolved
`textureId`, an observed first-frame `frame: { x, y, width, height }` or null, and `spriteStatus`
(`available`, `missing`, `empty`). Prefix names are indexed separately. Provenance is `schemaVersion: 1`,
game version, assembly SHA-256 and `itemCount`. See [ADR 0002's addendum](../adr/0002-shipped-map-palette.md).

Route every item display in #187 through one function taking `(itemId, prefix, connectedAtlas)`. It returns a
base name, prefix label, stable numeric IDs and an optional icon rectangle. Names work without connecting game
assets. For missing names/IDs use `Item <id>`; for unknown prefixes use `Prefix <id>`; prefix 0 adds no label.
For example, the runtime resolves item 1156 to Piranha Gun and prefix 55 to Unpleasant; keep those two labels
separate instead of inventing the game's grammar. Item 8 resolves to Torch, 19 to Gold Bar, 73 to Gold Coin,
and 6165 to Poison Barb. Display lookup never rewrites stored IDs or stacks.

Icons come from the user's local XNB files, decoded by `readXnbTexture`, or their cached item atlas entries.
Look up `kind: "item", id: textureId`; offset the observed frame into the atlas entry. An alias can share pixels
while keeping its own item ID/name. Select a static inventory frame for animation strips, not the full strip;
no frame-height/gutter rule is guessed from sheet aspect ratio. Use a neutral placeholder if assets are absent,
the entry is missing, the crop does not fit, or the connected install cannot be matched to the catalog version.
Keep names usable when icons are unavailable. No PNGs or localization JSON resources are shipped.

Regeneration and extraction are implemented by `scripts/items/export.mjs` and `observe.ps1`; the commands and
complete-ID coverage report are in [../../scripts/items/README.md](../../scripts/items/README.md). The generator
decodes every local item sheet, observes every ID, validates all available crops, and optionally emits one PNG
per available ID (including aliases) plus a manifest entry for **every** ID. An unnamed ID is retained,
not silently removed or assigned an invented game name. Re-run after game updates; never edit the table by hand.

The only unnamed nonempty ID observed is 4143, symbol `ManaCloakStar`, with an available 18 × 18 sprite.
The [official wiki](https://terraria.wiki.gg/wiki/Mana_Cloak_Star) identifies it as Mana Cloak Star, a pickup
restoring 50 mana (checked 2026-10-14). This explains its identity; it does not establish why the runtime returns
an empty name. Preserve the observed empty name instead of copying the wiki's display label into generated data.

### Listing, search and totals

The #187 Entities table shows name (empty = Unnamed), coordinates, kind, filled slots and `totalStack`, the sum
of all occupied stacks. Selecting a row centres on the bounded footprint; Enter pins the chest. The Inspector
shows `slotCount` cells, including empty slots. Find items delegates area highlights and stepping to #186.

Index occupied slots once per world in the Worker or idle slices. Keys are numeric item IDs, not names or
prefixes. For each ID retain per-chest slot references and summed stack; one chest with several matching slots
appears once. Names can match multiple IDs; an exact numeric query selects an ID, while a case-insensitive name
query matches base item names. Prefixes do not affect matching or the primary item total. Do not sum across
different IDs just because their localized names or icons are the same. A query result reports a total per
matched ID and a per-chest total for its matching slots; distinguish this from the chest's total inventory.

Per item: `totalStack = sum(stack)`, `slotCount = number of occupied matching slots`, and `chestCount = number
of distinct chestIndex values`. Primary totals combine prefixes; optional prefix breakdown groups by
`(itemId, prefix)` using the same rules. All sums use exact safe integers and are checked before export.
For the SCCO1 sample chest #2 below: seven filled slots, `totalStack = 71`; item 8 contributes 15. Across the
whole SCCO1 world, item 8 contributes 995 in 51 chests. Neither number is a count of distinct item types.

### Export contract proposal (not yet implemented)

JSON is the authoritative lossless report, proposed media type `application/json`, filename
`<world-name>.chests.v1.json`. The name is sanitized for a download, never used as an input path. Always export
the **whole decoded chest section**; a UI filter does not silently limit this report. No timestamps, absolute
local paths or pixels are included. The proposed schema is `contracts/schemas/chest-extract.v1.schema.json`;
this spike describes it without adding the schema or implementing chest export.

| JSON field | Contract |
|---|---|
| `schemaVersion` | exactly 1; incompatible changes need a new schema/filename version |
| `source` | original file `sha256`, `formatVersion`, world `worldId`, exact `name`, `width`, `height`; also `worldRevision` (nonnegative session edit counter) so an edited report is not mistaken for original bytes |
| `chests[]` | section order; each has `chestIndex`, exact `x`, `y`, `name`, `slotCount`, occupied `items[]`, derived `tileId` (integer or null), `kind` (`chest`, `dresser`, `trappedChest`, `unknown`), `anchorStatus` (`valid`, `outOfBounds`, `mismatch`, `unknown`) |
| `items[]` | ascending zero-based `slot`; exact Int32 `itemId`, positive Int16 `stack`, UInt8 `prefix`; no entries for empty slots |
| `totals[]` | ascending numeric `itemId`; `itemId`, `totalStack`, occupied `slotCount`, distinct `chestCount` |

The schema disallows extra fields, limits positions/IDs to Int32, prefixes to 0–255 and stack to 1–32767,
and requires nonnegative safe-integer counts. It permits nonstandard slot counts rather than enforcing 40.
Relational checks (unique chest indices, unique slots within range, ordering, totals and valid footprints)
also run in the exporter; JSON Schema alone cannot express all of them. Exact empty chest names and empty
chests survive, so slot gaps can be reconstructed from `slotCount`. Item names are presentation, not export
identity: v1 exports numeric IDs, so an installation/language change does not change inventory bytes.

Worked JSON chest entry (from SCCO1; tile-derived fields must be filled by the exporter from its CWM):

```json
{
  "chestIndex": 2, "x": 3708, "y": 651, "name": "", "slotCount": 40,
  "items": [
    { "slot": 0, "itemId": 1156, "stack": 1, "prefix": 55 },
    { "slot": 1, "itemId": 167, "stack": 1, "prefix": 0 },
    { "slot": 2, "itemId": 706, "stack": 5, "prefix": 0 },
    { "slot": 3, "itemId": 279, "stack": 45, "prefix": 0 },
    { "slot": 4, "itemId": 2350, "stack": 3, "prefix": 0 },
    { "slot": 5, "itemId": 8, "stack": 15, "prefix": 0 },
    { "slot": 6, "itemId": 5234, "stack": 1, "prefix": 0 }
  ]
}
```

This is the recorded binary payload excerpt, not a complete export document. Slots 7–39 are empty. Another
record, chest #0 at (2655,1072), is `{ "name": "", "slotCount": 40, "items": [] }`. The complete-world
totals entry for Torch is `{ "itemId": 8, "totalStack": 995, "slotCount": 51, "chestCount": 51 }`.

Offer three CSV downloads alongside JSON: `chests.v1.csv` (one row per chest, including empty chests),
`items.v1.csv` (one row per occupied slot), `totals.v1.csv` (one row per item ID). Each has
`schema_version,world_sha256,world_revision` first; remaining columns are:

- Chests: `chest_index,x,y,name,tile_id,kind,anchor_status,slot_count,filled_slots,total_stack`.
- Items: `chest_index,slot,item_id,stack,prefix`.
- Totals: `item_id,total_stack,slot_count,chest_count`.

Rows follow JSON ordering. UTF-8 without BOM, comma separators, CRLF, header row, RFC 4180 quoting (double
quotes doubled). Names with commas/newlines retain quoted content. In text cells only, prefix a leading
apostrophe if the first non-whitespace character is `=`, `+`, `-` or `@`, or the value starts with a tab/CR/LF;
CSV is for spreadsheets, while JSON preserves the exact original text. Numeric cells stay numeric. For the
worked chest's Torch slot the Items columns after provenance are `2,5,8,15,0`; the whole-world Torch total is
`8,995,51,51`. Never represent an unreadable chest section as a successful empty CSV/JSON report.

### Checked corpus chest contents

Checked 2026-10-14 with an independent, throwaway section-3 walk: verify each manifest SHA-256; read the
header's pointers at offset 26; start at `pointer[2]`; decode count, records and slots as above; assert the final
offset equals `pointer[3]`. All files have format 326, all chest slot counts are 40, and all names are empty.
No new world or full tile-grid dump is committed. The existing codec can reproduce these counts after build:

```js
// Run as a Node ES module from the repository root after pnpm typecheck.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { readWorldEntities } from "./packages/world-codec/dist/index.js";
const directory = "packages/test-fixtures/worlds/";
const manifest = JSON.parse(readFileSync(directory + "manifest.json", "utf8"));
for (const world of manifest.worlds) {
  const bytes = readFileSync(directory + world.file);
  if (createHash("sha256").update(bytes).digest("hex") !== world.sha256) throw Error("Fixture hash mismatch");
  const section = readWorldEntities(bytes).Chests;
  if (section.error) throw Error(JSON.stringify(section.error));
  const chests = section.data.entries;
  console.log(world.file, chests.length, chests.reduce((n,c) => n+c.items.length,0),
    chests.filter((c) => c.items.length === 0).length,
    chests.reduce((n,c) => n+c.items.reduce((sum,i) => sum+i.stack,0),0));
}
```

| Fixture | Section [start,end) | Chests | Filled slots | Empty chests | Sum of stacks | Item 8 total / chests |
|---|---|---:|---:|---:|---:|---:|
| SCCO1 | [2970538,2994270) | 190 | 1212 | 8 | 15184 | 995 / 51 |
| SCCR2 | [2906205,2926976) | 168 | 1029 | 2 | 12642 | 963 / 49 |
| SECR1 | [2994780,3016660) | 176 | 1102 | 3 | 12930 | 586 / 32 |
| SJCO1 | [2804301,2825325) | 169 | 1061 | 3 | 12781 | 800 / 41 |
| SMCO1 | [2941576,2963014) | 172 | 1088 | 6 | 12867 | 716 / 37 |

Sample notation: `slot:itemId × stack / prefix`; every slot not shown is empty. Indices are section order,
offsets are the start of the chest record, before x/y.

| Fixture / chestIndex | Record offset | Position | Contents |
|---|---:|---|---|
| SCCO1 / 0 | 2970540 | (2655,1072) | empty, 40 slots |
| SCCO1 / 2 | 2970726 | (3708,651) | 0:1156 ×1 /55; 1:167 ×1 /0; 2:706 ×5 /0; 3:279 ×45 /0; 4:2350 ×3 /0; 5:8 ×15 /0; 6:5234 ×1 /0 |
| SCCR2 / 0 | 2906207 | (1379,1070) | empty, 40 slots |
| SCCR2 / 2 | 2906393 | (429,631) | 0:1156 ×1 /57; 1:19 ×10 /0; 2:188 ×3 /0; 3:299 ×2 /0; 4:73 ×1 /0 |
| SECR1 / 3 | 2995061 | (575,734) | 0:1156 ×1 /42; 1:51 ×44 /0; 2:706 ×8 /0; 3:41 ×28 /0 |
| SJCO1 / 2 | 2804489 | (637,541) | 0:1156 ×1 /58; 1:43 ×1 /0; 2:51 ×48 /0; 3:279 ×28 /0; 4:299 ×2 /0; 5:2350 ×2 /0; 6:282 ×17 /0 |
| SMCO1 / 5 | 2942103 | (3456,534) | 0:1260 ×1 /53; 1:302 ×2 /0; 2:2329 ×1 /0; 3:8 ×25 /0; 4:5234 ×1 /0 |

Coverage limits remain: freshly generated worlds do not cover custom names, arbitrary slot gaps, several
stacks of the same item with different prefixes, bad anchors, overlapping records or unknown IDs. Cover those
with realistic synthetic inventories in implementation issues, not by committing player worlds.

### Open questions and follow-ups

1. How should connected Content directories prove they match the generated catalog's game version? A folder
   fingerprint proves cache identity, not the game's version. Until established, do not assume a crop from one
   game release works on another; omit unsupported icons and keep names/IDs visible.
2. Should a later export include optional localized display names or per-prefix totals? V1 uses stable IDs
   and combined totals; those additions need a separately specified schema change.
3. What exact footprint-validation behavior should #187 use for overlapping/corrupt chest records? Preserve
   records and diagnostic status; do not let a later record silently overwrite another's click target.
4. The generator's dimensions-only XNA contract is specific to the observed Windows install. Other game
   runtimes must be observed separately; do not infer support from the same `.wld` format version.

Implementation drafts and links to existing #165/#186/#187 live in
[../planning/file-format-follow-ups.md](../planning/file-format-follow-ups.md#chest-extraction-follow-ups-156).
