# contracts

Files both codecs are tested against. The .NET and TypeScript suites read the **same** files; there is no runtime
C#↔TS call (ADR 0001).

| Path | Schema | Content |
|---|---|---|
| `schemas/world-summary.v1.schema.json` | — | `export-json` output (owned by #10) |
| `schemas/chunks.v1.schema.json` | — | a golden `*.chunks.json` (`packages/test-fixtures/snapshots/m1`): the `chunks` object of the summary, stored alone |
| `schemas/vector.v1.schema.json` | — | the vector files below |
| `vectors/metadata.vectors.json` | `vector.v1` | M1–M5 |
| `vectors/tiles.vectors.json` | `vector.v1` | T1–T17 |
| `vectors/runs.vectors.json` | `vector.v1` | R1–R10 |
| `vectors/malformed/mutations.json` | — | malformed examples: each mutation of a valid file must be rejected by its schema |

## Schema versions
`schemaVersion` is `1` in every vector file and in the summary. A change that breaks a consumer is a new
`*.v2.schema.json` next to the old one, never an edit of a published meaning. Golden `chunks.json` files carry no
version of their own: they follow `chunks.v1` (128 × 128 tiles per chunk, plane names and 16 lowercase hex digest
characters exactly as in `world-summary.v1`; `x`/`y` are chunk indices in column-major order, edge chunks are smaller).

## Vector format
Source of the documented results: [docs/file-format.md](../docs/file-format.md), "Metadata and tile vectors".

- A file is `{ schemaVersion, group, vectors[] }`. A vector has `id`, `title`, `entry`, `context` and `cases[]`
  (one case per documented variant, e.g. M2 `height 0` / `width -1`, M5 both overruns).
- `entry` is the decoder seam: `REC` (one record, or the column prefix of R6), `SEC` (the complete tile section of
  a 2 × 4 world, R3/R9/R10) or `META` (metadata bytes from the field named by `context.startsAt`).
- `hex` is the input: lowercase, no separators. `context.baseOffset` is the **absolute** file offset of its first
  byte (REC and most META: `0`; SEC: pointer[1] = `100`; M3: `167`). For SEC, pointer[2] = `baseOffset` + byte
  count; for META, `context.sectionEnd` is the absolute end of the metadata section (pointer[1]).
- `context.frameImportant` is the real 326 set: `k = 754`, ids `4`, `5` frame-important, `1`, `255`, `256` not.
- A case has exactly one of `result` and `error`. Results are `record` (`tile` + `run`), `grid` (`tiles`
  column-major: `x * height + y`) or `metadata`. `tile` is the semantic tile of the summary schema without `x`/`y`.
  Errors carry `code` (`MalformedTiles` | `MalformedMetadata`), absolute `offset` and, where documented, `reason`,
  `field`, `x`, `y`. Where the document does not name an offset, this contract fixes it: the first byte of the
  failing record/field (R10: the first leftover byte).
- Fragments are record-level on purpose; R3 and R10 are complete sections and R9 is cut short on purpose. M3's
  bytes are the existing `SCCO1.wld` prefix (`provenance` gives file, SHA-256, offset and length); no full world is
  embedded. Only vanilla format 326 and synthetic bytes appear; unknown IDs are only the T13 example.

## Running the same files
- Validate everything: `node scripts/check-contracts.mjs` (part of `bash scripts/verify.sh`). It checks the
  vectors against `vector.v1`, every golden `chunks.json` against `chunks.v1` plus the 128-grid edge sizes, the M3
  provenance, and that every malformed example is rejected. Its validator supports only the keywords the schemas
  use and fails on any other, the same subset as `dotnet/Terraria.WorldCodec.Tests/JsonSchemaSubset.cs`.
- xUnit: copy `contracts/**/*.json` next to the test assembly (as the `schemas` are already), load the files with
  `System.Text.Json`, validate with `JsonSchemaSubset`, then decode `hex` at the entry point and compare.
- Vitest: `readFileSync` the same files from the repository root (`contracts/vectors/*.vectors.json`), decode
  `hex` at the entry point and compare.
- Wrapping a `REC` vector in a whole-file harness is filler and must not change the result (see the
  documentation).
