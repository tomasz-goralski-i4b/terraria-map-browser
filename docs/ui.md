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
   shortcut, enabled rule and reason. The app menu, tool rail, tooltips, shortcut help (`?`) and command palette
   (`Ctrl+K`) are all built from that list. Never wire a shortcut or a menu item by hand.
4. **Never block input.** Long work runs in a Worker or in slices between frames, and shows its progress *inside the
   panel* that needs it. There are no modal progress dialogs and no spinners over the map.
5. **No fake values.** A panel shows only what was decoded. If a field is not stored in this file's version, it gets
   no row, not a default value.
6. **No layout shift.** The stored layout is read before the first render. Status cells have fixed minimum widths and
   tabular numerals. Panels reserve their space instead of popping in.

## Layout (desktop, ≥ 1024 px)

```
┌ top bar: ☰ app menu · Terraria Map Studio · world name, file, size · Open · assets · ⌘K ◐ ? ▣ ┐
├ rail ┬ tool options: active tool · its settings ─────────────────────────────────────────────┤
│ Pan  │                                                               ┊ WORLD          (dock) │
│ Insp │                       map canvas                              ┊ LAYERS                 │
│ ──── │            (zoom controls top right; minimap, messages)       ┊ INSPECTOR              │
│ Brush│                                                               ┊ CONTENT                │
│ Erase│                                                               ┊ ENTITIES               │
│ Fill │                                                               ┊                        │
│ Sel. │                                                               ┊ (splitter ┊ resizes)   │
│ Pick │                                                               ┊                        │
│ ──── │                                                               ┊                        │
│ Obj. │                                                               ┊                        │
├──────┴───────────────────────────────────────────────────────────────┴────────────────────────┤
└ status: x, y │ depth │ block · wall · liquid under cursor │          (render stats) │ zoom % ─┘
```

- **Top bar** (`shell/TopBar.tsx`) holds the app menu (Open, Recent worlds, Export, Connect assets, view toggles,
  Reset layout, help), the world's name, file name and size, and the global actions. It holds nothing else. With
  editing it gains an unsaved-changes dot next to the name and Save / Save as next to Open.
- **Tool rail** (`shell/ToolRail.tsx`) is a WAI-ARIA toolbar in three groups:
  - *Navigate*: Pan `H`, Inspect `I`.
  - *Edit*: Brush `B`, Erase `E`, Fill `G`, Select `M`, Pick content `K`.
  - *Objects*: Place object `O`.

  The rail is one Tab stop; the arrow keys move inside it. The active tool shows as pressed. Edit tools are
  disabled until editing exists.
- **Tool options bar** (`shell/ToolOptions.tsx`) shows the active tool's name and settings. Edit tools put their
  settings here: brush size and shape, and the layer mask, i.e. which of block, wall, paint, liquid and wires a stroke
  writes (as TEdit does). A tool never opens a dialog to change a setting.
- **Map** (`components/MapView.tsx`, `MapCanvas.tsx`) holds the zoom controls (Fit world `F`, 1:1 `1`) in its top
  right corner. The minimap (#145) and transient messages (loading, errors) also go over the map; nothing else does.
- **Dock** (`shell/Dock.tsx`) is an accordion of panel sections. Several sections may be open at once. A splitter
  resizes the dock (240–640 px; drag it, or use the arrow keys, Shift for bigger steps, Home and End). `P` hides or
  shows the whole dock.

  `Tab` is **not** used for this, unlike some editors: Tab must keep moving focus for keyboard users.
- **Status bar** (`shell/StatusBar.tsx`) shows, from left to right:
  - the tile under the pointer;
  - its depth band;
  - its block, wall and liquid in one line;
  - render stats, when turned on from the menu;
  - the zoom (backing-store pixels per tile × 100 %).

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

The tool rail becomes a row under the top bar, and the dock becomes a bottom sheet (at most 40 % of the height)
under the map. The map keeps at least half of the screen. The tool options bar, the brand and the secondary top bar
buttons are hidden; the commands stay reachable from the app menu and `Ctrl+K`.

### Persisted layout

`shell/layout-store.ts` stores, per browser in `localStorage` (key `terraria-map-studio.layout.v1`):
- which dock sections are open, and which groups inside them;
- the dock width and whether the dock is hidden;
- each table's column visibility and widths;
- the theme.

Every read and write is wrapped in `try/catch`, and every field is validated on its own. With storage blocked or
corrupt, the defaults apply and the app works for the visit. **Reset layout** in the app menu restores the defaults
and removes the stored value. The active tool, sorting and filters are not persisted.

## Dock sections

| Section | Today | With editing |
|---|---|---|
| **World** | Every decoded metadata field in collapsible groups: Identity, Size & layers, Generation, Time & weather, Progression, Bosses (checklist with a count badge), Invasions & NPCs, Spawn & landmarks (each with *Go to on the map*), Ores & backgrounds. | The same rows become editable fields (world properties editor). |
| **Layers** | The eye-icon row pattern, disabled (#88 wires the toggles). | Visibility *and* a lock per layer; a locked layer is never written by a tool. |
| **Inspector** | A slot (#88: the pinned tile from the Inspect tool). | Edits the selected tile or object: frames, paint, slope, wires, chest items, sign text. |
| **Content** | Tiles per block, wall and liquid with its map colour, in a sortable, filterable, virtualised table. | The material picker: selecting a row sets the brush content; `K` picks it from the map. |
| **Entities** | A slot (chests, signs, NPCs once decoded). | The same table pattern; selecting a row centres the map on it. |

A future **History** section (undo stack, `Ctrl+Z` / `Ctrl+Shift+Z`) goes under Inspector.

## Theme and tokens

- Dark by default. When the system prefers light (`prefers-color-scheme`), the light theme applies. The theme menu in
  the top bar can force either theme (`data-theme` on `<html>`).
- Colours are CSS custom properties defined in `styles.css` and nowhere else:
  - surfaces: `--surface-0` (behind the map) through `--surface-3` (hover);
  - text: `--text-1` through `--text-3`;
  - accent: `--accent` (fills with white text), `--accent-text` (accent as text or icon), `--accent-soft`
    (selection and pressed backgrounds);
  - `--danger`, `--focus`, `--border` and `--border-strong`.

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
| `Table` | Virtualised ARIA grid with sortable headers (`aria-sort`; ascending → descending → none), a text filter, extra filters, a column menu (show and hide), resizable columns (drag, or the arrow keys on the handle), a sticky header and keyboard row selection (arrows, Page Up/Down, Home, End, Enter). Column layout is persisted per table id. |
| `Toggle`, `VisibilityRow` | Switch (`role="switch"`); the eye-icon row of layer lists. |
| `Splitter` | Focusable `separator` with `aria-valuenow`, `aria-valuemin` and `aria-valuemax`. |
| `MenuButton` | WAI-ARIA menu button: the arrows, Home, End and Escape work, and focus returns to the button. Items can be actions or checkboxes, with shortcuts shown. |

Tooltips are CSS (`data-tooltip` and `data-tooltip-side`), shown on hover and on keyboard focus after a short delay.
They cost no layout and need no portal.

## Behaviour

- **Keyboard:** every action has a keyboard path, and shortcuts are listed in `?` and in tooltips. Single-key
  shortcuts work anywhere except in text fields, open menus and dialogs. On the focused map, the arrow keys pan and
  `+` and `−` zoom. `Ctrl` shortcuts also accept `⌘`.
- **Focus** is always visible (`:focus-visible`, a 2 px `--focus` outline). Dialogs are native `<dialog>` elements
  opened modal, which trap focus, close on Escape and restore focus.
- **ARIA:** accordion (sections), menu (menus), grid (tables), toolbar (tool rail), switch (toggles), dialog, and
  combobox with listbox (command palette). Landmarks: `banner` (top bar), `navigation` (tools), `main` (map),
  `complementary` (dock), `contentinfo` (status bar).
- **Motion:** `prefers-reduced-motion` turns off transitions and animations; the camera has its own handling (#139).
- **Long work:** counts and decoding run in a Worker or in slices between frames, with progress shown in the panel.

## Adding UI

- **A new action:** add a `Command`. It then appears in the menu, the palette and `?`.
- **A new panel:** add a section id to `SECTION_IDS`, then add its body to `Dock.tsx`.
- **A new list:** use `Table`.
- **New dependencies:** prefer none. Virtualisation, splitters, menus and tooltips are written in-house. If a UI
  dependency is unavoidable, record it with its reason in `docs/tooling.md`.
