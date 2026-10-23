# Editor UI plan

Status: Proposed, 2026-10-23. Turns the [product specification](editor-product-spec.md) and the
[feature catalog](editor-feature-catalog.md) into one UI change and a set of feature issues.

The approach: build the whole editor shell first, with every Foundation and Band A feature already reachable as a
tool, command, panel or dialog slot. Slots that have no behaviour yet stay visible and disabled with a short, specific
reason (ui.md principle 2). Each feature issue then connects its behaviour to its existing slot, instead of also
designing where it lives. The shell stays the one described in [ui.md](../ui.md): map in the middle, tool rail on the
left, options bar above the map, dock on the right, status bar below. Nothing here changes the agreed Grid and Ruler
behaviour (spec decision 7).

## What changes

### 1. Tool rail: tool families with variants

Today: nine flat tools in three groups (`TOOLS` in `shell/commands.ts`). The catalog needs about thirty pointer
tools. The rail shows **one button per family**; the family's other tools sit behind it, as in Photoshop and Krita:
a small corner triangle on the button, the variants in a flyout opened by a long press, a right-click, or `→` from
the keyboard. The button shows the family's last-used tool. Every variant is still a `Command` with its own
shortcut, so it is in the menus, the palette and `?`.

| Family | Tools (catalog ID) | Shortcut |
|---|---|---|
| Navigate | Pan (NAV-01), Inspect (NAV-07) | `H`, `I` |
| Measure | Ruler (CAD-02); later guides (CAD-04) | `L` |
| Select | Rectangle, Ellipse (SEL-01); later Lasso, Polygon, Magic wand (SEL-02/03); Move (SEL-09) | `M` cycles, `V` Move |
| Draw | Brush, Pencil (DRAW-01), Line (DRAW-05) | `B` cycles |
| Shape | Rectangle, Ellipse, Polygon (DRAW-06) | `U` cycles |
| Fill | Flood fill (DRAW-04) | `G` |
| Erase | Erase (DRAW-02) | `E` |
| Tile state | Hammer (DRAW-08), Paint and coatings (MAT-08) | `A` cycles |
| Pick | Eyedropper (DRAW-03) | `K` (Alt+click stays) |
| Objects | Place object (OBJ-02), Platforms and tracks (SYS-06) | `O` cycles |
| Infrastructure | Wire (SYS-03), Liquid (SYS-01), Trace circuit (SYS-04) | `W` cycles |

Pressing a family's shortcut again cycles its tools, as #224 asks. The final letters go through the one coordinated
shortcut review the spec requires; that review is a deliverable of the UI issue (a table in ui.md), not a side
effect of each feature issue. Commands that are not pointer actions (Replace, Export, Statistics) get no rail button.

### 2. Tool options bar: shared slots in a fixed order

The bar stays one fixed row on desktop; switching tools never moves the map. Every tool composes the same slots, left
to right, and leaves out the ones it does not use:

1. **Tool name and family variant switch** (segmented control for the family's variants).
2. **Material** chips (as today) or the object/schematic being placed.
3. **Channel mask** (SEL-07): one shared `Segments`-style toggle row for Blocks, Walls, Liquids, Wires, Paint,
   Objects. Today Brush, Erase and Select each have their own; they become one component with one store per tool.
4. **Selection mode** (SEL-04): Replace / Add / Subtract / Intersect, visible buttons as well as Shift/Alt modifiers.
5. **Geometry**: size and shape (as today), filled/outline and border thickness for shapes.
6. **Numeric placement** (CAD-05): X, Y, W, H in blocks with a 3 × 3 anchor control. Enter commits, Escape reverts.
7. **Tool-specific options** behind a `more` menu when they would not fit (progressive disclosure, UX-03).
8. **Commit / Cancel** for tools with a preview (paste, shapes, move, placement), then Undo / Redo as today.

A slot that does not apply in the current mode stays in place, disabled, with its reason in the tooltip (spec:
controls keep their positions when modes change).

### 3. Menu bar

| Menu | Additions |
|---|---|
| File | **Import ▸** Image as pixel art… (ART-01), Schematic… (LIB-01); **Export ▸** Map image… (OUT-01), Selection as schematic… (LIB-01); **Recover ▸** (FILE-03); Backups… (FILE-04) |
| Edit | Cut `Ctrl+X`, Duplicate `Ctrl+J` (SEL-09); Replace… `Ctrl+H` (MAT-04); Flip and Rotate (LIB-02); Keyboard shortcuts… (UX-02) |
| **Select** (new) | All `Ctrl+A`, Deselect `Ctrl+D`, Invert `Ctrl+Shift+I`, Expand to complete objects (SEL-08), Select matches of search (NAV-06, B) |
| View | Previous view `Alt+←`, Next view `Alt+→`, Fit selection, Go to… `Ctrl+G` (NAV-01); Isolate layer (VIEW-02) |
| World (new) | World statistics (QA-01), World settings presets… (MAP-01), Add bookmark `Ctrl+B` (NAV-02) |
| **Window** (new) | One checkable item per dock panel, Show panels `P`, Workspace ▸ (UX-04, B), Reset layout (moved from View) |

Assets and Help stay. Window replaces the panel items scattered over View.

### 4. Dock: four tabs and a bottom pane

The spec forbids an unbounded row of tabs. Proposal, to confirm with the layout prototype:

| Tab | Sections |
|---|---|
| **World** | Search, Bookmarks (NAV-02), World properties, Content, Entities (chests, signs, NPCs, OBJ-03), Statistics (QA-01) |
| **View** | Layers (with isolate, VIEW-02), Grid, Measurements |
| **Paint** (was Swatches) | Swatches, Palettes, Paints and coatings |
| **Library** (new) | Objects catalog (OBJ-01), Schematics (LIB-01) |

The bottom pane, today only the Inspector, becomes a small tab strip: **Inspector | History** (FILE-02), sharing the
existing splitter and height. Tabs keep their text labels while the dock is at least 280 px wide and fall back to
icons with tooltips below that, so four tabs fit the 240 px minimum without truncation.

### 5. Status bar

New cells, right of the cursor cells, each with a fixed minimum width (no layout shift):
- **Selection**: size, or "3 objects" for object selections (extends today's selection cell).
- **Background job**: name, progress and a cancel button for fill, replace, statistics, conversion and export
  (UX-07, spec: cancellable background work).
- **Recovery**: "Recovery saved 12 s ago" / storage warning (FILE-03).
- **Compatibility**: one badge with Open / Preserve / Render / Edit for the loaded world, opening the details
  (MOD-01). Replaces generic "editing is not available" messages with the capability that is missing.

### 6. Map overlays

One visual language for everything drawn over the map that is not world data: selection outline (marching ants),
ghost previews (paste, shapes, objects, move), guides, search highlights, invalid placement. Overlay colours become
tokens (`--overlay-select`, `--overlay-ghost`, `--overlay-invalid`, `--overlay-guide`) used by the renderer
uniforms, each drawn with a 1 px contrasting halo so it reads over snow, caves and dense sprites in both themes
(spec: readability). Validity is never colour alone: invalid ghosts also get a hatch pattern and the reason in the
status bar. All overlays follow the existing GPU overlay budget (no frame loop while idle, geometry uploads only on
change).

### 7. Dialogs

New dialogs use the existing `.dialog-header` / body / `.dialog-footer` structure and the "What not to do" rules
(short facts with icons, failures inside the dialog):
- **Replace** (MAT-04): find condition, replace with, scope (world / selection), channel mask, preview count, Replace.
- **Import image** (ART-01/02/05): source preview, size in blocks with aspect lock, palette, transparency policy,
  map-colour and textured previews side by side; places as a floating paste.
- **Export image** (OUT-01): scope, scale, layers, estimated size.
- **Save schematic** (LIB-01): name, tags, anchor, thumbnail, dependencies.
- **Chest editor** (OBJ-04) and **Sign editor** (OBJ-05): the existing chest dialog becomes editable.
- **Keyboard shortcuts** (UX-02): the `?` list becomes editable with conflict detection.

### 8. Look and feel

- **Icons**: about 25 new icons in `Icon` `PATHS` (pencil, line, rect/ellipse shapes, lasso, wand, move, wire,
  liquid, trace, platform, bookmark, history, library, schematic, image, export, import, replace, statistics,
  anchor, isolate, flip, rotate, recovery, capability), drawn to the existing 16 px / 1.5 px stroke grid so the set
  stays one family. Variant triangle and pressed states follow the existing `tool-button`.
- **Density**: no new sizes. Rows stay 24/26 px, the options bar 30 px, the rail 44 px. New controls are composed
  from `Segments`, `Toggle`, `IconButton`, `PropertyGrid`, `Table`, `MenuList`.
- **Empty states**: each new panel's empty state says what it is for and offers its one action (Library: "Select an
  area and Save as schematic"; History: "Edits appear here").
- **Disabled reasons**: every not-yet-connected slot gets a specific short reason ("Flood fill is not available
  yet", "Select an area first"), never the shared `EDITING_LATER` string.
- **Themes and scale**: both themes, 125–200 % display scaling and reduced motion are acceptance cases.

## Order of work

1. **UI shell** (one issue): families and flyouts, options-bar slots, menus, dock tabs and bottom pane, status cells,
   overlay tokens, dialog shells, icons, shortcut table. All new entries disabled with reasons. Supersedes #224.
2. **Foundation** (in parallel with 1): unified transactions and history (FILE-01), then recovery (FILE-03) and the
   capability matrix (MOD-01).
3. **Band A features**, each connecting one slot. Order from the spec's recommended packages: selection and masks,
   fill, replace, picker → objects and entities → shapes, transforms, schematics → search, wiring, liquids, exports →
   image conversion.

Bands B, C and R are not filed yet. Their slots are reserved where cheap (the Select family's lasso and wand, the
Workspace submenu, Library tab) and left out otherwise.

## Issues

Filed with `scripts/backlog/create-issues.sh` under milestone M5 (label `backlog`, promoted by the usual
`promote.sh`). Each issue names its catalog IDs and is blocked by the UI shell; issues that write the world are also
blocked by the transaction issue.

| Issue | Catalog IDs | Blocked by |
|---|---|---|
| #270 UI shell (supersedes #224) | UX-01/03/05/07 | — |
| #271 Transactions and one history | FILE-01 | — |
| #272 Recovery checkpoints | FILE-03 | #270, #271 |
| #273 Capability badge | MOD-01 | #270 |
| #274 History panel | FILE-02 | #270, #271 |
| #275 Selection masks | SEL-01/04/07 | #270 |
| #276 Cut, move, duplicate | SEL-08/09 | #275, #271 |
| #277 Eyedropper | DRAW-03 | #270 |
| #278 Flood fill | DRAW-04 | #275, #271 |
| #279 Replace | MAT-04 | #275, #271 |
| #280 Lines and shapes | DRAW-05/06, CAD-05 | #270, #271 |
| #281 Hammer, paint, coatings | DRAW-08, MAT-08 | #270, #271 |
| #282 Object catalog and placement | OBJ-01/02 | #270, #271 |
| #283 Entities list | OBJ-03 | #270 |
| #284 Chest editor | OBJ-04 | #271, #283 |
| #285 Signs, NPCs, landmarks | OBJ-05/06 | #271, #283 |
| #286 Navigation and bookmarks | NAV-01/02 | #270 |
| #287 Search scopes | NAV-03/04 | #270 |
| #288 Inspector editing | NAV-07 | #270, #271 |
| #289 Liquids | SYS-01 | #270, #271 |
| #290 Wires and trace | SYS-03/04 | #270, #271 |
| #291 Platforms and tracks | SYS-06 | #282 |
| #292 Schematic library, transforms | LIB-01/02 | #276, #282, #227 |
| #293 Image to pixel art | ART-01/02/05 | #270, #271 |
| #294 Map image export | OUT-01 | #270 |
| #295 Statistics | QA-01 | #270 |
| #296 World presets | MAP-01 | #270, #271 |
| #297 Save over file, backups | FILE-04 | #270 |
| #298 Layer isolate | VIEW-02 | #270 |
| #299 Custom shortcuts | UX-02 | #270 |
| #300 Material favorites | MAT-01/02 | #270 |
