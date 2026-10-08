# Format 279 viewer PoC

The browser's independent TypeScript codec accepts exactly 279 and 326. Format 279 is Terraria 1.4.4.9;
the inspected tModLoader client reports `1.4.4.9+2026.08.3.0`. This is read-only viewer support: the .NET
reference codec and binary writer remain scoped to 326. No runtime calls between codecs are introduced.

## Layout differences

The signature, eleven section pointers, column-major tile records and RLE layout are shared. Framing comes
from the input header, never a fixed tile-type table (693 entries in the inspected 279 world, versus 754
in our 326 fixtures).

The existing [metadata field gates](metadata.md) describe the differences; the TS reader now follows those
gates for both accepted versions. In 279 it reads eight special-seed flags rather than nine (no skyblock),
creation time without last-played, and kill counts without claimable banners. Metadata ends after the
moondial cooldown. Permanent holiday flags, vampire/infected/team/dual-dungeon/lightning seeds, meteor/coin
counts, team spawns and the world-generation manifest are absent.

Other sections also differ, although the viewer does not decode them: 279 chests have one shared Int16 slot
count rather than a per-chest Int32 count (gate 294); town NPCs omit homeless-despawn (315); display dolls
omit pose (307) and extra slots (308). See [entities.md](entities.md). These rules are independently
described from the already pinned sources T11, T29, T32 and T34 in [sources-and-versions.md](sources-and-versions.md),
TEdit revision `182031b83ce825719f857a6db4ecb6967118abd3`, `World.FileV2.cs:1996–2476,1770–1826,1841–1915`
and `TileEntity.cs:502–580`. No third-party implementation or data table is copied.

## Residual tile shapes

The local generated world `CMCO1` contains 11,280 records with a valid shape (half block or slope) but no
active block. For example, its record at byte 56328, tile (21, 3713), begins with flags `11 30`: lava,
no foreground block, shape 3. The shape adds no payload bytes. The 279 reader preserves it in the CWM
shape plane while keeping the block plane empty; the map displays the liquid/wall/background normally.

This exception applies only to 279. Format 326 still rejects shapes without a block. Both versions retain
the existing errors for ownerless paint/id-width flags, unknown shapes, reserved bits, invalid shimmer,
truncated records and RLE crossing a column boundary. The tile section must still be consumed exactly.

## Local evidence and limits

The inspected world has dimensions 13,400 × 3,800, seed `598261056`, all eight special-seed flags enabled,
and 8,251,979 tile records. The independent metadata walk and structural tile scan end at byte 3392 and
52257490 respectively, exactly matching the section pointers. Its footer matches the name/id and EOF.

The companion `.twld` is gzip-compressed NBT. Its mod tile/wall maps are empty; AdvancedWorldGen's
`ModifiedWorld` data includes `Random.Painted`, `Celebrationmk10.Painted` and combined special-seed options.
It also stores mod/version provenance, additional item data for 113 chests (for example ImproveGame's
global data attached to a vanilla item), eight mod-system records and three altered vanilla event timers.
The viewer does not interpret or write this companion file. Full support for modded content is outside this PoC.

The CWM's ten tile planes require 763,800,000 bytes for this world. Workers transfer these buffers to the
main thread without cloning them. The existing chunk renderer uploads visible chunks in bounded batches.
Camera fitting and wheel zoom allow a smaller minimum scale when needed to fit the complete custom world.

Regression tests use independently generated small worlds, plus metadata-only checks of the observed
dimensions and seed settings. Player files remain outside the repository and are never rewritten or
included in test fixtures.
