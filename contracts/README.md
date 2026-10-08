# contracts

Files both codecs are tested against. The .NET and TypeScript suites read the **same** files; there is no runtime
C#↔TS call (ADR 0001).

| Path | Schema | Content |
|---|---|---|
| `schemas/world-summary.v1.schema.json` | — | `export-json` output (owned by #10) |
| `schemas/chunks.v1.schema.json` | — | a golden `*.chunks.json` (`packages/test-fixtures/snapshots/m1`): the `chunks` object of the summary, stored alone |
| `schemas/vector.v1.schema.json` | — | the vector files below |
| `vectors/metadata.vectors.json` | `vector.v1` | M1–M5 |
| `vectors/tiles.vectors.json` | `vector.v1` | T1–T18 |
| `vectors/runs.vectors.json` | `vector.v1` | R1–R10 |
| `vectors/malformed/mutations.json` | — | malformed examples: each mutation is rejected by its declared schema or semantic validation layer |

## Schema versions
`schemaVersion` is `1` in every vector file and in the summary. A change that breaks a consumer is a new
`*.v2.schema.json` next to the old one, never an edit of a published meaning. Golden `chunks.json` files carry no
version of their own: they follow `chunks.v1` (128 × 128 tiles per chunk, plane names and 16 lowercase hex digest
characters exactly as in `world-summary.v1`; `x`/`y` are chunk indices in column-major order, edge chunks are smaller).

## Vector format
Source of the documented results: [docs/file-format/vectors.md](../docs/file-format/vectors.md), "Metadata and tile vectors".

- A file is `{ schemaVersion, group, vectors[] }`. A vector has `id`, `title`, `entry`, `context` and `cases[]`
  (one case per documented variant, e.g. M2 `height 0` / `width -1`, M5 both overruns).
- `entry` is the decoder seam: `REC` (one record, or the column prefix of R6), `SEC` (the complete tile section of
  a 2 × 4 world, R3/R9/R10) or `META` (metadata bytes from the field named by `context.startsAt`).
- `hex` is the input: lowercase, no separators. `context.baseOffset` is the **absolute** file offset of its first
  byte (REC and most META: `0`; SEC: pointer[1] = `100`; M3: `167`). For SEC, pointer[2] = `baseOffset` + byte
  count; for META, `context.inputEnd` is the absolute end of the supplied bytes (`baseOffset` + byte count) and
  `context.sectionEnd` the absolute end of the whole metadata section (pointer[1]); they are equal for the synthetic
  fragments and differ for M3, a 72-byte prefix of a section ending at 11927 (checked against the fixture header).
  Error `offset` is an absolute, nonnegative integer. Its bounds depend on that case's supplied bytes,
  and are checked by the semantic validator rather than by hardcoded schema limits.
- `context.frameImportant` is the real 326 set: `k = 754`, ids `4`, `5` frame-important, `1`, `255`, `256` not.
- A case has exactly one of `result` and `error`. Results are `record` (`tile` + `run`), `grid` (`tiles`
  column-major: `x * height + y`) or `metadata`. `tile` is the semantic tile of the summary schema without `x`/`y`.
  Errors carry `code` (`MalformedTiles` | `MalformedMetadata`), absolute `offset` and, where documented, `reason`,
  `field`, `x`, `y`. Where the document does not name an offset, this contract fixes it: the first byte of the
  failing record/field (R10: the first leftover byte).
- Fragments are record-level on purpose; R3 and R10 are complete sections and R9 is cut short on purpose. M3's
  bytes are the existing `SCCO1.wld` prefix (`provenance` gives file, SHA-256, offset and length); no full world is
  embedded. Only vanilla format 326 and synthetic bytes appear; unknown IDs are only the T13 example.

## Structural and semantic validation
The published validation contract has two layers; schema validation alone does not establish cross-field
consistency. Standard JSON Schema Draft 2020-12 numeric bounds are constants in the schema, not expressions over
instance fields ([validation specification](https://json-schema.org/draft/2020-12/json-schema-validation#section-6.2)).

1. **Structural:** `vector.v1` requires the entry-specific context, lowercase even-length nonempty hex,
   exactly one result or error, the appropriate error code, and a present nonnegative integer error offset.
   `chunks.v1` requires the existing chunk size, planes, digest format and structural dimensions from #10.
2. **Semantic:** `validateVectorSemantics` in `scripts/contracts-validation.mjs` checks every case against
   `baseOffset <= error.offset <= baseOffset + hex.length / 2`. Both boundaries are inclusive; the upper
   boundary permits end-of-input diagnostics. Each variant uses its own byte count. The same function checks
   META `inputEnd`, `sectionEnd >= inputEnd`, complete synthetic META fragments, and SEC result dimensions and
   tile count. It assumes its vector has already passed the schema. `validateChunkSemantics` checks the 128-grid
   count, column-major ordering and edge sizes against the associated `meta.json` dimensions.

`check-contracts.mjs` runs both layers for the real files. It also checks the 33 IDs, schema compatibility with
the existing summary, R3/R10's relationship, and M3's bytes, manifest provenance and real fixture section pointers.
M3 is an intentional prefix; do not replace its `sectionEnd` with its shorter `inputEnd`. R10's first leftover-byte
offset remains 107. Moving an input and its absolute offsets consistently is structurally and semantically valid;
the fixture-specific M3 provenance is additionally verified against the actual fixture.

Malformed mutations default to `validation: "schema"`: the schema must reject them. A mutation marked
`validation: "semantic"` must **pass** its schema and then fail the shared semantic validator, so an unrelated
structural error cannot hide a missing arithmetic check. `op: "delete"` removes an object property or an array
element. The examples cover all prior review probes, changed input bases, shorter inputs, individual variants,
META boundaries, mismatched section dimensions, missing chunks, wrong edge sizes and incorrect chunk positions.

## Running the same files
- Validate everything: `node scripts/check-contracts.mjs` (part of `bash scripts/verify.sh`). It checks the
  vectors against `vector.v1`, every golden `chunks.json` against `chunks.v1` plus the 128-grid edge sizes, the M3
  provenance, and that every malformed example is rejected at its declared layer. Its validator supports only the keywords the schemas
  use and fails on any other, the same subset as `dotnet/Terraria.WorldCodec.Tests/JsonSchemaSubset.cs`.
- xUnit: copy `contracts/**/*.json` next to the test assembly (as the `schemas` are already), load the files with
  `System.Text.Json`, validate with `JsonSchemaSubset`, apply the semantic checks above independently in C#,
  then decode `hex` at the entry point and compare. Do not call the JavaScript validator from the .NET codec.
- Vitest: `readFileSync` the same files from the repository root (`contracts/vectors/*.vectors.json`), decode
  validate the document with `validate`, apply `validateVectorSemantics` to each vector, then decode `hex` at
  the entry point and compare. The shared functions are exported by `scripts/contracts-validation.mjs`;
  `node --test scripts/contracts-validation.test.mjs` exercises the regression and positive boundary cases.
- Wrapping a `REC` vector in a whole-file harness is filler and must not change the result (see the
  documentation).

The xUnit harness uses compile-checked internal codec entry points, exposed only to `Terraria.WorldCodec.Tests`.
It consumes exactly one record for REC, except the documented four-record R6 column prefix, and rejects trailing
bytes after those records. `SharedContractVectorTests` owns the T1–T13 successful examples; the hand-written tile
tests retain additional boundaries, optional-field absence and malformed full-world diagnostics. Run/grid tests
and metadata tests retain their full-section/full-world checks beyond the shared REC and META fragments.
