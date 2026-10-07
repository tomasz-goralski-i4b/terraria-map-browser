# `.wld` format — Primitive types and world metadata (section 1)

Part of the format specification; index and conventions: [../file-format.md](../file-format.md).

## Primitive types

Used by the metadata and tile sections. All integers little-endian (as in the header).

| Name | Size | Meaning |
|---|---|---|
| UInt8 / Int16 / UInt16 / Int32 / UInt32 / Int64 / UInt64 | 1/2/2/4/4/8/8 | two's complement for signed types |
| Single / Double | 4 / 8 | IEEE-754 binary32 / binary64 |
| Bool | 1 | `00` = false, `01` = true. .NET treats any non-zero byte as true (N); **M1 rejects other values** (`MalformedMetadata`) so that a read→write round trip cannot change a byte. All four fixtures use only 0/1 (F). |
| String | 1–5 + n | length `n` as an unsigned LEB128 ("7-bit encoded") integer, then `n` bytes of UTF-8, no terminator (N). |

String rules:
- Length prefix: 7 bits per byte, least-significant group first, high bit = "another byte follows". At most
  5 bytes, the 5th using only its low 4 bits (32 bits in total), and the value must be `≤ 2³¹−1` — .NET rejects
  a longer prefix and a negative length (N). A violation, or `n` not fitting
  before the end of the section → `MalformedMetadata`.
- Metadata name and seed are capped at 4096 UTF-8 bytes each; all other metadata strings are capped at
  1048576 UTF-8 bytes each. Exact caps are accepted. Prefix validity, section remaining bytes and the cap
  are checked before reading any payload bytes or allocating its buffer, including through read-ahead.
  Rejections report `MalformedMetadata` at the prefix offset with the string field name.
- Bytes must be valid UTF-8 → otherwise `MalformedMetadata`. (.NET would silently replace invalid sequences with
  U+FFFD, which breaks round trip — our decision.)
- Example from F: the world manifest string in `SCCO1` has prefix `93 4a` = `0x13 + (0x4a << 7)` = 9491 bytes.

## World metadata (section 1)

Starts at `pointer[0]` (end of the file header) and must end **exactly** at `pointer[1]`. Read strictly in
the order below (T11). The type and the version gate decide whether a field is present; there are no
per-field lengths, so every field — including the ones M1 does not expose — must be decoded to reach the
end. "Expose" = the value is part of the M1 model/`inspect` output; "consume" = it is parsed (and kept for
round trip in M2) but not interpreted.

The "@SCCO1" column is the absolute offset in fixture `SCCO1.wld` (5-byte name, 9-byte seed), so offsets after
the name shift with string lengths. Rows marked *list* repeat their element type `count` times.

| # | Field | Type | Present for version (T11) | @SCCO1 | M1 |
|---|---|---|---|---|---|
| 1 | world name | String | always | 167 | **expose** `name` |
| 2 | seed | Int32 if version = 179, String if ≥ 180 | ≥ 179 | 173 | **expose** `seed` (text) |
| 3 | world-gen version | UInt64 | ≥ 179 | 183 | consume (F: `0x00000146_00000001`) |
| 4 | world GUID | 16 bytes | ≥ 181 | 191 | **expose** `guid` as 32 hex digits **in file byte order** (see note) |
| 5 | world id | Int32 | always | 207 | **expose** `worldId` |
| 6–9 | left, right, top, bottom bounds | Int32 ×4 (pixels) | always | 211 | consume (F: 0, 16·width, 0, 16·height) |
| 10 | **height** (tiles) | Int32 | always | 227 | **expose** `height` |
| 11 | **width** (tiles) | Int32 | always | 231 | **expose** `width` |
| 12 | game mode | Int32 if ≥ 209; Bool (true = 2) if = 208; Bool (true = 1) if 112–207 | ≥ 112 | 235 | **expose** `mode` |
| 13 | special-seed flags: drunk ≥ 222, good ≥ 227, tenth-anniversary ≥ 238, dont-starve ≥ 239, not-the-bees ≥ 241, remix ≥ 249, no-traps ≥ 266, zenith ≥ 267, skyblock ≥ 302 | Bool each, in this order | per flag; all only if ≥ 209 | 239–247 | consume |
| 14 | creation time | Int64 (.NET `DateTime` binary form) | ≥ 141 | 248 | consume |
| 15 | last played | Int64 (same form) | ≥ 284 | 256 | consume |
| 16 | moon type | UInt8 | always | 264 | consume |
| 17 | tree x-boundaries ×3, tree styles ×4, cave-back x ×3, cave-back styles ×4, ice / jungle / hell back styles | Int32 ×17 | always | 265 | consume |
| 18 | spawn x, spawn y | Int32 ×2 | always | | consume |
| 19 | surface level, rock level, time | Double ×3 | always | | consume |
| 20 | day time | Bool; moon phase Int32; blood moon Bool; eclipse Bool | always | | consume |
| 21 | dungeon x, dungeon y | Int32 ×2 | always | | consume |
| 22 | **crimson** | Bool | always | 380 | **expose** `evil` (false = corruption, true = crimson) |
| 23 | 10 boss-defeated flags (Eye … Golem) | Bool ×10 | always | | consume |
| 24 | King Slime defeated | Bool | ≥ 118 | | consume |
| 25 | 3 NPC-saved + 4 invasion-defeated flags | Bool ×7 | always | | consume |
| 26 | orb smashed Bool, spawn meteor Bool, orb count UInt8, altar count Int32, hardmode Bool | — | always | | consume |
| 27 | party-of-doom | Bool | ≥ 257 | | consume |
| 28 | invasion delay, size, type | Int32 ×3; invasion x Double | always | | consume |
| 29 | slime-rain time | Double | ≥ 118 | | consume |
| 30 | sundial cooldown | UInt8 | ≥ 113 | | consume |
| 31 | raining Bool, rain time Int32, max rain Single, 3 hardmode ore tiers Int32 ×3, 8 background styles UInt8 ×8, cloud-bg Int32, cloud count Int16, wind Single | — | always | | consume |
| 32 | angler finishers: count Int32 + *list* String | — | ≥ 95 (below 95 the section ends here) | 476 | consume |
| 33 | angler saved Bool (≥ 99), angler quest Int32 (≥ 101), stylist saved Bool (≥ 104), tax collector saved Bool (≥ 140), golfer saved Bool (≥ 201), invasion start size Int32 (≥ 107), cultist delay Int32 (≥ 108) | — | as given; the section ends early below 99 / 101 / 104 | | consume |
| 34 | kill counts: count Int16 + *list* Int32 | — | ≥ 109 (T12; ends early below 109) | 496 | consume |
| 35 | claimable banners: count Int16 + *list* UInt16 | — | ≥ 289 (T12) | 1670 | consume |
| 36 | fast-forward time | Bool | ≥ 140 (ends early below 128) | | consume |
| 37 | Duke Fishron defeated Bool (≥ 131, ends early below 131); Martians, Cultist, Moon Lord Bool ×3 (≥ 140); 5 seasonal boss flags Bool ×5 (≥ 131) | — | as given | | consume |
| 38 | 4 pillars defeated, 4 pillars active, apocalypse | Bool ×9 | ≥ 140 (ends early below 140) | | consume |
| 39 | party: manual Bool, genuine Bool, cooldown Int32, partying NPCs count Int32 + *list* Int32 | — | ≥ 170 | 2283 (count) | consume |
| 40 | sandstorm: active Bool, time Int32, severity Single, intended severity Single | — | ≥ 174 | | consume |
| 41 | bartender saved + 3 Old One's Army tiers | Bool ×4 | ≥ 178 | | consume |
| 42 | mushroom bg UInt8 (≥ 195), underworld bg UInt8 (≥ 215), 3 more tree bgs UInt8 ×3 (≥ 195) | — | as given | | consume |
| 43 | combat book used | Bool | ≥ 204 | | consume |
| 44 | lantern night: cooldown Int32, genuine, manual, next-is-genuine Bool ×3 | — | ≥ 207 | | consume |
| 45 | tree-top variations: count Int32 + *list* Int32 | — | ≥ 211 | 2317 (F: 13) | consume |
| 46 | force Halloween / Christmas today | Bool ×2 | ≥ 212 | | consume |
| 47 | pre-hardmode ore tiers (copper, iron, silver, gold) | Int32 ×4 | ≥ 216 | | consume |
| 48 | bought cat, dog, bunny | Bool ×3 | ≥ 217 | | consume |
| 49 | Empress of Light, Queen Slime defeated (≥ 223); Deerclops (≥ 240); town-slime / NPC unlocks: 1 Bool (≥ 250), 8 Bool (≥ 251) | — | as given | | consume |
| 50 | combat book II (≥ 259), peddler's satchel (≥ 260), 7 slime unlocks (≥ 261) | Bool | as given | | consume |
| 51 | fast-forward to dusk Bool + moondial cooldown UInt8 | — | ≥ 264 | | consume |
| 52 | force Halloween / Christmas forever | Bool ×2 | ≥ 287 | | consume |
| 53 | vampire seed Bool (≥ 288), infected seed Bool (≥ 296) | — | as given | | consume |
| 54 | meteor-shower count, coin rain | Int32 ×2 | ≥ 291 (note: physically **after** row 53 although its gate is lower) | | consume |
| 55 | team-spawns seed Bool, then count UInt8 + *list* (x Int16, y Int16) | — | ≥ 297 (T12) | 2430 (count) | consume |
| 56 | dual-dungeons seed | Bool | ≥ 304 | | consume |
| 57 | more-lightning, no-lightning seeds | Bool ×2 | ≥ 323 | | consume |
| 58 | deprecated value | UInt32 | 299 ≤ version < 313 only | — | skip |
| 59 | world-gen manifest (JSON text) | String | ≥ 299 | 2434 | consume (F: ~9.5 KB of generation-pass JSON) |
| — | end of section | | | 11927 = `pointer[1]` | |

Notes and rules:
- **Height comes before width.** Easy to swap; vector M1 below pins it.
- GUID: .NET's `Guid(byte[])` text form reorders the first 8 bytes (little-endian groups). To keep .NET and TS
  identical we expose the 16 bytes as hex in file order (F `SCCO1`: `87e466e7853c3f48b75abc85e36d4b86`).
- Game mode values (for version ≥ 209): 0 classic, 1 expert, 2 master, 3 journey — all four confirmed by F
  (`SCCO1` 0, `SECR1` 1, `SMCO1` 2, `SJCO1` 3). Any other value is kept as `{ mode: "unknown", raw }`, not an
  error (preserve unknown data).
- Evil: the Bool at row 22 is the only evil flag in the metadata. In F it agrees with the tiles of every
  fixture (crimson-only tiles in `SECR1` and `SCCR2`, corruption-only in the other three) and, since the fix for open
  question 5, with the manifest; `scripts/check-fixtures.mjs` enforces it.
- Counts (rows 32, 34, 35, 39, 45, 55) must be ≥ 0 (signed types) and the list must fit before `pointer[1]`;
  otherwise `MalformedMetadata`. No other upper bound is defined by any source; this "fits in the section"
  rule is the only bound needed.
- End: after row 59 the reader must be exactly at `pointer[1]`. Before → `MalformedMetadata { reason
  "unread bytes" }`; after → `MalformedMetadata { reason "overruns section" }`. TEdit instead keeps leftover
  bytes as opaque "unknown data" (T11, end) and fails only on overrun (T13). M1 is strict because only 326 is
  accepted and all four fixtures end exactly (F, leftover 0); for saving, the M2 writer copies
  the metadata as one verbatim span (W-M1 in [writer.md](writer.md)); trailing bytes for a newer format are open
  question 6.
- **Dimensions** (our own rules; no source defines a minimum or maximum):
  - `width ≤ 0` or `height ≤ 0` → `MalformedMetadata { field "width"/"height", reason "must be positive" }`.
  - Every column needs at least one record byte, so `width ≤ pointer[2] − pointer[1]` (derived bound).
  - Implementation safety limit (annotated, not from a source): `width ≤ 65 536`, `height ≤ 65 536` and
    `width · height ≤ 2²⁸`, so a hostile file cannot make the reader allocate gigabytes. TEdit has no limit
    (T11). Vanilla's largest preset is commonly given as 8400 × 2400 — not checked against a pinned source,
    but either way far below the limit; F worlds are 4200 × 1200.
  - The pixel bounds (rows 6–9) are intentionally not cross-checked against dimensions (decision #116).
    The TypeScript reader exposes the stored values unchanged as `WorldMetadata.bounds`.

Version gates are listed for completeness; M1 accepts only format 326, for which **every** row except 58 is
present. A reader for 326 may therefore be a straight sequence; the gates matter only when the version range
is widened.

The TypeScript `readWorldMetadata(bytes)` entry point validates the header and section table first, then
walks this bounded section without allocating tile planes. It returns `metadata` (the exposed fields),
`header`, and `sections`, including all eleven raw pointers and section boundaries. Offsets are relative
to the supplied `Uint8Array` view. Unexposed numeric fields, including the 64-bit values, are consumed as
raw bytes; strings and booleans are validated even when their values are not exposed. No write envelope
is retained by this read API.

TypeScript `WorldMetadata.bounds` exposes the four signed Int32 pixel bounds from rows 6–9 as
`{ left, right, top, bottom }`. The values are decoded from the file, not derived from tile dimensions,
and are not cross-checked against them. Each truncated bound fails at that field's start. Shared M3
contract tests compare these codec values to the committed vector expectations.

TypeScript `WorldFormatError.field` is optional: named string, list-count and dimension rejections
set it to the metadata field name. Rejections without a named field leave it undefined. Existing
`reason` prefixes and error messages are preserved; callers can inspect `field` without parsing them.
