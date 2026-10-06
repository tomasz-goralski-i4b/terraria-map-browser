# Terraria Map Studio

A local, browser-based editor for Terraria worlds + a Personal Software Factory experiment.

- Plan: [docs/architecture.md](docs/architecture.md)
- Rules for agents: [AGENTS.md](AGENTS.md)
- Cezar workflow: [docs/agent-workflow.md](docs/agent-workflow.md)

```bash
pnpm install
bash scripts/verify.sh
```

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
format errors. Reports go to stdout; diagnostics go to stderr without a stack trace.

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
