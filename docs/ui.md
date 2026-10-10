# UI style guide

How the viewer is laid out and how new UI fits in. The viewer is the first stage of a **world editor**: painting blocks
and walls, changing tile state (slopes, paint, actuators, wires, liquids), placing and editing objects (chests, signs,
furniture, NPCs) and editing world properties. Read-only screens are designed so the editing workflow fits into them
without a redesign. The models are TEdit for Terraria and level and image editors such as Tiled, LDtk, Aseprite and
Photoshop.

Code: `apps/web/src/ui/` (primitives), `apps/web/src/shell/` (layout, commands, stores),
`apps/web/src/panels/` (dock contents), `apps/web/src/styles.css` (tokens and all styling).

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
┌ top bar: ▦ File View Assets Help ·········· world name · file · size · format ········ assets ⌘K ? ▣ ┐
├ rail ┬ tool options: active tool · its settings ──────────────────────────────────────────────────────┤
│ Pan  │                                                               ┊ [World] [View] [Swatches] (dock) │
│ Insp │                       map canvas                              ┊ WORLD    (World tab)            │
│ ──── │      (zoom controls top right; minimap; loading and errors;   ┊ CONTENT                         │
│ Brush│       with no world: the start screen)                        ┊ ENTITIES                        │
│ Erase│                                                               ┊   — or —                        │
│ Fill │                                                               ┊ LAYERS   (View tab)             │
│ Sel. │                                                               ┊                                 │
│ Pick │                                          notifications ┐      ┊─────────────────────────────────┤
│ ──── │                                                        ┘      ┊ INSPECTOR (under either tab)    │
│ Obj. │                                                               ┊ (splitter ┊ resizes)            │
├──────┴───────────────────────────────────────────────────────────────┴─────────────────────────────────┤
└ status: x, y │ depth │ block · wall · liquid under cursor │                (render stats) │ zoom % ───────┘
```

- **Top bar** (`shell/TopBar.tsx`) holds the menu bar, the open world's name, file, size and format (centred, as an
  editor's title), the assets button and the global actions. It holds nothing else. A dot next to the name marks
  unsaved changes (`unsavedChanges` in the app store, set by edit tools, cleared by a save or by opening another
  world); while it is set, reloading or closing the tab asks first with the browser's own "Leave site?" dialog.
- **Menu bar** (WAI-ARIA `menubar`, as in code and image editors), built from commands:
  - *File*: Open World… `Ctrl+O`, Open Folder…, **Worlds ▸** (the remembered folder's worlds, newest first, with size
    and age; the submenu flies out on hover or `→`), **Open Recent ▸**, Save… `Ctrl+S` (with unsaved edits; asks where to
    write a verified copy until saving over the opened file exists), Save As… `Ctrl+Shift+S`, Close World (asks
    before dropping unsaved edits, as opening another world does).
  - *View*: Show panels, Fit world, Actual size, Show render stats, **Theme ▸**, Reset layout.
  - *Edit*: Undo `Ctrl+Z`, Redo `Ctrl+Shift+Z` (Command on macOS). They also sit on the top bar right after the
    menus, as in Krita and Photopea; the tool options bar holds only the tool's settings (on phones, where the top
    bar has no room, it carries Undo and Redo at its end).
  - *Assets*: Connect, Preview sprite sheets, Disconnect.
  - *Help*: Command palette, Keyboard shortcuts.

  `Alt` + the first letter opens a menu; `←` and `→` move between menus, also while one is open; pointing at another
  title while a menu is open switches to it. A disabled item shows why on its right.
- **Tool rail** (`shell/ToolRail.tsx`) is a WAI-ARIA toolbar in three groups:
  - *Navigate*: Pan `H`, Inspect `I`.
  - *Edit*: Brush `B`, Erase `E`, Fill `G`, Select `M`, Pick content `K`.
  - *Objects*: Place object `O`.

  The rail is one Tab stop; the arrow keys move inside it. The active tool shows as pressed. Brush and Erase
  are available for supported vanilla worlds; the remaining edit tools show their unavailable reason.
- **Tool options bar** (`shell/ToolOptions.tsx`) shows the active tool's name and settings. Its material chips show
  sprites when assets are ready, using the same interior thumbnails as the Swatches tab.
  Disconnecting assets or a missing sheet restores map colours; paint corners and accessible names are unchanged.
  Edit tools put their settings here: brush size and shape, and the layer mask, i.e. which of block, wall, paint,
  liquid and wires a stroke
  writes (as TEdit does). A tool never opens a dialog to change a setting. Brush shows, in the order of an image
  editor's options bar: each written layer's material (a swatch and name that opens the Swatches tab) with its paint
  well, Paint only, the Blocks / Walls / Both target, size (slider and number, 1–64; `[` `]`), square/round shape,
  Smooth edges (the hammer), the stabilizer (Off to 100%) and the outline toggle, then Undo/Redo from the shared
  command registry. Erase keeps the target, size, shape, Smooth edges and the stabilizer. On narrow screens the
  fields wrap, materials first. See [editor.md](editor.md).
- **Map** (`components/MapView.tsx`, `MapCanvas.tsx`) holds the zoom controls (Fit world `F`, 1:1 `1`) in its top
  right corner. The minimap (#145) and transient messages (loading, errors) also go over the map. With no world it shows the **start screen** (`components/StartScreen.tsx`),
  as an editor's start page: Open World, Open Worlds Folder, Connect assets, the folder's worlds and the recent ones,
  where Terraria keeps worlds, and that files stay on this computer.
  The primary mouse button uses the active tool; right-button and middle-button drags pan with every tool.
  With Brush, Alt+click picks materials and Shift+click draws a line from the last stroke; Escape takes back a stroke
  in progress. The canvas suppresses the browser image context menu and outlines the clipped brush footprint.
- **Notifications** (`shell/Notifications.tsx`, `notify()` in `shell/notification-store.ts`) report finished
  background actions (a saved world, a listed folder) in the map's bottom-right corner, never over its middle.
  Successes close themselves after 6 s; errors stay until closed.
- **Dock** (`shell/Dock.tsx`) has three tabs, as in image editors (#225): **World**, what the world *is* (World
  properties, Content, Entities), **View**, what is *shown* (Layers), and **Swatches**, what the brush *paints with*
  (`panels/SwatchesPanel.tsx`: materials, paints, recent swatches and custom palettes). The **Inspector** sits under
  the tabs and is visible with any; open, it takes up to half the dock. World is the default tab: after opening a world it shows
  what was opened. Inside a tab, sections are an accordion; several may be open at once. A splitter resizes the dock
  (240–640 px; drag it, or use the arrow keys, Shift for bigger steps, Home and End); a second one, on the open
  Inspector's top edge, trades height between it and the tabs (↑ ↓ from the keyboard), and the height is remembered
  with the layout. `P` hides or shows the whole dock.

  Inspector Block and Wall rows show vanilla map-colour swatches. With connected assets they show the pinned tile's
  actual framed cell: stored frames for objects, neighbours for self-framed blocks and walls. Missing sheets or
  unavailable framing keep map colours; unknown content remains text only. Paint corners, round wall swatches,
  copy text and accessible names remain unchanged.

  `Tab` is **not** used for this, unlike some editors: Tab must keep moving focus for keyboard users.
- **Status bar** (`shell/StatusBar.tsx`) shows, from left to right:
  - the tile under the pointer;
  - its depth band;
  - its block, wall and liquid in one line;
  - render stats, when turned on from the menu;
  - the zoom (backing-store pixels per tile × 100 %). As in image editors, a click turns it into a field: type any
    percentage and press Enter (or leave the field) to zoom there around the centre of the view, clamped to the
    supported range (12.5 %–25 600 %, lower only to fit a large world); Escape keeps the zoom.

  With editing it also shows the selection size and the brush footprint.

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
it). The tool options bar stays, as a compact row under the rail, because edit tools need their settings there. The
dock becomes a bottom sheet under the map, at most 40 % of the height, and the map keeps at least half of the screen.
The brand and the asset button are hidden.

Below 640 px (phones), more is hidden:
- the command palette and help buttons, the app mark and the world's file details;
- these actions remain in the menus; submenus open under their item instead of flying out.

### Persisted layout

`shell/layout-store.ts` stores, per browser in `localStorage` (key `terraria-map-studio.layout.v1`):
- which dock sections are open, and which groups inside them;
- the dock width, its tab and whether the dock is hidden;
- each table's column visibility and widths;
- the theme;
- whether the Inspector shows empty fields.

Every read and write is wrapped in `try/catch`, and every field is validated on its own. With storage blocked or
corrupt, the defaults apply and the app works for the visit. **Reset layout** restores the defaults
and removes the stored value (View ▸ Reset layout). The active tool, sorting and filters are not persisted.

## Dock sections

| Section | Today | With editing |
|---|---|---|
| **World** | Every decoded metadata field in collapsible groups: Identity, Size & layers, Generation, Time & weather, Progression, Bosses (checklist with a count badge), Invasions & NPCs, Spawn & landmarks (each with *Go to on the map*), Ores & backgrounds. | The same rows become editable fields (world properties editor). |
| **Layers** | Eye rows: **Sprites** first (`Alt+1`; off until Terraria assets are connected), then background, walls, blocks and liquids (`Alt+2`…`Alt+5`), plus wires and actuators (`Alt+6`) with one row per wire colour. A layer is a renderer uniform: toggling it never re-parses the world (see Map rendering for what it uploads). The Sprites row shows the assets' state on its right (not connected, the atlas build's progress, a warning for unreadable sheets) and its actions in an inline menu: connect, cancel, preview the sheets, change the folder, disconnect. A failed connect is a dismissable message over the map. Under the row, the open world's content that has no sprite (placed with a frame, no sheet in the atlas: drawn as a magenta checkerboard) is listed once. | Visibility *and* a lock per layer; a locked layer is never written by a tool. |
| **Inspector** | The fields of the tile's `tileAt` view. By default it is "shy" and shows only what the tile has. The **Show empty fields** eye (the same eye button as the Layers rows; persisted) lists every field in fixed rows, with "None" for absent ones. The Inspect tool pins a tile on click or `Enter`; `Esc` unpins it. Without a pin, the Inspector previews the hovered tile. | Edits the selected tile or object: frames, paint, slope, wires, chest items, sign text. |
| **Content** | Tiles per block, wall and liquid with its map colour, in a sortable, filterable, virtualised table. | The material picker: selecting a row sets the brush content; `K` picks it from the map. |
| **Entities** | A slot (chests, signs, NPCs once decoded). | The same table pattern; selecting a row centres the map on it. |

A future **History** section (undo stack, `Ctrl+Z` / `Ctrl+Shift+Z`) goes under Inspector.

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
| `Table` | Virtualised ARIA grid with sortable headers (`aria-sort`; ascending → descending → none), a text filter, extra filters, a column menu (show and hide; `defaultHidden` columns start hidden), a sticky header and keyboard row selection (arrows, Page Up/Down, Home, End, Enter). Columns resize by dragging, or with the arrow keys on the handle, starting from the width shown. The first column takes the space left over until the user sizes it. Column layout is persisted per table id. |
| `Toggle`, `VisibilityRow` | Switch (`role="switch"`); the eye-icon row of layer lists. |
| `Splitter` | Focusable `separator` with `aria-valuenow`, `aria-valuemin` and `aria-valuemax`. |
| `MenuBar`, `MenuButton`, `MenuList` | WAI-ARIA menubar and menu button over one menu list: the arrows, Home, End and Escape work, and focus returns to the trigger. Items are actions (with an icon, a shortcut or a muted detail), checkboxes, headings or submenus; a submenu opens on hover, `Enter` or `→` and closes with `←` or `Escape`. Hover moves focus, so the pointer and the keyboard show one highlight. |

Tooltips are CSS (`data-tooltip` and `data-tooltip-side`), shown on hover and on keyboard focus after a short delay.
They cost no layout and need no portal.

## Behaviour

- **Keyboard:** every action has a keyboard path, and shortcuts are listed in `?` and in tooltips. Single-key
  shortcuts work anywhere except in text fields, open menus and dialogs. On the focused map, the arrow keys pan and
  `+` and `−` zoom. `Ctrl` shortcuts also accept `⌘`.
- **Focus** is always visible (`:focus-visible`, a 2 px `--focus` outline). Dialogs are native `<dialog>` elements
  opened modal, which trap focus and restore focus when closed. They close on Escape, on a click on the backdrop, or
  with a visible close button, so touch users can always leave them.
- **ARIA:** menubar and menu (menus), tabs (dock), accordion (sections), grid (tables), toolbar (tool rail), switch
  (toggles), dialog, and combobox with listbox (command palette). Landmarks: `banner` (top bar), `navigation` (tools), `main` (map),
  `complementary` (dock), `contentinfo` (status bar).
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
- **A new panel:** add a section id to `SECTION_IDS` and its tab to `SECTION_TAB`, then add its body to `Dock.tsx`.
- **A new list:** use `Table`.
- **New dependencies:** prefer none. Virtualisation, splitters, menus and tooltips are written in-house. If a UI
  dependency is unavoidable, record it with its reason in `docs/tooling.md`.
