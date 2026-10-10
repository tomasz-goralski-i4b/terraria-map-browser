# Editing world properties

The World tab edits every decoded metadata value, plus the file's save revision and favorite flag. File version,
file size, the section table and frame-important data remain structural information. Stored list lengths and the
size class are derived from their data.

Flags use checkboxes. Game mode, evil, moon type/phase, invasion type, ore tiers, background styles and tree/cave
styles use finite selectors. Unknown source values remain visible as a disabled stored-value option; changing
another property preserves them. Dates use native date/time controls, retaining the original UTC or unspecified
kind. The original DateTime binary (kind and sub-millisecond ticks included) stays intact unless edited.

Lists have individual fields and Add/Remove actions. Fixed arrays retain their length. Large indexed kill/banner
lists start collapsed. Party participants are stored NPC slots, selected from 0–199, rather than editable JSON.
Time is a tick count with a separate Day checkbox; changing the day/night flag does not silently change the ticks.

Text/numbers commit on Enter or blur; Escape restores the stored value. Saving flushes pending drafts and refuses
invalid values. Candidate edits are encoded and decoded before replacing the live metadata; Singles normalize to
their binary32 value. Integer width/range, finite numbers, GUID, UInt64, UTF-8 length caps, fixed array lengths and
dates are validated. An error stays beside its field; the prior world remains intact. Save As uses the existing
Worker to encode and read back the complete current world before writing or downloading. The opened file is never
overwritten. Changing a seed, biome or generation flag updates its saved setting and does not regenerate terrain.

Canvas dimensions rebuild the ten column-major planes from the top-left origin, preserving the overlapping area
and initializing extra cells as empty. Pixel bounds follow the new dimensions. Shrinking crops tiles; entities
must remain inside the canvas, and unreadable entity sections prevent shrinking. Dimensions are positive integers
up to 65,536, with an area no larger than a Large world (8400 × 2400) or the already loaded canvas, to bound editor
allocations. Resize starts a new brush history over the new planes.

## Finite appearance domains

The style choices were independently observed on the installed vanilla TerrariaServer 1.4.5.8 (format 326):
20,000 calls to `WorldGen.RandomizeBackgrounds`, `RandomizeCaveBackgrounds`, `RandomizeTreeStyle`,
`RandomizeMoonState`, and `WorldGen.TreeTops.RandomizeTreeStyle(random, index)`, recording runtime fields.
No method bodies or third-party data tables were read. Raw observations remain in the local `.tdd/` directory.
The public [WorldGen API](https://docs.tmodloader.net/docs/stable/class_world_gen.html) documents these callable
methods. The same selectors are offered for admitted older layouts; unknown stored styles remain preserved.

| Stored setting | Observed choices |
|---|---|
| Moon type | 0–8 |
| Forest backgrounds | 0–13, 31, 51, 71–73 |
| Corruption | 0–4, 51–52 |
| Jungle / Crimson | 0–6 |
| Snow | 0–8, 21–22, 31–32, 41–42 |
| Hallow | 0–5 |
| Desert | 0–4, 51–53 |
| Ocean | 0–7 |
| Mushroom | 0–4 |
| Underworld | 0–2 |
| Tree / cave / ice / jungle / hell styles | 0–5 / 0–7 / 0–3 / 0–1 / 0–2 |
| Tree top indices 0–3, 5, 8, 10, 12 | 0–5 |
| Tree top indices 4, 7, 9 | 0–4 |
| Tree top index 6 | 0–7, 21–22, 31–32, 41–42 |
| Tree top index 11 | 0–3 |

The runtime angler quest array has 41 entries. Moon phase has eight choices, also described by the
[official wiki](https://terraria.wiki.gg/wiki/Moon_phase). Invasion types and ore pairs follow the existing
public IDs used by the codec/UI. Future game changes require new observations before expanding appearance choices.
