# Tile framing observer

Observes how a local Terraria installation frames blocks without stored frames ([ADR 0003](../../docs/adr/0003-observe-framing-in-the-game.md)):
the game's own `WorldGen.TileFrame` is called on synthetic tiles and only the frames it writes are recorded. No game
code is read. Its raw output stays local; the one committed product is the framing database it generates. The rules it checks are in `docs/assets.md` ("Tile framing",
"Runtime observation results").

| File | Does |
|---|---|
| `export-cases.mjs` | reads the generated observation world (#158) with our codec and writes its cases as observer input |
| `observe.ps1` | loads `TerrariaServer.exe` in a 32-bit host, frames the cases, every 3 × 3 neighbourhood of 17 type pairs, every side-shape combination and every block's slab, and writes `observed.json` (about 10 s) |
| `analyse.mjs` | turns `observed.json` into a Markdown report per open question, or compares two observations |
| `observe.ps1 -Mode Database -Shard i -Shards n` | the framing database: every self-framed block type against every other, walls, shaped corners; run n shards in parallel (12 shards take about 15 minutes) |
| `observe.ps1 -Mode Check` | frames given samples `[centre, other, code, variant]`, to compare the committed database with the installed game |
| `export-database.mjs` | merges the shards, refuses any failed verification, and writes `packages/renderer/src/framing/terraria-framing.generated.ts` |
| `observe.test.mjs` | opt-in conformance: runs the observation, checks the documented rules, and checks 3 000 random database samples against the game (`TERRARIA_ASSEMBLY`) |

## After a game update

1. Check the documented rules against the new version (generates the world, observes, asserts; about a minute):

   ```bash
   TERRARIA_ASSEMBLY='<Terraria>/TerrariaServer.exe' node --test scripts/framing/observe.test.mjs
   ```

2. To see exactly what changed, keep the previous version's observation and compare:

   ```bash
   dotnet run --project dotnet/Terraria.WorldCodec.Synthetic -- generate packages/test-fixtures/worlds/SJCO1.wld local-renders/framing.wld
   node scripts/framing/export-cases.mjs local-renders/framing.wld local-renders/framing.wld.manifest.json local-renders/framing-cases.json
   ```

   ```powershell
   ./scripts/framing/observe.ps1 -TerrariaAssembly '<Terraria>/TerrariaServer.exe' -CasesPath local-renders/framing-cases.json -OutputPath local-renders/framing-<version>.json
   ```

   ```bash
   node scripts/framing/analyse.mjs --compare local-renders/framing-<old>.json local-renders/framing-<new>.json
   node scripts/framing/analyse.mjs local-renders/framing-<new>.json local-renders/framing-cases.json local-renders/framing-report.md
   ```

   The comparison lists catalogue cases, neighbourhood and shape codes and large-frame ids whose cells changed. Keep
   the observations in `local-renders/` (gitignored); they are game-derived and never committed.

3. If the database check fails (or the game version changed), regenerate the database and commit the result:

   ```powershell
   0..11 | ForEach-Object { Start-Process powershell -ArgumentList "-NoProfile -File scripts/framing/observe.ps1 -TerrariaAssembly '<Terraria>/TerrariaServer.exe' -Mode Database -Shard $_ -Shards 12 -OutputPath local-renders/framing-db-$_.json" }
   ```

   ```bash
   node scripts/framing/export-database.mjs local-renders/framing-db-*.json
   ```

4. Update `docs/assets.md` where the report and the tests disagree with it, and the catalogue expectations in
   `dotnet/Terraria.WorldCodec.Synthetic/framing-cases.json`.

If the game renames a member the observer uses, it stops with "Unsupported framing observation contract: …"; if the
game's tile data is not fully initialized, a sentinel stops it ("Framing is not initialized …") instead of recording
wrong frames.
