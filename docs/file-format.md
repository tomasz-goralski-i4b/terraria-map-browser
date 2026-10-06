# The `.wld` format

The format specification in our own words (the contract for both the .NET and TS codecs).
Filled in by `spike` issues and implementation steps. Nothing here is copied from TEdit or tModLoader: the sources
were read, the behaviour is restated, and every byte-level claim was checked against the M1 fixture corpus
(`packages/test-fixtures/worlds/`).

The specification is split into parts. **Read only the part your task needs** — the issue's `Spec:` line names it;
otherwise pick it from the table. Code and tests cite sections by name (e.g. `docs/file-format.md, "Model mapping"`);
the table maps every section name to its file.

| Part | Sections |
|---|---|
| [sources-and-versions.md](file-format/sources-and-versions.md) | Sources (source ids T1–T27), Versions, Discrepancies between sources |
| [header.md](file-format/header.md) | File header (version gates, **Check order**), Section table, Frame-important bits, Hex examples A–E |
| [metadata.md](file-format/metadata.md) | Primitive types, World metadata (section 1; rows 1–59, **Dimensions**) |
| [tiles.md](file-format/tiles.md) | Tile data (section 2): Order and coordinates, Record layout, Rules and limits; Model mapping; Sections skipped in M1 |
| [vectors.md](file-format/vectors.md) | Metadata and tile vectors: Entry points, Metadata (M1–M5), Single records (vectors T1–T18), Runs and columns (R1–R10) |
| [writer.md](file-format/writer.md) | Footer (M2), Writer contract (M2, format 326): layout, header rules, tile encoding, noncanonical input, writer vectors (W-*), evidence |
| [open-questions.md](file-format/open-questions.md) | Open questions (numbered; cited as "open question N") |

Issue drafts proposed by the format spikes live in [planning/file-format-follow-ups.md](planning/file-format-follow-ups.md).

## Editing rules
- Add new facts to the part that owns the section; add a new part (and a row above) only for a new section family.
- Keep section headings stable — code, tests, contracts and other docs cite them by name.
