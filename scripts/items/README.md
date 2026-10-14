# Complete item catalog and local inventory sprite extraction

#156 implements the item database requested alongside the existing block/wall databases. It covers **every
ID from 0 through ItemID.Count - 1**, not just items found in the fixture chests. The shipped table contains
English names, prefix names and numeric/symbolic sprite metadata; PNGs stay local (ADR 0002, item addendum).

## Regenerate and extract every icon

From the repository root, in Git Bash on Windows:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
node scripts/items/export.mjs 'C:/Program Files (x86)/Steam/steamapps/common/Terraria/TerrariaServer.exe' \
  --sprites local-assets/items-1.4.5.8
```

The `--sprites` directory must **not exist**; the command stages it and publishes it after every available
icon has been cropped successfully. Omit `--sprites` to regenerate the database and validate all crops without
writing PNGs. `--output <module.ts>` overrides the default generated module for a comparison run. The selected
assembly's sibling `Content/Images` is the source; all `Item_<digits>.xnb` lookups ignore filename case.
Build first: the script imports the existing independent codec from `packages/assets/dist/index.js`.

`observe.ps1` automatically switches to 32-bit Windows PowerShell for the installed XNA game. It initializes
English through the game's localization loader, reflects item/prefix IDs and texture aliases, initializes
item animations and calls their `GetFrame` using actual decoded sheet dimensions and a dimensions-only XNA
texture (no GPU). The game supplies first-frame rectangles, including animation gutters; nothing is inferred
from a third-party table or decompiled method body. Unsupported contracts, alias cycles, duplicate sheet IDs,
bad XNB files and out-of-bounds frames fail rather than silently skipping items.

The exporter writes UTF-8 without BOM and stable ID/property order. Regenerate
`packages/assets/src/items/terraria-items.generated.ts`; never edit it manually. Its public export is
`terrariaItems` from `@studio/assets`. Items have name and sprite statuses so a runtime ID with an empty name
is still retained. ID 0 is empty, not a missing sprite. Missing local sheets retain a named catalog entry with
`spriteStatus: "missing"`, not fabricated pixels.

When extracting PNGs, `manifest.json` records **every** ID, status, resolved texture ID, PNG filename,
dimensions and RGBA/PNG SHA-256 for available sprites, or a reason for an unavailable one. Aliases get their
own `Item_<id>.png`, even when their bytes equal a source item's PNG. This is an inventory preview, not a
replacement for the original animated XNB sheets used by the atlas. Raw observations live in temporary storage
and are removed after the run; no game resource, executable or image is committed. Keep output under the
gitignored `local-assets/` or another private local directory.

## Observed coverage (2026-10-14)

Terraria **1.4.5.8**, Steam build `24893155`; server assembly SHA-256
`328872c65a4a7a94f050ead1566f1567af15c3193d4d7008a460507d3686d7c2`.

| Metric | Result |
|---|---:|
| Complete ID range | 0–6195 (6196 records) |
| Empty item | ID 0 |
| Resolved English item names | 6194 |
| Unnamed nonempty ID | 4143 (`ManaCloakStar`, runtime returns an empty name) |
| Source item XNB files | 6134 |
| Runtime texture aliases | 67 |
| Extracted inventory PNGs | 6195 |
| Nonempty IDs without sprites | 0 |

Worked checks: item 8 → Torch; item 1156 → Piranha Gun; prefix 55 → Unpleasant; item 3665 → Trapped Chest,
texture 48, frame 32 × 28. Animated item 75 (Fallen Star) produces 22 × 24, item 520 (Soul of Light) 22 × 26.
ID 4143 has an available 18 × 18 icon despite its missing name; UI fallback is `Item 4143`. Every crop is
validated against the decoded source sheet. A repeated export must reproduce the generated module and hashes.

ID 4143 is **Mana Cloak Star**, a pickup associated with Mana Cloak, not a reserved ID. The
[official wiki](https://terraria.wiki.gg/wiki/Mana_Cloak_Star) identifies that ID and its 50-mana restoration
(checked 2026-10-14). The generated catalog still records the exact empty runtime name and the reflected
`ManaCloakStar` symbol; the wiki label is explanatory evidence, not a copied table or a hand-edited database entry.

## Checks

```bash
node --test scripts/items/export.test.mjs
TERRARIA_ASSEMBLY='C:/Program Files (x86)/Steam/steamapps/common/Terraria/TerrariaServer.exe' \
  node --test scripts/items/export.test.mjs
bash scripts/verify.sh
```

The ordinary tests use the generated catalog and realistic synthetic pixels to check completeness, ID order,
alias preservation, explicit unavailable states, frame bounds, row order and PNG round-trip pixels. The opt-in
test regenerates the complete catalog from the installed game, extracts every available sprite and compares
the catalog. CI runs ordinary tests; it never needs game assets. Other game/runtime releases need their own
observations; identical world format numbers do not establish item catalog compatibility.
