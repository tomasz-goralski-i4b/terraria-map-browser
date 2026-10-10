# Brush and Erase

Painting works like an image editor's brush: a material is the colour, the Swatches panel is the palette, and the
map is the canvas. Code: `packages/world-model/src/brush.ts` (the edit model), `apps/web/src/world/brush-session.ts`
(the loaded world's rules, history and save point), `brush-materials.ts`, `brush-palettes.ts`,
`apps/web/src/shell/ToolOptions.tsx`, `apps/web/src/panels/SwatchesPanel.tsx` and the pointer handling in
`apps/web/src/components/MapCanvas.tsx`.

## Materials, paint and targets

Open a supported vanilla `.wld` and choose Brush (`B`) or Erase (`E`). The target picks the layers a stroke writes:
Blocks, Walls or Both (both layers of a tile change together or not at all).

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

With Terraria assets connected, Blocks and Walls show sprite thumbnails instead of map colours. Blocks use one
16 × 16 interior cell at position (0, 0), selected by the framing database with eight identical neighbours;
position-dependent types use the database's cell at that position. Walls consistently use the central 16 × 16
pixels of their interior cell, excluding the 8-pixel overhang. Paint remains a corner mark; walls stay round.
Only visible swatches request thumbnails, in idle callbacks. The small pixel cache is shared with Brush chips
and replaced when assets reconnect or disconnect. Missing sheets and unavailable framing keep the map-colour
fallback, including the theme's checkerboard for missing map colours.

The Swatches tab lists Blocks, Walls or Paints as a grid of map colours (walls round, painted swatches with the paint
in a corner) or as a list of names, filtered by name or id. Its source is All materials, Recently used (the last 16
swatches painted with) or a custom palette. Custom palettes hold swatches, a material with its paint, and are kept in
the browser (`localStorage`):

- right-click any swatch: Add to "<palette>", or New palette with this swatch (inside a palette also Remove);
- `+` in the panel's toolbar: add the current materials (with their paints) to a palette, or start a new one;
- `⋯`: new palette from the current materials, rename, delete, export palettes to a JSON file, import one.

Arrow keys, Home and End move between swatches (the grid is one Tab stop); Delete removes the focused swatch from the
palette shown.

The remaining game check is to paint, undo part of the work, save a copy and open it in Terraria.
