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
