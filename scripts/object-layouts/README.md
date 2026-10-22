# Object layout observer

Observes how a local Terraria installation lays out multi-tile objects (chests, doors, chairs, torches, …) on their
sprite sheets ([ADR 0003](../../docs/adr/0003-observe-framing-in-the-game.md), object layouts addendum): per
frame-important tile type, the placement data is read by reflection, every style an item places is placed with the
game's own `WorldGen.PlaceObject` into a synthetic cavity, and the frames it writes are recorded. No game code is read.
The raw output stays local; the one committed product is
`packages/world-model/src/terraria-object-layouts.generated.ts`. The rules are in `docs/assets.md` ("Object frames").

| File | Does |
|---|---|
| `observe.ps1` | loads `TerrariaServer.exe` in a 32-bit host; per frame-important type: its `TileObjectData` geometry, the styles items place (`Item.placeStyle`), and the frames `PlaceObject` writes for each of them on a stone, table or platform floor (about 15 s) |
| `export.mjs` | writes a layout only for types whose layout reproduces every placed style, and lists the others with the reason |
| `export.test.mjs` | the exporter on a synthetic observation |

## After a game update

```bash
pnpm --filter @studio/world-model build
powershell -File scripts/object-layouts/observe.ps1 -TerrariaAssembly '<Terraria>/TerrariaServer.exe' -OutputPath local-renders/object-layouts.json
node scripts/object-layouts/export.mjs local-renders/object-layouts.json
```

If the game renames a member the observer uses, it stops with "Unsupported observation contract: …"; the full error
is written next to the output (`<output>.error.txt`).
