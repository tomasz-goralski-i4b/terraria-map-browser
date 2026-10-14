# Waterfall source observer

Observes where a local Terraria installation starts waterfalls
([ADR 0003](../../docs/adr/0003-observe-framing-in-the-game.md), waterfall addendum): synthetic tiles are placed in a
synthetic world and the game's own source finder is asked which sources it finds. No game code is read and nothing
observed is committed; the rules are in `docs/assets.md` ("Waterfalls") and in
`packages/renderer/src/objects/waterfalls.ts`.

| File | Does |
|---|---|
| `observe.ps1` | loads `TerrariaServer.exe` in a 32-bit host; for each case of a cases file (tiles around (32, 32)) records the sources `WaterfallManager.FindWaterfalls` finds, and the manager's `maxLength`, `minWet` and `waterfallDist` (a few seconds) |
| `observe.test.mjs` | opt-in (`TERRARIA_ASSEMBLY`): about 1 100 cases (a half block and other centres between every pair of side tiles, every tile above and below) through the observer and through the viewer's `waterfallSources`; they must agree case by case |

## After a game update

```bash
pnpm --filter @studio/renderer build
TERRARIA_ASSEMBLY='<Terraria>/TerrariaServer.exe' node --test scripts/waterfalls/observe.test.mjs
```

If the game renames a member the observer uses, it stops with "Unsupported observation contract: …"; the full error
is written next to the output (`<output>.error.txt`).
