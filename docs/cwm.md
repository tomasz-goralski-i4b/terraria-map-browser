# Canonical World Model v1 (CWM)

The storage contract shared by the .NET reference codec and the TypeScript codec
([ADR 0001](adr/0001-dotnet-ts-contract.md) §3). A world is a small header (dimensions, palette) plus one typed
array per tile field — a **plane**. The semantic `Tile` ([file-format/tiles.md](file-format/tiles.md), "Model mapping") is only a view.

## Layout

- Every plane has `width × height` elements, **column-major**: index = `x * height + y` (the order of the `.wld`
  tile section).
- Multi-byte elements are **little-endian**.
- Plane order (also the order of chunk digests): `block`, `wall`, `frameX`, `frameY`, `paint`, `wallPaint`,
  `liquid`, `liquidAmount`, `shape`, `flags`.

| Plane | Type | Value | When absent |
|---|---|---|---|
| `block` | Uint16 | palette index of the block | `0xFFFF` |
| `wall` | Uint16 | palette index of the wall | `0xFFFF` |
| `frameX` | Int16 | frame x | `-1` |
| `frameY` | Int16 | frame y | `-1` |
| `paint` | Uint8 | block paint byte, as read | `0` |
| `wallPaint` | Uint8 | wall paint byte, as read | `0` |
| `liquid` | Uint8 | bits 0–2: `0` none, `1` water, `2` lava, `3` honey, `4` shimmer; bits 3–7 are `0` | `0` |
| `liquidAmount` | Uint8 | liquid amount, as read | `0` |
| `shape` | Uint8 | `0` full, `1` half, `2` slope top-right, `3` slope top-left, `4` slope bottom-right, `5` slope bottom-left | `0` |
| `flags` | Uint16 | bit field below; unused bits are `0` | `0` |

`flags` bits: 0 red wire, 1 blue wire, 2 green wire, 3 yellow wire, 4 actuator, 5 inactive, 6 invisible block,
7 invisible wall, 8 full-bright block, 9 full-bright wall.

A paint byte of `0` and an absent paint byte are the same in CWM (the game uses `0` for "no paint").

## Palette

`ContentRef` values are stored once, in a palette shared by blocks and walls. Indices are assigned in order of
**first appearance in a column-major scan**; within one tile the block comes before the wall. Entries are
distinct by value: a block and a wall with the same `ContentRef` (e.g. vanilla id 1) share one entry — the plane
that refers to it says whether it is a block or a wall. Unknown ids appear as `{ kind: "unknown", runtimeId }`.

## TypeScript model API

`packages/world-model` exports `createWorld(width, height, { maxBytes? })`. Dimensions must be positive
safe integers; cell and plane byte totals must also be safe integers. The ten plane buffers require exactly
15 bytes per coordinate. An optional nonnegative safe-integer `maxBytes` limits their combined size,
excluding palette and object overhead; rejection reports the requested bytes and dimensions before any
plane is allocated.

The returned `CanonicalWorld` exposes dimensions, mutable `planes`, and a shared read-only `palette`.
Populate it with `setTile(x, y, tile)` in column-major order to obtain the contract's first-appearance palette
order; each assignment interns the block before the wall. References are deduplicated by value, including
all mod-reference fields. Palette indices `0` through `65534` are available; `65535` is reserved for absence.
Replacing a tile resets all its planes but retains previously interned palette entries.

`setTile` rejects noninteger or out-of-range values with `RangeError`: frames must fit Int16
(-32768 through 32767), paints and liquid amounts must fit a byte (0 through 255), and wires must be
0 through 15. Shape must be a defined `BlockShape`; liquid kind must be water, lava, honey or shimmer.
Validation and capacity checks for both distinct new references happen before changing any plane or
palette entry. A rejected assignment leaves both unchanged. A full palette still accepts existing
references or absent content; matching new block and wall references require only one free slot.

`tileAt(x, y)` creates a fresh semantic view from the current planes and reuses palette references by
identity. It omits sentinel frames, zero paints, full shape and false additive flags, while preserving a
present liquid kind with amount zero. Both methods reject noninteger or out-of-bounds coordinates. Tiles
are never retained as a grid of objects.

## Chunks and digests

The world is cut into **128 × 128 chunks**; chunk `(cx, cy)` covers `x ∈ [128·cx, 128·cx + w)`,
`y ∈ [128·cy, 128·cy + h)`. Chunks on the right and bottom edges are smaller (`w`, `h` < 128).

The digest of a plane in a chunk is the SHA-256 of that plane's bytes inside the chunk, column-major **within the
chunk** (all of the chunk's column `128·cx`, rows top to bottom, then the next column …), truncated to the first
16 lowercase hex characters (8 bytes). Chunks are listed by chunk x, then chunk y.

## World summary (`export-json`)

`Terraria.WorldInspector export-json <file.wld> [--region x,y,w,h]` writes one JSON document to stdout that
validates against [`contracts/schemas/world-summary.v1.schema.json`](../contracts/schemas/world-summary.v1.schema.json):

```json
{
  "schemaVersion": 1,
  "formatVersion": 326,
  "metadata": { "name": "…", "seed": "…", "guid": "…", "worldId": 1, "gameMode": 0, "evil": "corruption" },
  "dimensions": { "width": 4200, "height": 1200 },
  "skippedSections": [ { "name": "chests", "start": 0, "end": 0 } ],
  "palette": [ { "kind": "vanilla", "id": 1 } ],
  "chunks": {
    "size": 128,
    "planes": [ "block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags" ],
    "digests": [ { "x": 0, "y": 0, "width": 128, "height": 128, "block": "0123456789abcdef", "…": "…" } ]
  },
  "region": { "x": 0, "y": 0, "width": 2, "height": 2, "tiles": [ { "x": 0, "y": 0, "wires": 0, "actuator": false } ] }
}
```

- Properties appear in the order of the schema. `metadata.seed`, `metadata.guid` and `metadata.gameMode` are
  `null` when the format version does not have them. `skippedSections[].name` is the section name in camelCase;
  `start`/`end` come from the section table. `chunks.digests[].x`/`y` are chunk indices.
- Formatting: indented with two spaces (`"key": value`), LF line endings, UTF-8 without BOM, non-ASCII text written
  as UTF-8 (not `\u` escapes), exactly one trailing newline, invariant culture. No file paths, timestamps or other
  environment data — two exports of the same bytes are byte-identical.
- `region` is present only with `--region`: the region's semantic tiles, `x` then `y` (column-major), at most
  256 × 256. Tile keys, in this order: `x`, `y`, `block`, `frameX`, `frameY`, `paint`, `wall`, `wallPaint`,
  `wires`, `actuator`, `liquid`, `shape`, `inactive`, `invisibleBlock`, `invisibleWall`, `fullBrightBlock`,
  `fullBrightWall`. `x`, `y`, `wires` and `actuator` are always present; absent parts are omitted, and so are the
  additive fields at their default (`shape` full, booleans false).
- Exit codes: `0` success; `2` argument error (usage, malformed `--region`, a region that is empty, not fully
  inside the world or larger than 256 × 256); `1` I/O or format error. On failure stdout is empty and stderr
  explains the error. The `.wld` is only read.
