# Editing tools

## Area copy and paste

Select (`M`) drags an inclusive rectangular selection; the status bar shows its size (in the danger colour above the
Copy limit). Copy (`Ctrl+C`, or Command on macOS) captures independent CWM planes and a content palette; subsequent
edits do not change the clipboard. The options bar is one row, like Brush's: a **Layers** row of independent toggles
(Blocks, Walls, Liquids, Wires, Paint, Objects; all on by default) chooses what Copy takes, then the Copy, Paste and
Deselect buttons. Objects need Blocks: while Blocks is off, the Objects toggle shows as off and disabled, and its
tooltip says why; turning Blocks back on restores it. Changing the toggles takes effect on the next Copy. The
selection stays on the map when another tool is chosen (Copy still works), but Escape deselects only in Select, so
elsewhere it keeps its own meaning (unpinning the Inspector's tile, taking back a stroke). With no area to copy or
paste, or with page text selected, `Ctrl+C` and `Ctrl+V` stay the browser's.

Paste (`Ctrl+V`) switches Select to a floating, translucent map-colour preview that follows the pointer. The options
bar then shows the anchor, the paste toggles and Place paste / Cancel paste. The **anchor** is a 3 × 3 reference-point
grid, as in an image editor's transform options (the arrow keys move it): the chosen point of the paste sits under
the pointer, the centre by default. A paste may hang over the world's edge; only the part inside is drawn and placed.
From the menu with the pointer off the map, the paste lands over the current selection. Click or Enter places it; a click while a large
preview is still being prepared places it as soon as it is ready, unless the pointer moves first. Escape works as in image
editors: it drops a floating paste and keeps the selection; pressed again, it deselects. The Edit menu (after Undo
and Redo), command palette and buttons use the same commands, and each disabled one says why. Text fields retain
native copy and paste. Right/middle drags still pan.

By default the whole rectangle replaces what is there, its empty cells included. **Skip empty blocks** keeps the
destination block and its paint/coatings where the copy has no block; **Skip empty walls** does the same for walls.
Copied blocks and walls always land; to leave the destination's walls untouched, turn Walls off under Layers before
Copy. **Merge liquids** adds matching kinds, capped at 255, and keeps a different destination kind and liquid where
the copy has none. Unselected layers stay unchanged.
Each placement is one undo entry in the brush history, including copied entity records, with renderer invalidation
updating adjacent framing.

Frame-important tiles are grouped conservatively into connected same-content components. A component crossing
the selection or world boundary is omitted whole; adjacent identical objects may therefore be omitted together.
Chest/sign footprints must also be complete. A paste replaces the destination objects it writes blocks into, as the
Eraser removes a chest: each one goes whole (the same connected same-content component, also its tiles outside the
rectangle), with the chest, sign, tile-entity or pressure-plate record anchored on it, a chest's items included. The
hint says so before placing (*replaces 2 objects (1 chest with its items)*), and Undo restores tiles and records
together. Empty copied cells under Skip empty blocks touch nothing. A paste that would break an object it does not
replace (the supports of a chest or sign one tile around it; four tiles around a tile entity, whose orientation is
unobserved) reports it before placement. Copied tile entities get new IDs and keep their full
binary payload, including fields outside the semantic model. Selections are limited to 262,144 cells to bound
clipboard/preview allocation; an oversized Copy reports its limit without replacing the previous clipboard.

## Eraser layers

Erase has its own layer mask, the same toggles as Select's Layers row: **Blocks** (on by default), **Walls**,
**Liquids** and **Wires** (wires of every colour and the actuator), in any combination with at least one on. So
liquids or wires can be erased on their own without touching blocks or walls. `X` swaps the Blocks and Walls
toggles and `Shift+X` turns both on; Liquids and Wires stay as they are. The mask is independent of Brush's
Blocks / Walls / Both target. Smooth edges needs Blocks.

## Chest Eraser

Eraser with Blocks on removes a touched chest or dresser's entire block footprint and its record, including
contents, in the same stroke. Undo/redo and cancelling the stroke restore or remove tiles and the record together.
Walls, wires/actuators and liquids are erased only when their own toggles are on. An Eraser without Blocks and
touching only a chest's protected supports do not delete the chest. Malformed footprints or overlapping entity
anchors are left protected.

## Brush and Erase

Painting works like an image editor's brush: a material is the colour, the Swatches panel is the palette, and the
map is the canvas. Code: `packages/world-model/src/brush.ts` (the edit model), `apps/web/src/world/brush-session.ts`
(the loaded world's rules, history and save point), `brush-materials.ts`, `brush-palettes.ts`,
`apps/web/src/shell/ToolOptions.tsx`, `apps/web/src/panels/SwatchesPanel.tsx` and the pointer handling in
`apps/web/src/components/MapCanvas.tsx`.

## Materials, paint and targets

Open a supported vanilla `.wld` and choose Brush (`B`) or Erase (`E`). Brush's target picks the layers a stroke writes:
Blocks, Walls or Both (both layers of a tile change together or not at all); Erase uses its own layer mask (above).

- **Materials** are every block that frames itself from its neighbours (the framing database's block types: dirt,
  stone, ores, sand, bricks, …) and every named wall, limited to the content ids the world's format defines. Objects
  and other frame-important tiles are not materials: they need their own placement rules (a later tool). The options
  bar shows each written layer's material as a swatch and name; clicking it opens the **Swatches** tab of the dock
  on that layer with the search field focused. The tab is always there, as an image editor's Swatches panel; choosing
  a swatch while Pan or Inspect is active switches to Brush. Alt+click on the map picks the block, wall and their paints under the
  pointer (an eyedropper).
- **Paint** is chosen per layer from the colour well next to the material (No paint, or one of the 30 paints) and is
  applied with the material, as a player paints a placed block. The **Place | Paint** switch picks the mode: Paint
  changes only the paint of what is there, like a paint roller, and places nothing; with No paint it removes paint.
- Placing a block puts it as the game places one: a full, unframed, active block without coatings, with the chosen
  paint, displacing any liquid. Over the same block only the paint changes (its shape and coatings stay). Placing a
  wall gives it the chosen paint and no coating. Erase removes the content with its paint, shape and coatings and
  keeps wires and actuators. Unknown and mod content is never changed.

## Keys

As image editors give their options keys: `B` Brush, `E` Erase, `[` `]` size, `X` swaps blocks and walls (`Shift+X`
both), `Shift+B` square or round, `S` Smooth edges, `R` Place or Paint, Alt+click eyedropper, Shift+click line,
`Escape` takes back a stroke in progress, `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo (also on the top bar). None of them
changes a stroke in progress. Every option's tooltip names its key; `?` lists them all.

## Footprint

Size is 1–64 tiles across (the slider, the number field, or `[` and `]`: one tile at a time up to 8, then in
steps of 2 and, from 24, of 4). Square or round: a round mask takes tile centres inside a disk with a quarter-tile
inset, so size 3 is a five-tile plus and size 5 has 21 tiles. The footprint is centred on the pointer's tile; even
sizes reach one more tile up and left. The outline (toggle with the target button) is drawn like an image editor's
brush outline: a white line on a dark halo along the footprint's edge, clipped at the world's edges.

Fast drags are interpolated between sampled tiles; consecutive stamps are at most one tile apart, so after the first
stamp only the footprint's leading edge is visited (one of nine precomputed edge lists). Shift+click draws a straight
line from where the last stroke ended.

**Smooth edges** (the hammer) shapes blocks as a player hammers the edge of a hill or a tunnel: every block a stroke
reaches and every block beside one (its exposure may have changed) gets its shape from its exposed sides, the sides
without ground (a block that can be hammered, or unknown/mod content, or the world's edge). Two exposed sides that
meet at a corner cut that corner (a slope); an exposed top and both sides make a one-tile bump a half block; anything
else becomes a full block again. So a painted square gets rounded corners, a diagonal line gets sloped steps and an
erased tunnel gets sloped walls. The shapes are part of the stroke's undo entry; entity footprints and blocks a hammer
cannot shape (ropes, chains, cobwebs, thorns, cactus, trees, bamboo, bubbles: a provisional list from play, to be
replaced by observing the game's hammer) are left alone, and the latter do not count as ground. Wall-only and
Paint-only strokes shape nothing. Shapes show in sprite mode; map colours draw whole tiles.

**Stabilizer** (Off to 100%) trails the pointer: the painting position trails the pointer in screen space with an
exponential time constant up to 400 ms and catches up while the pointer rests; releasing finishes the tail in the
same stroke. The outline follows the painting position.

## Strokes, history and saving

A stroke is one undo entry (`Ctrl+Z`, redo `Ctrl+Shift+Z`). History keeps only the numeric old and new plane values
of changed tiles, never world copies. Keyboard panning, Fit world and other navigation, a lost pointer, losing focus,
a second button (a held one then pans) and a second finger (which then pinches) end the stroke and keep it; only
`Escape` takes the stroke in progress back. The wheel zooms at the pointer, so the tile under it stays put and the
stroke goes on. Right- and middle-button drags pan with every tool.

Editing and history are locked while a world loads or the Save As dialog is open. Save (`Ctrl+S`) asks where to write
a verified copy, as Save As does; writing over the opened file is not offered yet. Opening another world or closing
this one with unsaved edits asks first (Discard changes, Save As…, or Cancel); a failed or cancelled open keeps the
world and its history.

## Protection

Only what the world keeps beside its tiles is protected, with both layers: chests and signs (their 2 × 2 body and one
tile around it), weighted pressure plates (one tile around), and tile entities (four tiles in every direction, since
their anchor orientation is unobserved: [entities.md](file-format/entities.md)). Their contents and text would lose
their tiles otherwise. Everything else may be painted over or erased, objects without such records included
(plants, torches, furniture), as a player can. Worlds with unknown content or undecoded entity sections cannot be
edited.

## Swatches and palettes

With Terraria assets connected and Sprites enabled, Blocks and Walls show sprite thumbnails instead of map colours.
Turning Sprites off restores colours across Swatches, Brush chips and Inspector without disconnecting assets.
Blocks use one 16 × 16 interior cell at position (0, 0), selected by the framing database with eight identical
neighbours; position-dependent types use the database's cell at that position. Walls consistently use the central 16 × 16
pixels of their interior cell, excluding the 8-pixel overhang. Paint remains a corner mark. Sprite thumbnails fill
the existing swatch squares; the grid's wall swatches keep the same shape as blocks.
Only visible swatches request thumbnails, in idle callbacks with a 250 ms timeout so an active map cannot starve
the work. Already cached material thumbnails appear immediately when changing categories or enabling Sprites,
without an observer or idle delay. The small pixel cache is shared with Brush chips and replaced when assets
reconnect or disconnect. Missing sheets and unavailable framing keep the map-colour
fallback, including the theme's checkerboard for missing map colours.

The Swatches tab lists Blocks, Walls or Paints as a grid of sprites or map colours (painted swatches with the paint
in a corner) or as a list of names, filtered by name or id. Its source is All materials, Recently used (the last 16
swatches painted with) or a custom palette. Custom palettes hold swatches, a material with its paint, and are kept in
the browser (`localStorage`):

- right-click any swatch: Add to "<palette>", or New palette with this swatch (inside a palette also Remove);
- `+` in the panel's toolbar: add the current materials (with their paints) to a palette, or start a new one;
- `⋯`: new palette from the current materials, rename, delete, export palettes to a JSON file, import one.

Arrow keys, Home and End move between swatches (the grid is one Tab stop); Delete removes the focused swatch from the
palette shown.

The remaining game check is to paint, undo part of the work, save a copy and open it in Terraria.
