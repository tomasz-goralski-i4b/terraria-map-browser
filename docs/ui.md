# UI style guide

How the viewer is laid out and how new UI fits in. The viewer is the first stage of a **world editor**: painting blocks
and walls, changing tile state (slopes, paint, actuators, wires, liquids), placing and editing objects (chests, signs,
furniture, NPCs) and editing world properties. Read-only screens are designed so the editing workflow fits into them
without a redesign. The models are TEdit for Terraria and level and image editors such as Tiled, LDtk, Aseprite and
Photoshop.

Code: `apps/web/src/ui/` (primitives), `apps/web/src/shell/` (layout, commands, stores, the workbench),
`apps/web/src/panels/` (panel contents), `apps/web/src/styles.css` (tokens and all styling). The plan behind the
current shell is [planning/editor-ui-plan.md](planning/editor-ui-plan.md).

## Principles

1. **The map is the content.** The chrome is neutral grey and compact. Map colours are never used as UI colours, and
   UI colours never appear on the map. The map always gets most of the screen, and at least half of it on narrow
   screens.
2. **Functionality first, then looks.** Every value read from the save is reachable, every action has a keyboard
   path, and nothing is hidden behind a hover. Placeholders for future features stay visible but disabled, and they
   say why.
3. **One source per action.** Every user action is a `Command` in `shell/commands.ts`, with an id, label, group,
   shortcut, enabled rule and reason. The menu bar, tool rail, tooltips, shortcut help (`?`) and command palette
   (`Ctrl+K`) are all built from that list. Never wire a shortcut or a menu item by hand.
4. **Never block input.** Long work runs in a Worker or in slices between frames, and shows its progress *inside the
   panel* that needs it. There are no modal progress dialogs and no spinners over the map.
5. **No fake values.** A panel shows only what was decoded. If a field is not stored in this file's version, it gets
   no row, not a default value.
6. **No layout shift.** The stored layout is read before the first render. Status cells have fixed minimum widths and
   tabular numerals. Panels reserve their space instead of popping in.

## Layout (desktop, ≥ 1024 px)

```
┌ top bar: ▦ File Edit Select View World Assets Help ····· world name · file · size · format ····· assets ⌘K ? ▣ ┐
├ rail ┬ tool options: active tool · its settings ────────────────────────────────────────────────────┬────┤
│ Pan  │                                                       │ World Layers Swatches Library      │ ⊕  │
│ Insp │                       map                             │  (side bar: one panel in front)    │ ≡  │
│ Rulr │   (zoom controls, minimap; right-click quick menu;    │                                    │ ▤  │
│ ──── │    a size readout while a gesture changes it)         ├────────────────────────────────────┤ ▥  │
│ Sel◢ │                                                       │ Properties History Measurements    │ ·· │
│ Draw◢│                                                       │  (details)                         │ ⌕  │
│ … ◢  ├───────────────────────────────────────────────────────┴────────────────────────────────────┤ ≡  │
│      │ Search Content Entities Bookmarks Statistics   (bottom panel, folded at start: Ctrl+J)     │ …  │
├──────┴─────────────────────────────────────────────────────────────────────────────────────────────┴────┤
└ status: x, y │ depth │ tile │ chest ······· search · selection │ ⌁ Idle │ ⟲ Recovery off │ ⛨ Editable │ zoom ┘
```

The map and every panel live in one **workbench** (`shell/Workbench.tsx`, `shell/workbench-api.ts`), a dock layout
built on dockview; the **activity bar** at its right edge has one icon per panel. ◢ marks a tool family.

- **Top bar** (`shell/TopBar.tsx`) holds the menu bar, the open world's name, file, size and format (centred, as an
  editor's title), the assets button and the global actions. It holds nothing else. A dot next to the name marks
  unsaved changes (`unsavedChanges` in the app store, set by edit tools, cleared by a save or by opening another
  world); while it is set, reloading or closing the tab asks first with the browser's own "Leave site?" dialog.
- **Menu bar** (WAI-ARIA `menubar`, as in code and image editors), built from commands:
  - *File*: Open World… `Ctrl+O`, Open Folder…, **Worlds ▸** (the remembered folder's worlds, newest first, with size
    and age; the submenu flies out on hover or `→`), **Open Recent ▸**, Save… `Ctrl+S` (with unsaved edits; asks where to
    write a verified copy until saving over the opened file exists), Save As… `Ctrl+Shift+S`, **Import ▸** (Image as
    Pixel Art…, Schematic…), **Export ▸** (Map Image…, Selection as Schematic…), Recover Unsaved Work, Backups…, Close
    World (asks before dropping unsaved edits, as opening another world does).
  - *Select*: All `Ctrl+A`, Deselect `Ctrl+D`, Invert `Ctrl+I`, Expand to Complete Objects, Select Search Matches.
  - *View*: Fit world, Fit Selection, Actual size, Go To… `Ctrl+G`, Previous / Next View `Alt+←` / `Alt+→`, Isolate
    Layer, Show minimap (`N`), Show render stats, **Grid ▸**, **Theme ▸**, then **Panels ▸** (every panel, checked while
    shown, and Show bottom panel `Ctrl+J`), Show panels (`P`) and Reset layout.
  - *World*: Add Bookmark `Ctrl+B`, Statistics, Settings Presets….
  - *Edit*: Undo `Ctrl+Z`, Redo `Ctrl+Shift+Z` (Command on macOS); then Copy `Ctrl+C`, Paste `Ctrl+V`, Place paste
    `Enter` and Deselect / Cancel paste `Escape` for the Select tool; then Find… `Ctrl+F`, Next match `F3` and Previous
    match `Shift+F3` (see the Search section; `F3` also works while the search box has focus), Replace… `Ctrl+H`;
    Cut `Ctrl+X`, Duplicate `Ctrl+Shift+D`, **Transform ▸** (Flip, Rotate) and Keyboard
    Shortcuts…. Undo and Redo also sit on the top bar right after the
    menus, as in Krita and Photopea; the tool options bar holds only the tool's settings (on phones, where the top
    bar has no room, it carries Undo and Redo at its end).
  - *Assets*: Connect, Preview sprite sheets, Disconnect.
  - *Help*: Command palette, Keyboard shortcuts.

  `Alt` + the first letter opens a menu; `←` and `→` move between menus, also while one is open; pointing at another
  title while a menu is open switches to it. A disabled item shows why on its right, in a few words: a command that has
  its place before its feature exists says **Not available yet** (or **Planned for later** for catalog band B and
  later); its label already names it. On phones (< 640 px) the menus open from one **Menu** button, each as a submenu.
- **Tool rail** (`shell/ToolRail.tsx`) is a WAI-ARIA toolbar of **tool families** (`TOOL_FAMILIES` in
  `shell/commands.ts`) in three groups: *Navigate* (Pan `H`, Inspect `I`, Ruler `L`), *Edit* (Selection tools `M`,
  Drawing tools `B`, Shape tools `U`, Fill `G`, Erase `E`, Tile state tools `A`, Eyedropper `K`) and *Build* (Object
  tools `O`, Wiring and liquid tools `W`). A family of several tools shows its last tool, with a corner mark and
  `aria-haspopup="menu"`; right-click, a long press or `→` (`↓` on narrow screens) opens its other tools, each with its
  reason when it cannot be used. The family's key picks its last tool and, pressed again, steps through its available
  tools; a tool with its own key (Move `V`) keeps it. A family with nothing available yet opens its list on click.

  The rail is one Tab stop; the arrow keys move inside it. The active tool's family shows as pressed. Brush, Erase and
  Rectangle select need a supported vanilla world; the remaining tools say *Not available yet* or *Planned for later*.
- **Tool options bar** (`shell/ToolOptions.tsx`) shows the active tool's name and settings. Its material chips show
  sprites when assets are ready and Sprites is enabled, using the same interior thumbnails as the Swatches tab.
  Disconnecting assets or a missing sheet restores map colours; paint corners and accessible names are unchanged.
  Edit tools put their settings here: brush size and shape, and the layer mask, i.e. which of block, wall, paint,
  liquid and wires a stroke writes (as TEdit does). A tool never opens a dialog to change a setting. Brush shows,
  in the order of an image editor's options bar: each written layer's material (a swatch and name that opens
  the Swatches tab) with its paint
  well, Paint only, the Blocks / Walls / Both target, size (slider and number, 1–64; `[` `]`), square/round shape,
  Smooth edges (the hammer), the stabilizer (Off to 100%) and the outline toggle, then Undo/Redo from the shared
  command registry. Erase shows its own layer toggles (Blocks, Walls, Liquids, Wires; the same control as Select's Layers), then the size, shape, Smooth edges and the stabilizer. Select shows the
  selection mode (New, and Add / Subtract / Intersect, not available yet), the selection's X / Y / W / H in blocks
  (read-only until typing them exists; hidden from 1024 to 1279 px and on phones, where one row has no room), the Copy
  toggles (which layers Copy takes) and the Copy, Paste and Deselect buttons; while a paste floats, the anchor grid and its toggles
  (Skip empty blocks, Skip empty walls, Merge liquids) and Place paste / Cancel paste. On desktop the bar is one fixed row for
  every tool, so switching tools never moves the map. On narrow screens the
  fields wrap, materials first. See [editor.md](editor.md).
- **Map** (`components/MapView.tsx`, `MapCanvas.tsx`) holds the zoom controls (Fit world `F`, 1:1 `1`) in its top
  right corner. The minimap (`components/Minimap.tsx`, below the zoom controls) shows the
  whole world with the visible area while zoomed in: click to go there, drag the rectangle to pan, wheel to zoom; it
  marks spawn and the dungeon and redraws after edits. Transient messages (loading, errors) also go over the map. With no world it shows the **start screen** (`components/StartScreen.tsx`),
  as an editor's start page: Open World, Open Worlds Folder, Connect assets, the folder's worlds and the recent ones,
  where Terraria keeps worlds, and that files stay on this computer.
  The primary mouse button uses the active tool; right-button and middle-button drags pan with every tool, and so does
  the primary button while **Space** is held (outside text fields, buttons, menus and dialogs). A right click without a
  drag opens the **quick menu** at the pointer (`components/MapView.tsx`): the tool and tile under the pointer, the
  tool's frequent settings and actions (Brush: size, shape, Smooth edges, Pick materials here, Choose material…;
  Select: Cut, Copy, Paste, Deselect, All; Ruler: Delete measurement, Show measurements; otherwise Inspect this tile),
  then Undo / Redo and Fit world / Actual size. Every item is a command. While a gesture changes a size, a short
  **readout** at the bottom of the map shows it ("Brush 8 × 8", "30 × 18 blocks") and goes after a second.
  With Brush, Alt+click picks materials and Shift+click draws a line from the last stroke; Escape takes back a stroke
  in progress. The canvas suppresses the browser image context menu and outlines the clipped brush footprint.
- **Notifications** (`shell/Notifications.tsx`, `notify()` in `shell/notification-store.ts`) report finished
  background actions (a saved world, a listed folder) in the map's bottom-right corner, never over its middle.
  Successes close themselves after 6 s; errors stay until closed.
- **Workbench** (`shell/Workbench.tsx`): the map in the middle and the panels around it, in three areas by default:
  the **side bar** (World, Layers, Swatches, Library), the **details** under it (Properties, History, Measurements)
  and the **bottom panel** for wide tables (Search, Content, Entities, Bookmarks, Statistics), folded at start.
  Panels are dockview tabs: drag a tab to another group or to an edge to dock it there; its context menu moves it
  (to side bar / details / bottom panel: the keyboard path for docking), floats it, opens it in a new window, maximizes
  or closes it. A tab's ✕ is for the pointer (a focusable control inside `role="tab"` is invalid); from the keyboard a
  panel closes through the tab's menu.

  **One rule for showing panels** (`workbench-api.ts`), the same from the activity bar, View ▸ Panels and `Ctrl+J`:
  - a panel that is not in front comes to the front, unfolding its area if it was folded and reopening it next to the
    panels it last shared a group with if it was closed;
  - the panel already in front folds its whole area; the next click unfolds it with the same tabs and size;
  - a floating or popped-out panel only comes to the front;
  - dragging an area's edge past half its minimum (220 px wide, 120 px tall) **snaps it shut**, every group along that
    edge together; a strip along the workbench's edge (pointer only, as the edges are) pulls it out again at the dragged
    size, and an icon brings it back at the size it had before the drag;
  - `P` (Show panels) folds every area and later shows exactly the ones it folded, also after a reload.

  Edges between areas have an 8 px grab zone over the map's layer. An area never squeezes below its minimum. The
  arrangement, folded areas and the panel in front are stored with the layout; Reset layout restores the default.
  Dockview's layout announcements go to a polite status of the workbench (its own region would be `role="alert"`).

  Grid is also available in **View > Grid**: Off (default), 3, 5, 10, or Custom (2–1000 blocks). Custom opens
  the Grid section of the Layers panel and focuses its interval field; Enter or leaving the field commits a valid integer.
  Boundaries are counted from world (0, 0): dashed every block, solid at the selected interval, with a shared
  opacity slider (0–100%, initially 30%). Lines are 1 CSS pixel wide and light grey everywhere (a contrast switch
  would cut across the sky's gradient). Dashed block lines appear from 6 CSS pixels per tile; zoomed further out only the
  solid interval lines remain, while they are at least 8 CSS pixels apart (none over the far-out overview).
  Assets need not be connected.
  Spacing and opacity are remembered with the browser layout. The overlay does not intercept map input.
  The GPU grid shader replaces the final terrain framebuffer blit when enabled, preserving straight alpha.
  Terrain still uses cached-pan scissor strips; grid changes require no SVG, DOM geometry, tile/texture uploads
  or invalidation of the cached terrain.

  **Ruler** (`L`) is a local dimension overlay. Drag on block boundaries for a line; hold Shift during the drag
  for a rectangle, release Shift to return to the line, and release the pointer to keep the current shape.
  Rectangle also has an explicit option for touch input. Lines outline a one-block-thick raster path in white,
  with transparent interiors; horizontal and vertical paths count the boundary distance, diagonal paths count
  blocks along the dominant axis (a 3 × 4 path contains 4 blocks). A diagonal's label names both sizes: its straight length and
  the blocks on the path ("33.62 long · 29 blocks"), plus its angle to horizontal (one decimal).
  Labels can show dimensions, horizontal/vertical components, and angle. All measurements use blocks.

  **Measurements** is a panel of its own (details area). Picking the Ruler leaves the panels as they were; the options
  bar's *Show measurements* button (and the quick menu) shows the panel. Keep retains earlier notes; off replaces them on the next
  completed drag. Selecting a row or clicking a note on the map selects it; only the selected note shows
  handles: drag its endpoints/corners to resize or its body to move it. A finished note is not selected, so a drag
  that starts on another note (or its corner) draws a new one. Notes can be renamed, hidden, deleted or cleared; Escape cancels a
  drag. Undo/Redo while Ruler is active applies to measurements, independently of world edit history.
  Notes are remembered locally by world GUID and never enter the `.wld` writer or mark the world modified.
  Instanced WebGL outlines render after presenting cached terrain; geometry uploads only on note changes.
  Visible labels use positioned text nodes, with no React update for each camera frame.

  Inspector Block and Wall rows show vanilla map-colour swatches. With connected assets and Sprites enabled they
  show the pinned tile's actual framed cell: stored frames for objects, neighbours for self-framed blocks and walls.
  Missing sheets, unavailable framing or disabling Sprites keeps map colours; unknown content remains text only.
  Paint corners, copy text and accessible names remain unchanged.

- **Status bar** (`shell/StatusBar.tsx`) shows, from left to right:
  - the tile under the pointer;
  - its depth band;
  - its block, wall and liquid in one line;
  - background work (*Idle* until long work such as fill or export exists), recovery (*Recovery off* until recovery
    exists) and, with a world open, whether it can be edited (*Editable* / *View only*, with the reason in its tooltip);
    each cell has a fixed minimum width, and phones show their icons only;
  - render stats, when turned on from the menu;
  - the zoom (backing-store pixels per tile × 100 %). As in image editors, a click turns it into a field: type any
    percentage and press Enter (or leave the field) to zoom there around the centre of the view, clamped to the
    supported range (12.5 %–25 600 %, lower only to fit a large world); Escape keeps the zoom.

  While a search is being stepped through it shows the match's place, "3 of 120 matches" or "2 of 9 chests", left of
  the zoom. With editing it also shows the selection size, or the floating paste's (left of the zoom; in `--danger` above the
  Copy limit).

### Depth bands (status bar)

Bands use the world's stored levels (`world/depth.ts`):
- *underworld*: the bottom 200 rows, as on the map background;
- *caverns*: from `rockLevel` down;
- *underground*: from `surfaceLevel` down;
- *surface*: the lower two thirds of the rows above `surfaceLevel`;
- *sky*: the upper third.

The game names no exact boundary for the sky (Space) layer, so the one-third split is our own convention.

### Narrow screens (< 1024 px)

The tool rail becomes a row under the top bar (`aria-orientation="horizontal"`; the left and right arrows move in
it). The tool options bar stays, as a compact row under the rail, because edit tools need their settings there.
Panels open under the map, and the activity bar becomes a row under the workbench. The brand and the asset button are
hidden.

Below 640 px (phones), more is hidden:
- the command palette and help buttons, the app mark and the world's file details;
- these actions remain in the menus; submenus open under their item instead of flying out.

### Persisted layout

`shell/layout-store.ts` stores, per browser in `localStorage` (key `terraria-map-studio.layout.v1`):
- which panel sections are open, and which groups inside them;
- the workbench's arrangement (dockview's serialised layout: groups, sizes, folded areas, the panel in front, floating
  groups), whether Show panels hid the panels and which areas it hid;
- each table's column visibility and widths;
- the theme;
- whether the Inspector shows empty fields.

Every read and write is wrapped in `try/catch`, and every field is validated on its own. With storage blocked or
corrupt, the defaults apply and the app works for the visit. **Reset layout** restores the defaults
and removes the stored value (View ▸ Reset layout). The active tool, sorting and filters are not persisted.

## Panels

`PANELS` in `shell/workbench-api.ts` lists every panel with its title, icon, default area and the sections it shows (a
panel of one section shows its body under a visually hidden heading; several make an accordion).

| Panel (area) | Today | With editing |
|---|---|---|
| **World** (side) | Every decoded metadata field in collapsible groups: Identity, Size & layers, Generation, Time & weather, Progression, Bosses (checklist with a count badge), Invasions & NPCs, Spawn & landmarks (each with *Go to on the map*), Ores & backgrounds. | The same rows are editable fields (world properties editor). |
| **Layers** (side) | *Visibility*: eye rows: **Sprites** first (`Alt+1`; off until Terraria assets are connected), then background, walls, blocks and liquids (`Alt+2`…`Alt+5`), then paint (`Alt+6`: block and wall paint, in map colours and on sprites), plus wires and actuators (`Alt+7`) with one row per wire colour. A layer is a renderer uniform: toggling it never re-parses the world (see Map rendering for what it uploads). The Sprites row shows the assets' state on its right (not connected, the atlas build's progress, a warning for unreadable sheets) and its actions in an inline menu: connect, cancel, preview the sheets, change the folder, disconnect. A failed connect is a dismissable message over the map. Under the row, the open world's content that has no sprite (placed with a frame, no sheet in the atlas: drawn as a magenta checkerboard) is listed once. Then *Grid*. | Visibility *and* a lock per layer; a locked layer is never written by a tool. Isolate Layer (VIEW-02). |
| **Swatches** (side) | Materials, paints, recent swatches and custom palettes (`panels/SwatchesPanel.tsx`). | Favorites (MAT-01). |
| **Library** (side) | *Objects* and *Schematics*: what each will hold and its one action, disabled until it exists. | Object catalog (OBJ-01), schematic library (LIB-01). |
| **Properties** (details) | The fields of the tile's `tileAt` view. By default it is "shy" and shows only what the tile has. The **Show empty fields** eye (the same eye button as the Layers rows; persisted) lists every field in fixed rows, with "None" for absent ones. The Inspect tool pins a tile on click or `Enter`; `Esc` unpins it. Without a pin it shows nothing, except over a chest: hovering one previews it (header "Preview") until the pointer leaves it. | Edits the selected tile or object: frames, paint, slope, wires, chest items, sign text. |
| **History** (details) | What it will list, until one history of world edits exists. | FILE-02. |
| **Measurements** (details) | The Ruler's notes (see Ruler above). | — |
| **Search** (bottom) | One box for the whole world (`Ctrl+F`) and a scope: **Content** (blocks, walls and liquids by name or ID) or **Items in chests** (by item name or exact item ID); signs and NPCs are further scopes. Results list the matching entries with their totals (exact tile counts; item stacks with every prefix added up, chests counted once); choosing an entry narrows the results and the highlight to it, choosing it again widens them. Every match stays highlighted on the map until the search is cleared (`Esc` in the box or the clear button), also with the panel folded: content tiles in the renderer's highlight pass (outlined, the rest of the world dimmed while **Dim the rest** is on), chests as footprint outlines with fixed-size markers that survive the overview. `Enter` / `F3` and `Shift+Enter` / `Shift+F3` go to the next and previous match, wrapping: content in column-major order, one stop per vertical run of tiles (a 2 × 2 object is two stops), from a per-column index built in slices; chests in record order. A new scope is one entry in `SEARCH_SCOPES` (`world/search-store.ts`) and one results component. | Find & replace. |
| **Content** (bottom) | Tiles per block, wall and liquid with its map colour, in a sortable, filterable, virtualised table. `Enter`, a double-click or **Find on map** in the row's context menu runs the content search for that entry and goes to its first tile. | The material picker: selecting a row sets the brush content; `K` picks it from the map. |
| **Entities** (bottom) | Every decoded chest record: its name (an unnamed chest shows its object type, "Gold Chest"), position and filled slots; type, total items and the anchor issue are optional columns. A record without a valid map target (outside the world, no complete chest object at its position, a footprint shared with another record) keeps its row with a warning icon, but has no highlight and no click target. A click **selects**: the chest is outlined on the map and shown in Properties, and the camera stays. `Enter` or a double-click **goes to** it: the map moves there at once and zooms in to at least 16 CSS pixels per tile (a closer zoom is kept). The context menu (right-click, the Menu key or `Shift+F10`) offers Go to, **Open inventory** and Copy position. | Signs and NPCs in the same table pattern. |
| **Bookmarks**, **Statistics** (bottom) | What each will hold and its one action, disabled until it exists. | NAV-02, QA-01. |

Dialogs whose action is not connected yet (Replace, Import Image as Pixel Art, Export Map Image, Save Selection as
Schematic; `shell/PlannedDialogs.tsx`) open with their fields shown but disabled, short facts with icons, and the
primary button disabled with the reason.

**Chest inventory** (Open, from the Inspector or a chest list): every decoded slot in the game's ten-column rows,
gaps included; the arrows, `Home` and `End` move between slots, and a List view shows the filled slots as a table. The
window has a wooden chest frame and a detail line with the focused or hovered item's name, stack and numeric IDs.
Item and prefix names come from the generated English catalog; inventory sprites are cropped from the connected
local atlas with the observed texture aliases and first-frame rectangles, and without them a slot shows the item's
name. No item textures are shipped.

The World rows now edit the decoded properties in place: checkboxes for flags, finite selectors for variants,
native date/time controls, numeric/text inputs and individual list entries with Add/Remove. See
[world-properties.md](world-properties.md) for validation, commit behavior, finite domains and canvas resizing.

### Wire overlay

The overlay is drawn over all other layers, at one colour per tile. Wires are drawn in the game's order (yellow over
green over blue over red); actuators show only on tiles with no visible wire. The overlay is blended at 75 % over
opaque tiles, using the same integer expression on the GPU and in the CPU reference (`WIRE_COLORS`, `WIRE_ALPHA` in
`packages/renderer`). These colours belong to the overlay, not to the map palette.

### Map rendering

- **Zoomed out** (below half a pixel per tile for every vanilla size) the map is the overview: one mipmapped texture
  in which every texel is the mean of 2 × 2 tiles, all layers composited.
- **From half a pixel per tile up to one** each pixel is the mean of the tiles under it, weighted by covered area. Just
  above the overview threshold that is the same mean the overview shows, so zooming across it does not visibly sharpen
  the map, and panning does not shimmer.
- **From one pixel per tile** each pixel is exactly one tile.

What a layer toggle costs:
- At half a pixel per tile and above, or whenever the chunks around the view are cached: no upload at all.
- Zoomed out on a world larger than the chunk cache (Medium, Large and larger custom worlds): the new view sweeps
  out from the centre of the screen, re-uploading evicted chunks within each frame's time budget. Chunks are uploaded
  straight from the world's planes with no per-tile JavaScript. Measured on an Intel Arc GPU: a 16400 × 4800 modded
  world takes about 60 frames, 1 s (3.5 s before #203); smaller worlds proportionally less. Areas the sweep has not
  reached keep their old colours: the map never blanks, and the update always grows from the centre as one region.
- Never a re-parse.

## Theme and tokens

- Dark by default. When the system prefers light (`prefers-color-scheme`), the light theme applies. View ▸ Theme can
  force either theme (`data-theme` on `<html>`).
- Colours are CSS custom properties defined in `styles.css` and nowhere else:
  - surfaces: `--surface-0` (behind the map) through `--surface-3` (hover);
  - text: `--text-1` through `--text-3`;
  - accent: `--accent` (fills with white text), `--accent-text` (accent as text or icon), `--accent-soft`
    (selection and pressed backgrounds);
  - `--danger` (text) and `--danger-fill` (a destructive button, e.g. Replace), `--success`, `--focus`, `--border`
    and `--border-strong`.

  There is **one accent** colour. A component never contains a colour literal.
- Text contrast meets WCAG AA in both themes. The axe check in `editor-shell.browser.test.tsx` runs in both.

## Typography and density

- System UI font, 13 px for panels, 12 px for tables and the status bar.
- Tabular numerals (`font-variant-numeric: tabular-nums`) for coordinates, counts and every number that changes
  while you watch.
- 4 px spacing scale (`--space-1..4` = 4, 8, 12, 16 px).
- Row height 24 px in tables, 26 px in property grids and menus.
- Section headers are 11 px uppercase with letter spacing. Group headers are 13 px semibold.

## Components (`apps/web/src/ui/`)

Panels compose these primitives, with no ad-hoc styling:

| Primitive | Pattern |
|---|---|
| `Icon` | One inline SVG set: 16 px, 1.5 px stroke, `currentColor`, `aria-hidden`. Add an icon to `PATHS`; never import icon packs. |
| `IconButton` | Icon-only button. The label is its accessible name and tooltip, `aria-keyshortcuts` carries the shortcut, and `aria-pressed` marks toggles. A disabled button uses `aria-disabled` so it stays focusable and its tooltip can say why. |
| `Section` | WAI-ARIA accordion item: a heading button with `aria-expanded` controls a labelled region. A collapsed body is not rendered, so it costs nothing. |
| `PropertyGrid` | Label and value rows (`<dl>`). Text values copy on click, announced in a polite live region. Flags read Yes or No with a check or a cross. |
| `Table` | Virtualised ARIA grid with sortable headers (`aria-sort`; ascending → descending → none), a text filter, extra filters, a column menu (show and hide; `defaultHidden` columns start hidden), a sticky header and keyboard row selection (arrows, Page Up/Down, Home, End, Enter). Columns resize by dragging, or with the arrow keys on the handle, starting from the width shown. The first column takes the space left over until the user sizes it. Column layout is persisted per table id. With `onContextMenu`, right-click, the Menu key or `Shift+F10` selects a row and opens its menu; a selection made elsewhere (F3) scrolls into view. `fitRows` shrinks the body to its rows, for short result lists. |
| `Toggle`, `VisibilityRow` | Switch (`role="switch"`); the eye-icon row of layer lists. |
| `Splitter` | Focusable `separator` with `aria-valuenow`, `aria-valuemin` and `aria-valuemax`. |
| `MenuBar`, `MenuButton`, `MenuList` | WAI-ARIA menubar and menu button over one menu list: the arrows, Home, End and Escape work, and focus returns to the trigger. Items are actions (with an icon, a shortcut or a muted detail), checkboxes, headings or submenus; a submenu opens on hover, `Enter` or `→` and closes with `←` or `Escape`. Hover moves focus, so the pointer and the keyboard show one highlight. |
| `ContextMenu` | A `MenuList` at a viewport point, measured and kept inside the window; it closes on a pointer down outside, on scroll or resize and on Escape, and focus returns to where it was. |

Tooltips are CSS (`data-tooltip` and `data-tooltip-side`), shown on hover and on keyboard focus after a short delay.
They cost no layout and need no portal.

## Behaviour

- **Keyboard:** every action has a keyboard path, and shortcuts are listed in `?` and in tooltips. Single-key
  shortcuts work anywhere except in text fields, open menus and dialogs. On the focused map, the arrow keys pan and
  `+` and `−` zoom. `Ctrl` shortcuts also accept `⌘`.
- **Focus** is always visible (`:focus-visible`, a 2 px `--focus` outline). Dialogs are native `<dialog>` elements
  opened modal, which trap focus and restore focus when closed. They close on Escape, on a click on the backdrop, or
  with a visible close button, so touch users can always leave them.
- **ARIA:** menubar and menu (menus, tool families, the quick menu), tabs (panel tabs, by dockview), accordion
  (sections), grid (tables), toolbar (tool rail), switch (toggles), dialog, and combobox with listbox (command palette).
  Landmarks: `banner` (top bar), `navigation` (tools; *Panels*: the activity bar), `main` (map), a `region` per panel
  group named after its panel in front, `contentinfo` (status bar). Region names are unique: the map's group is
  "World map", the section inside Layers is "Visibility".
- **Motion:** `prefers-reduced-motion` turns off transitions and animations; the camera has its own handling (#139).
- **Long work:** counts and decoding run in a Worker or in slices between frames, with progress shown in the panel.

## What not to do

Every item here shipped once in a pull request (the first version of #233) and was rewritten because it made the app
look unfinished or less trustworthy. Desktop editors (VS Code, Photoshop, Aseprite) are the reference: if none of
them would do it, neither do we.

| Don't | Do instead |
|---|---|
| Two commands for one action: *Export world…* next to *Save world copy…*. | One command, **Save As…**; variants (Download, Replace) are choices inside its dialog. |
| Invent the file name and write it without asking (`<name>.copy.wld`). | The user names the file in the dialog. Suggest a free name, preselect it without `.wld`, show the folder it goes to. |
| Ask for more access than the action needs: open a folder `readwrite` just to list it. | Open and list read-only. Ask for write access on the click that writes (Save), never earlier. |
| Put a modal with a paragraph and *Don't show again* in front of a system dialog. | Put guidance where people already look: the start screen, an empty submenu, a disabled item's reason. A click on a command does the command. |
| A dead-end list: a picked folder shown once in a modal of file-name buttons, forgotten on close or reload. | Remembered sources live in the menus (File ▸ Worlds flies out on hover) and on the start screen, and survive a reload (IndexedDB). |
| A result banner over the middle of the map, with a link styled as a button and a close icon. | Finished background work → a notification in the map's bottom-right corner. A failure of a dialog's action → inside that dialog, next to the button that failed. |
| Top-bar buttons for file actions (*Open .wld world*, *Open folder…*), two of them with the same icon. | File actions belong to the File menu, with `Ctrl` shortcuts. The top bar holds the menu bar, the title and global toggles only. One icon means one thing (`file` ≠ `folder`). |
| One-off CSS classes for a single dialog (`.folder-hint-body`, `.world-folder-list`) and `<a class="button">`. | Compose the primitives: `MenuBar`/`MenuList`, `IconButton`, `.dialog-header` / form body / `.dialog-footer`, `notify()`. A link is a link; an action is a `<button>`. |
| Walls of text and monospace prose in dialogs. | At most three short lines of facts, each with an icon (*Encoded and read back before anything is written*). Monospace only for paths and values. |
| Promise safety without proving it, or write silently. | Say what will happen before (name, folder, format) and what happened after (*Saved X.wld · 2.7 MiB in “Worlds” · verified*). Only verified bytes reach the disk. |
| Long disabled reasons that push the item's label out of the menu. | Short reasons (*Open a world first*); the label never truncates, the reason does. |
| Ship UI checked only by tests. | Look at it: run the preview, open every new menu, dialog and empty state at desktop and phone width, in both themes, before asking for review. |

## Adding UI

- **A new action:** add a `Command`. It then appears in the menu, the palette and `?`.
- **A new panel:** add its section ids to `SECTION_IDS` (and `SECTION_TITLES`), their bodies to `SECTIONS` in
  `shell/Workbench.tsx`, and the panel to `PANELS` (title, icon, area). It then has an activity-bar icon, a View ▸ Panels
  item and a place in the default arrangement.
- **A feature that is not connected yet:** give it its place now (a tool in `TOOLS` with `available: false`, a
  `planned()` command, a dialog shell or a panel section) so it says *Not available yet* where it will be.
- **A new list:** use `Table`.
- **New dependencies:** prefer none. Virtualisation, splitters, menus and tooltips are written in-house. If a UI
  dependency is unavoidable, record it with its reason in `docs/tooling.md`.

## Shortcuts

One table for every key, so a new command takes a free one. Single keys work outside text fields, menus and dialogs.

| Key | Command | Key | Command |
|---|---|---|---|
| `H` `I` `L` | Pan, Inspect, Ruler | `Ctrl+O` `Ctrl+S` `Ctrl+Shift+S` | Open World, Save, Save As |
| `M` (`V`) | Selection tools (Move) | `Ctrl+Z` `Ctrl+Shift+Z` | Undo, Redo |
| `B` `U` `G` `E` | Drawing, Shape, Fill, Erase | `Ctrl+X` `Ctrl+C` `Ctrl+V` `Ctrl+Shift+D` | Cut, Copy, Paste, Duplicate |
| `A` `K` | Tile state, Eyedropper | `Ctrl+A` `Ctrl+D` `Ctrl+I` | Select all, Deselect, Invert |
| `O` `W` | Object, Wiring and liquid tools | `Ctrl+F` `F3` `Shift+F3` `Ctrl+H` | Find, next, previous, Replace |
| `[` `]` `Shift+B` `X` `Shift+X` `S` `R` | Brush size, shape, target, Smooth edges, Place/Paint | `Ctrl+G` `Alt+←` `Alt+→` | Go to, previous / next view |
| `F` `1` `N` | Fit world, Actual size, minimap | `Ctrl+B` | Add bookmark |
| `P` | Show panels | `Ctrl+K` `?` | Command palette, shortcuts |
| `Alt+1` … `Alt+7` | Layer visibility | `Enter` `Escape` `Delete` | Place paste, cancel / deselect / unpin, delete measurement (by context) |
| `Space` (held) | Pan with the primary button | `Ctrl+J` | Show bottom panel |

Shift held during a Ruler drag draws a rectangle, as agreed. `Ctrl+J` is the bottom panel, as in code editors, so
Duplicate takes `Ctrl+Shift+D`.
