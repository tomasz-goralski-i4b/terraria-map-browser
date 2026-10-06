# ADR 0001 — How the .NET and TypeScript codecs meet

- **Status:** Accepted (2026-10-06)
- **Affects:** M1 #10 `export-json`, #11 `diff`, #12 golden snapshots; M2 (round trip); M3 (TS codec); M4–M5 (viewer, editor)

## Context

`docs/architecture.md` makes the .NET codec the **reference** and the TypeScript codec an **independent
implementation of the same contract** that runs in the browser. The editor must stay fast on large worlds:
a Large world is 8400 × 2400 ≈ 20 M tiles, a Small one ≈ 5 M.

Two things are easy to get wrong:

1. **Shipping the contract as JSON.** M1 #10 currently exports the whole tile grid as JSON and #12 commits it as
   a golden file per world. At tens of bytes per tile that is hundreds of MB per Small world (estimate), slow
   to produce, slow to diff, and unusable in git. JSON is fine for metadata and small synthetic grids only.
2. **One object per tile.** The world-model sketch in `docs/architecture.md` (`Tile` with `ContentRef` objects)
   is right as a *semantic* model, but as a runtime representation in the browser it means 5–20 M JS objects:
   hundreds of MB of heap, long GC pauses, and a structured-clone copy every time data crosses a worker
   boundary. The .NET reader uses records with run-length sharing — fine for a reference CLI, not for an editor.

## Decision

### 1. No runtime communication between C# and TypeScript

.NET never runs in the browser and the browser never calls .NET. The two codecs meet **only through contracts
checked in CI** (differential testing). All runtime performance work happens in TypeScript.

*Rejected:* .NET compiled to WebAssembly as the browser codec. It adds a multi-MB runtime download and startup
cost, every large array crossing the JS↔WASM boundary costs a copy or an unsafe shared view, and the project
loses its independent second implementation — the thing that catches spec mistakes.

### 2. Contracts (directory `contracts/`, consumed by both test suites)

| Contract | Form | Used for |
|---|---|---|
| `.wld` format | `docs/file-format.md` (exists) | both codecs' behaviour |
| **Test vectors** | `contracts/vectors/*.json`: input bytes (hex) + expected result or error `{ code, offset }` | the **same** vectors run in xUnit and Vitest; today's T1–T17, R1–R10, M1–M5 move here |
| **World summary** | `<world>.meta.json`: schema version, format version, metadata, dimensions, skipped sections, content palette — small, readable, diffable | golden files in git, `inspect`, `diff` |
| **Chunk digests** | `<world>.chunks.json`: SHA-256 (truncated to 16 hex chars) per plane per 128 × 128 chunk | golden files in git (a Small world = 33 × 10 chunks → a few KB); a mismatch names the chunk and plane |
| **Canonical World Model (CWM)** | binary, section 3 below (moves to `docs/cwm.md` in M2) | byte-for-byte .NET vs TS comparison in CI (generated, **never committed**); OPFS cache format in the browser |

JSON Schemas for `meta.json`, `chunks.json` and the vector files live in `contracts/schemas/`; both sides validate
their output against them in tests.

### 3. Canonical World Model (CWM v1) — struct of arrays

A world is a small JSON header plus one **typed array per tile field** ("plane"), little-endian, **column-major**
(index = `x * height + y`, the order of the `.wld` tile section, so both parsers write planes sequentially).

| Plane | Type | Meaning |
|---|---|---|
| `block` | Uint16 | palette index of the block; `0xFFFF` = none |
| `wall` | Uint16 | palette index of the wall; `0xFFFF` = none |
| `frameX`, `frameY` | Int16 | frame coordinates; `-1` = absent |
| `paint`, `wallPaint` | Uint8 | as read |
| `liquid` | Uint8 | kind in bits 0–2, 0 = none |
| `liquidAmount` | Uint8 | as read |
| `shape` | Uint8 | block shape |
| `flags` | Uint16 | bit field: wires ×4, actuator, inactive, invisible block/wall, full-bright block/wall |

`ContentRef` values live **once** in a palette (`vanilla id` / `mod internalName` / `unknown runtimeId`), not
per tile — this is how mod content and unknown IDs survive without per-tile objects. ≈ 14 bytes per tile:
≈ 70 MB for a Small world, ≈ 280 MB for a Large one, as flat buffers with zero GC objects. The semantic `Tile`
type stays as a *view* (`tileAt(x, y)`) for tests, the inspector and the UI — never as storage.

### 4. TypeScript runtime pipeline (M3–M5)

- Parse in a **Web Worker** directly from the file bytes (`DataView`/`Uint8Array`, no per-tile allocation) into
  preallocated planes — dimensions are known before the tile section.
- Hand the planes to the main thread as **transferables** (zero copy). If the editor needs workers and the UI to
  share planes, use `SharedArrayBuffer` — requires COOP/COEP headers on the hosting (Cloudflare Pages `_headers`).
- Render with **WebGL2**: upload chunk planes as integer textures (`R16UI`) and resolve sprites in the shader;
  no per-tile draw calls in JS.
- Edit by writing planes and tracking dirty chunks; undo stores chunk deltas. Save encodes planes → `.wld` in the worker.
- Cache CWM planes in **OPFS** so reopening a world skips parsing.

### 5. Performance is a tested contract

Budgets become acceptance criteria and are measured with benchmarks (`vitest bench`, BenchmarkDotNet):
parse time and peak memory for the Small fixtures, and a synthetic Large world generated in the test (no game
assets). CI records results and fails only on a large regression (e.g. > 30 %), not on absolute numbers,
because CI machines vary. Initial targets, to be confirmed by the first measurement: TS parse of a Small world
< 1 s and < 150 MB peak in a desktop browser; Large < 4 s.

## Consequences for the backlog

- **#10 export-json:** export the world summary (metadata, dimensions, skipped sections, palette) and chunk digests;
  a full tile grid only with an explicit `--region x,y,w,h` (capped, e.g. 256 × 256) for debugging and small
  synthetic tests.
- **#12 golden snapshots:** commit `meta.json` + `chunks.json` per fixture, not a full JSON grid.
- **#11 diff:** compare summaries and chunk digests first, then decode tiles only inside differing chunks.
- **M2:** .NET round trip as planned, plus: CWM export in .NET (`export-cwm`), extraction of test vectors to
  `contracts/vectors/`, JSON Schemas, BenchmarkDotNet baseline.
- **M3:** TS codec parses into CWM planes in a worker; runs the shared vectors; a CI job compares .NET and TS CWM
  output for every fixture byte for byte; benchmark budgets in place.
- `docs/architecture.md` (World model): `ContentRef`/`Tile` remain the semantic model; storage is CWM planes + palette.

## Resolved questions

1. **Hash:** SHA-256 truncated to 16 hex chars — built into .NET and Web Crypto, no dependency. Switch to xxHash
   only if digesting shows up in benchmarks.
2. **.NET storage:** the reference keeps its record-based `TileGrid` and converts to CWM on export (M2).
   Revisit if the round-trip writer needs planes.
3. **Chunk size:** 128 × 128, matching the renderer plan in `docs/architecture.md` (M4); confirm once the WebGL
   renderer exists.
