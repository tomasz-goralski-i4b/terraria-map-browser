# POC: local Terraria map palette via reflection

## Problem and leading reasoning

The colour renderer currently hashes content IDs. Those colours do not represent Terraria's map palette.
We want to read the installed game's palette rather than maintain copied tables or derive colours from sprites.
Reflection can obtain current lookup tables and option counts without decompiling the game.
The exporter and the JSON importer are independent of both world codecs. The deployed TypeScript app has no
runtime C# calls, .NET dependency, or local service.

This is a feasibility experiment, not an agreed product workflow.

## What the POC does

- A local PowerShell script hosts the reflection code in Windows' .NET Framework runtime. For the Windows
  Terraria assembly it switches to the 32-bit host required by XNA. There is no game reference at build time.
- It reads the palette, indexed tile/wall lookups and variant counts after initialization. The game launcher's
  save-root field is initialized to the temporary directory before the Main static initializer; no world is opened.
- It exports a versioned JSON document containing the game version, all tile/wall map options, and four liquids.
  Missing contract members or invalid lookup ranges fail explicitly, rather than claiming a newer game is supported.
- The front invokes its local JSON importer whenever a world is opened. A previously imported palette is restored
  from origin-local storage. Without one it renders placeholders and exposes a POC file input. The input can also
  recolour an already loaded world without reparsing its .wld or uploading its chunk planes again.
- Nothing is uploaded. Real palette exports are gitignored; committed fixture colours are authored synthetic data.

The renderer uses option zero for each material. Frame-dependent map options, paints, depth gradients,
exploration/light levels and mod colours remain outside this experiment. Reading current data avoids a fixed ID
count, but reflection member names, runtime initialization and game-version compatibility still need validation.

## Local experiment

From the repository root in Windows PowerShell:

```powershell
./scripts/export-map-palette.ps1 -TerrariaAssembly 'C:/Program Files (x86)/Steam/steamapps/common/Terraria/TerrariaServer.exe'
```

The default output is `local-assets/terraria.terraria-map-palette.json`. In the POC web app, select **Import map
palette (POC)** and choose that JSON. Opening a world then invokes the importer and uses the imported colours.
Re-export and re-import after changing game versions. **Use placeholder colours** clears the saved import.
Denied/quota-limited storage keeps a valid import usable for the current page session and reports the limitation.

For the opt-in integration check (never configured in CI):

```powershell
$env:TERRARIA_ASSEMBLY = 'C:/Program Files (x86)/Steam/steamapps/common/Terraria/TerrariaServer.exe'
node --test scripts/map-palette/export-map-palette.test.mjs
```

## Unresolved deployed-site question

**User's question:** After deploying the site externally, how would a user who only visits the website have the
palette loaded? Where would they get an exporter, and how would it run?

**We do not know yet how to approach this product workflow.** A browser-only visit does not supply the local
reflection export. The current POC demonstrates local acquisition and import, not automatic palette availability
on a deployed site. Asking users to download/run scripts, or installing a local service, is not an agreed solution.

**User's strong preference:** Simply ship/commit the colour atlas exported from the application rather than
introducing local-export workarounds and additional user processes. Evaluate that option, the applicable rights
and the repository's rules before selecting the final design.

This POC does not grant permission to redistribute the game's exported palette. Its exports remain local.
No independent review was requested or performed; Claude should evaluate the design later when available.

## Contract and evidence

`schemaVersion: 1`, a non-empty `gameVersion`, `tiles[id][option]` and `walls[id][option]` as RGB triplets,
plus `liquids` as water/lava/honey/shimmer RGB triplets. Empty option arrays preserve IDs with no map entry.
Channels must be integers in 0–255; tables are bounded to 65535 entries and 256 options per entry; import is
limited to 4 MiB. A missing content ID uses the existing placeholder. Browser persistence is specific to the origin.

The reflected contract was described using these sources; no source code or colour tables were copied:

- [tModLoader MapHelper API](https://docs.tmodloader.net/docs/stable/class_map_helper.html): initialization,
  tile/wall lookup arrays and option counts.
- [TEdit exporter](https://github.com/TEdit/Terraria-Map-Editor/blob/99928583086ff1c0c970c5528c7d72c76da39a53/src/SettingsFileUpdater/TerrariaHost/MapColorsExporter.cs#L75-L94):
  revision `99928583086ff1c0c970c5528c7d72c76da39a53`, lines 75–94, names and static nature of palette fields.
- Local Terraria 1.4.5.8: runtime reflection confirmed the Windows assembly requires a 32-bit .NET Framework host,
  a launcher save root, and exposes the liquid palette position. No decompiled instructions were inspected.
