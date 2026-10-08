# Terraria Map Studio

A local, browser-based editor for Terraria worlds + a Personal Software Factory experiment.

- Plan: [docs/architecture.md](docs/architecture.md)
- Rules for agents: [AGENTS.md](AGENTS.md)
- Cezar workflow: [docs/agent-workflow.md](docs/agent-workflow.md)

```bash
pnpm install
bash scripts/verify.sh
```

Run the browser viewer (builds the workspace packages first, then serves it with Vite):

```bash
pnpm build
pnpm --filter @studio/web dev   # open the printed URL
```

See [apps/web/README.md](apps/web/README.md). `pnpm --filter @studio/web preview` serves the production build.

Inspect a world with the read-only M1 CLI:

```bash
dotnet run --project dotnet/Terraria.WorldInspector -- inspect "Forest Observatory.wld"
```

The report includes the format version, name, world ID, seed and game mode when present,
evil biome, dimensions, tile count, and counts of tiles containing blocks, walls or liquids.
Counts include expanded run-length repeats and explicitly present zero-amount liquids.
Later sections, including the footer, are listed as skipped; their contents are not validated.
Only M1-supported formats (currently version 326) are accepted. The command does not modify
the input or create world or backup files, and provides no round-trip guarantee.

Exit codes are `0` for success, `2` for invalid arguments (with usage), and `1` for I/O or
format errors or unexpected internal failures. Reports go to stdout; diagnostics go to stderr
without a stack trace. All three commands retain specific I/O and format diagnostics; unexpected
failures, including failures during report conversion after a successful read, produce one fixed
internal-error line and leave stdout empty. Fatal resource exhaustion (`OutOfMemoryException`)
propagates instead of being replaced with this diagnostic.

Inspect renders control characters in the world name and seed as literal four-digit Unicode
escapes (for example, `\u000a` for LF and `\u001b` for ESC), keeping each field on one line.
This also covers Unicode line/paragraph separators (U+2028/U+2029) and bidi controls
(U+061C, U+200E/U+200F, U+202A–U+202E and U+2066–U+2069), preventing visual reordering.
Printable non-ASCII text remains readable. Export-json uses the existing JSON string escaping.

Export a deterministic world summary (metadata, dimensions, skipped sections, palette and
per-chunk plane digests) as JSON on stdout:

```bash
dotnet run --project dotnet/Terraria.WorldInspector -- export-json "Forest Observatory.wld"
dotnet run --project dotnet/Terraria.WorldInspector -- export-json "Forest Observatory.wld" --region 0,0,64,64
```

`--region x,y,w,h` additionally lists the semantic tiles of that region (at most 256 × 256).
The format is described in [docs/cwm.md](docs/cwm.md) and validated by
`contracts/schemas/world-summary.v1.schema.json`. Exit codes are as above; a malformed region
or one outside the world is an argument error (`2`).

Export deterministic CWM v1 bytes (metadata, palette and all ten planes) to an artifact directory:

```bash
dotnet run --project dotnet/Terraria.WorldInspector -- export-cwm "Forest Observatory.wld" "artifacts/Forest Observatory.cwm"
```

Create the output directory first and choose a new output file. The binary framing is specified in
[docs/cwm.md](docs/cwm.md#binary-framing-export-cwm). The input is read without modification;
argument errors return `2`, format or I/O errors return `1`, and failures leave no completed partial
output. Generated `.cwm` files belong in temporary or artifact directories and must never be committed.

Write a round-tripped copy of a vanilla (format 326) world for validation:

```bash
dotnet run --project dotnet/Terraria.WorldInspector -- roundtrip "Forest Observatory.wld" "copy.wld"
```

The world is read, written to a staged file next to the output, reloaded and compared, and only then moved to
the output path, which is printed on stdout (exit `0`). The command never replaces a file: an output path that
already exists, or that is the input under another spelling (`..`, case, symbolic link), exits `2` and writes
nothing. A failure while reading, writing or validating exits `1` with a one-line diagnostic and leaves no
output and no staged file. A successful run is only a structural check, not a claim that the game accepts the
world ([docs/round-trip.md](docs/round-trip.md)).

Compare two M1 worlds semantically:

```bash
dotnet run --project dotnet/Terraria.WorldInspector -- diff "Forest Observatory.wld" "Crimson Observatory.wld" --max 100
```

The diff compares metadata, dimensions, skipped-section lengths and palette contents before
chunk plane digests. Detailed tile comparisons resolve ContentRef values and visit candidate
chunks only. When the palettes differ (reordered or with other entries), block and wall indices are
compared through one shared palette, so unchanged chunks are still skipped.
The M1 reader still eagerly reads both worlds to build their summaries. Different legal RLE
encodings and reordered palettes alone are equal; opaque skipped-section contents are ignored.

Summary differences precede tile differences, which are ordered by x, then y. Each tile line
names a field and its before/after values (wires as names, e.g. `"red, green"` or `"none"`); a
metadata field present on one side only is reported as `absent` on the other; different dimensions
also report one-sided positions.
`--max n` caps tile field differences (default 100, zero allowed), without capping summary
differences, and reports the exact omitted count. Exit codes are `0` for no differences,
`3` for differences, `2` for invalid arguments and `1` for a read error naming the failing side.
Both input files remain unchanged.
