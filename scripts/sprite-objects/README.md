# Sprite object observer

Observes how a local Terraria installation stores and draws minecart tracks and trees
([ADR 0003](../../docs/adr/0003-observe-framing-in-the-game.md)): the game's own placement, framing and draw-data
functions are called on synthetic tiles in a synthetic world, and only what they return or write is recorded. No game
code is read. The raw output stays local; the one committed product is
`packages/renderer/src/objects/terraria-sprite-objects.generated.ts`. The rules are in `docs/assets.md`
("Minecart tracks", "Trees").

| File | Does |
|---|---|
| `observe.ps1` | loads `TerrariaServer.exe` in a 32-bit host and records: every track piece's source rectangle and extras (`Minecart.GetSourceRect`, `DrawLeftDecoration`, …), placed track layouts, grown trees and palms with their draw data (`TileDrawing.GetTileDrawData`), and on synthetic trees over every block type the foliage data (`WorldGen.Get…TreeFoliageData`) for every tree top variation 0–63 at 30 columns, the trunk biome (`GetTreeBiome`) and the palm biome (`GetPalmTreeBiome`) (about 30 s) |
| `export.mjs` | refuses an incomplete or inconsistent observation and writes the generated tables |
| `export.test.mjs` | the exporter on a synthetic observation; opt-in (`TERRARIA_ASSEMBLY`): the committed tables against a fresh observation |

## After a game update

```powershell
./scripts/sprite-objects/observe.ps1 -TerrariaAssembly '<Terraria>/TerrariaServer.exe' -OutputPath local-renders/sprite-objects.json
```

```bash
node scripts/sprite-objects/export.mjs local-renders/sprite-objects.json
TERRARIA_ASSEMBLY='<Terraria>/TerrariaServer.exe' node --test scripts/sprite-objects/export.test.mjs
```

If the game renames a member the observer uses, it stops with "Unsupported observation contract: …"; the full error
is written next to the output (`<output>.error.txt`), since the 32-bit host forwards only its first line.
