# Terraria Map Studio feature catalog

Status: Proposed product backlog, 2026-10-12. Read with the [product specification](editor-product-spec.md) and [competitive research](editor-competitive-research.md).

Each row is a user capability, not necessarily a separate toolbar icon or implementation issue. Existing partial functionality must be extended rather than rebuilt. The baseline is recorded in the product specification. Unless explicitly identified there as implemented, the behavior below is a requirement or proposal, not a description of the current application.

Delivery bands: **F** foundation, **A** complete everyday desktop workflows, **B** advanced coverage, **C** deeper differentiation, **R** research or an unresolved product expansion. All rows inherit preview/commit consistency, complete undo, compatibility, keyboard access and performance requirements from the product specification. The acceptance examples below supplement that shared contract.

## Navigation and world understanding

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| NAV-01 | A | Navigation and precise location | Pan, pointer-centered zoom, Fit world, Fit selection, previous/next view and numeric Go to. Returning from a chest search restores the previous camera without changing the world. |
| NAV-02 | A | Named bookmarks | Create, rename, reorder and locate bookmarks for bases, farms, entrances and problem areas. Store them with the project; a bookmark survives reopening. |
| NAV-03 | A | Search all supported world content | Search blocks, walls, styles, liquids, wires, objects, chest items, signs and NPC records by name or ID. Show what is searched; chest-item search must not imply that player inventory was included. |
| NAV-04 | A | Useful search results | Display list and map highlights, next/previous, counts, nearest-to-location sorting and optional region grouping. A chest is one result, not one result per footprint tile; clustered ore can be navigated by deposit. |
| NAV-05 | B | Composable queries | Combine conditions with explicit all/any/exclude logic and world/selection/region scope. Save a query such as empty chests inside a named dungeon region and rerun it after edits. |
| NAV-06 | B | Search to action | Turn exact matches into a selection, protection mask, bookmark set or replacement input. Report grouped regions and individual affected cells separately before a change. |
| NAV-07 | A | Inspect and compare properties | Pin a tile/object, inspect all stored channels and sample properties. Multiple selection exposes shared and mixed values; editing one property leaves all others intact. |
| NAV-08 | B | Overview and multiple views | Minimap, saved camera views and optional synchronized overview/detail or before/after views. Limit extra rendering cost and make the active editable view unambiguous. |
| NAV-09 | B | Exploration privacy | Optional spoiler filtering based on imported compatible player exploration data. Unknown visibility remains unknown; search must respect the chosen reveal policy. This requires a separate supported map-data reader. |

## Rendering and visual inspection

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| VIEW-01 | A | Map and texture views | Preserve readable map colors at overview scale and supported sprites at detail scale, with explicit user control. Missing textures fall back visibly without making the material unselectable. |
| VIEW-02 | A | Channel visibility and isolation | Show/hide or temporarily isolate blocks, walls, liquids, wires, objects and supported annotations. Visibility has no effect on saved data or write masks; restore the previous visibility set after isolation. |
| VIEW-03 | B | Focus filters | Dim or hide unmatched content and highlight selected types or query results with an adjustable overlay. A user can inspect one material among dense sprites without converting surrounding terrain to another color. |
| VIEW-04 | B | Lighting and appearance preview | Optional supported lighting, background, time-of-day and paint/coating preview alongside a neutral editing view. State approximations and preserve the readable unlit editing mode; viewing a different time need not change world metadata. |
| VIEW-05 | B | Animation controls | Preview supported animated tiles, liquids and objects with play/pause and a stable editing frame. Static scenes do not acquire an unnecessary continuous redraw loop. |
| VIEW-06 | B | Functional overlays | Inspect supported collision/solid cells, supports, depth zones and object footprints independently of visual texture. Each overlay names the data/rules it represents and provides a legend. |
| VIEW-07 | B | Synchronized comparison | Compare map versus textures, before versus after or two design variants with linked cameras and an optional split slider. Selecting a pane makes the edit target explicit. |
| VIEW-08 | B | Measured quality settings | Offer documented preview quality controls for dense scenes and lower-end graphics. Reduce optional visual detail before interaction responsiveness; a quality setting never changes exported tile data. |

## Selection and edit scope

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| SEL-01 | A | Rectangular and elliptical selection | Drag or enter X/Y/W/H, move/resize the selection boundary and distinguish selecting cells from moving their contents. Width 10 always selects ten columns. |
| SEL-02 | B | Freeform selection | Polygon, lasso and paint-selection modes for irregular terrain or artwork. Closing a polygon gives a deterministic block mask with no partially selected cells. |
| SEL-03 | B | Connected and similar selection | Magic-wand connected selection and global matching by material, wall, paint or chosen properties. Expose four/eight-neighbor connectivity where relevant; a cave gap must not be crossed unexpectedly. |
| SEL-04 | A | Selection operations | Replace, add, subtract, intersect, invert, select all and deselect. Provide visible controls as well as modifiers; a persistent selection constrains applicable edit tools consistently. |
| SEL-05 | B | Grow, shrink, border and holes | Expand/contract a mask by an integer number of blocks, select its outline and optionally fill enclosed holes. Preview how narrow passages or disconnected islands change. |
| SEL-06 | B | Named selections and protected regions | Save, recall, combine and lock reusable areas. Protect a town while converting surrounding terrain; every bulk tool must respect the protection mask. |
| SEL-07 | A | Channel masks | Independently target blocks, walls, liquids, wires, paint/coatings and supported objects. Visibility never silently determines what an operation writes. |
| SEL-08 | A | Content-aware object selection | Offer expand-to-complete-object or omit-partial-object behavior with counts. A partially selected chest cannot be moved without its remaining tiles and inventory record. |
| SEL-09 | A | Cut, move, duplicate and nudge | Move contents with a ghost and explicit collision/empty-cell policy; nudge by block or configured step. Cancel restores the source; commit is one transaction across source and destination. |

## Drawing and block geometry

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| DRAW-01 | A | Pencil and brush | Single-block precision and configurable footprints, with interpolation, outline preview, numeric size and optional stabilizer. Fast strokes have no holes; size and shape remain stable during one gesture. |
| DRAW-02 | A | Eraser | Erase selected channels with the same footprint behavior as Brush. Touching a removable object clears its complete supported footprint and records atomically. |
| DRAW-03 | A | Dedicated eyedropper | Sample material, paint, shape, liquids or complete supported properties according to explicit toggles. Temporary picking returns to the previous tool; existing Alt+click remains discoverable. |
| DRAW-04 | A | Flood fill | Fill a connected region matching selected properties, bounded by selection and protection. Preview large fills, allow cancellation and keep the world unchanged on failure. |
| DRAW-05 | A | Line and polyline | Straight or chained segments with block width, end caps and optional axis/angle constraints. Show exact footprint and dimensions before commit; avoid doubled cells at joints. |
| DRAW-06 | A | Basic shapes | Rectangle, ellipse, circle and polygon with filled/outline modes, border thickness, numeric size and center/corner anchor. A room outline produces the same cells as its preview. |
| DRAW-07 | B | Curves and architectural geometry | Arcs, Bézier paths, rounded corners, arches and domes represented as editable draft geometry, then rasterized to blocks. Show discretization before placement and preserve source handles in a project. |
| DRAW-08 | A | Hammer and tile state | Explicit slope, half-block and full-block editing plus optional edge smoothing. Unsupported tiles are identified; shape changes preserve material, paint and entities. |
| DRAW-09 | B | Brush dynamics and presets | Custom footprints, spacing, rotation, scatter and density with saved presets. A fixed random seed reproduces a stroke; density means tile placement probability, not visual alpha. |
| DRAW-10 | B | Pattern and stamp brush | Repeat a saved tile pattern or small structure with defined origin and spacing. Adjacent strokes align to the same pattern origin; supported entities are duplicated correctly. |
| DRAW-11 | B | Clone brush | Sample a source area and paint from it with fixed/aligned offset modes and channel masks. Preview the source cursor and protect complete entities; overlap must not corrupt the sample. |
| DRAW-12 | B | Text made from blocks | Convert text using licensed/imported bitmap glyphs into an editable tile draft. Control scale, spacing, outline and material; distinguish block lettering from editing a sign's text. |

## Precision design and measurement

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| CAD-01 | F | Grid | Preserve Off / 3 / 5 / 10 / Custom, one spacing at a time, custom 2–1000, opacity, origin 0/0 and saved preferences. Minor lines are muted/dashed; major lines continuous. View menu and right panel share state. |
| CAD-02 | F | Ruler | Preserve one-block-wide raster line footprints with white outline, blocks-only labels, angle to two decimals, Shift-held rectangle mode and an explicit rectangle option. Keep/replace, rename, hide, delete, edit handles and locate from the right panel. |
| CAD-03 | B | Extended dimensions | Horizontal/vertical dimensions, chain dimensions, area, perimeter, gap and radius measurements with explicit semantics. Distinguish geometric perimeter from the number of filled blocks. No silent return of ambiguous distance units. |
| CAD-04 | B | Guides and snapping | Named horizontal/vertical guides; snap to grid, endpoints, centers, edges and selected objects. Show the active snap target and provide temporary bypass. Snapping never depends on zoom-induced rounding. |
| CAD-05 | A | Numeric placement | Enter coordinates, dimensions and relative offsets for selection, shape, object and paste. Use a shared anchor control and keyboard nudging; 0–10 boundary measurements remain consistent with a ten-cell shape. |
| CAD-06 | B | Symmetry | Horizontal, vertical and combined mirrors with draggable/numeric axes; support axes through a block center or boundary. The preview reveals all copies and collisions before painting. |
| CAD-07 | B | Align and distribute | Align selected draft objects/components by edge or center and distribute by center or equal gap. Keep the reference object explicit; three windows can retain their widths while gaps become equal. |
| CAD-08 | B | Repeated arrays | Repeat components in rows, columns, radial arrangements or along a path using count and spacing. Edit one array definition; preview footprint collisions, raster rounding and total material cost. |
| CAD-09 | C | Parametric construction | Editable room width, wall thickness, roof rise, arch span and platform spacing. Use a small validated parameter set first; report impossible dimensions without moving unrelated content. |
| CAD-10 | C | Design constraints | Pin alignment, equal dimensions or distances between draft objects. Distinguish a displayed reference measurement from a driving constraint; list conflicts and let users release a constraint. |
| CAD-11 | B | References and annotations | Import local reference images, text notes, arrows and regions with visibility, opacity, lock and grouping. Calibrate an image to a known block width and preserve it in the project or an explicit external reference. |
| CAD-12 | C | Plan to construction | Convert selected shapes or measured outlines to block/wall drafts with chosen materials. Conversion creates a separate preview; editing a note never silently edits terrain. |

## Materials and visual design

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| MAT-01 | A | Material browser | Search names/IDs and browse blocks, walls, paints and supported styles with consistent thumbnails, favorites and recents. The global sprite preference has the same meaning across canvas and pickers. |
| MAT-02 | A | Portable palettes | Named material-plus-paint palettes, reorder, import/export and reuse across projects. Missing content appears explicitly rather than shifting palette entries. |
| MAT-03 | B | Related materials | Suggest visual families, color/value neighbors, matching walls and available variants. Suggestions identify whether similarity is based on map color, texture or metadata. |
| MAT-04 | A | Replace and recolor | Replace material, paint or chosen properties inside a scope using exact conditions. Preserve shapes, wires and supported object records unless the operation explicitly changes them. |
| MAT-05 | B | Palette remapping | Map several source materials to alternatives in one preview. A stone house can become brick while retaining painted accents and excluded furniture. |
| MAT-06 | B | Weighted material mixtures | Paint from weighted material sets with seed, clustering and depth/edge conditions. Reapplying a preset is predictable; unsupported combinations are omitted with a visible explanation. |
| MAT-07 | B | Gradients and shading ramps | Apply discrete material/paint ramps, ordered dithering or error diffusion to a selected area. A gradient produces supported block combinations, not unsupported intermediate colors. |
| MAT-08 | A | Paint and coatings | Apply/remove supported paint and coatings by channel, with names and visible preview. Version-specific availability is checked before placing or exporting. |
| MAT-09 | B | Material quantities | Count placed cells, objects and mapped obtainable items separately, with paint/coating quantities and exclusions. A multi-tile chair counts once as an object; uncertain acquisition data is marked. |

## Pixel art and image conversion

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| ART-01 | A | Image import and preparation | Import local PNG/JPEG/WebP, crop, rotate, scale and choose output size in blocks with aspect lock. Estimate work and memory before conversion; cancellation leaves the current draft intact. |
| ART-02 | A | Map and texture matching | Offer map-art and textured-build matching targets using supported material/paint combinations. Show both previews; do not imply minimap color guarantees the same in-game appearance. |
| ART-03 | B | Palette constraints | Limit to selected materials, maximum palette size, available items or non-falling/non-hazardous content. Explain unmatchable colors and let users pin a preferred substitute. |
| ART-04 | B | Dithering and cleanup | Compare no dithering, ordered and diffusion modes; adjust brightness/contrast and remove isolated noise through an explicit preview. Preserve hand-edited results as a new draft/version. |
| ART-05 | A | Transparent image policy | Map transparency to preserve destination, clear chosen channels or selected background material. Partial alpha is resolved deliberately during conversion; it never creates translucent solid blocks. |
| ART-06 | B | Pixel-art finishing | Pixel-perfect line cleanup, outline expansion, palette shading and tileable pattern preview. Seams and isolated pixels are highlighted without silently modifying them. |
| ART-07 | B | Construction output | Export material table, indexed palette legend and tiled plans with optional coordinates. A user can reproduce the art manually without running an editor mod. |

## Objects and entity data

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| OBJ-01 | A | Furniture and object catalog | Search and preview supported furniture, doors, decorations, plants and styles with dimensions and placement anchors. Identify styles from metadata rather than treating every frame as an independent item. |
| OBJ-02 | A | Validated placement | Ghost preview shows footprint, supports, direction, collision and precise failure reason. Placing an object writes the required tiles and entity record in one transaction. |
| OBJ-03 | A | Entity list and locate | Filter chests, signs, NPCs and supported tile entities; locate and edit from one list. Selection synchronizes with Inspector and avoids duplicate results for footprint cells. |
| OBJ-04 | A | Chest editor | Edit name, slots, item, stack and prefix with validation, icons where available, and grid/list views. Copy/paste slot contents and clear selected slots; undo restores complete payloads. |
| OBJ-05 | A | Sign and text editor | Edit signs with actual encoding/length limits and multiline preview; search sign text and duplicate signs safely. Unknown extra fields survive unrelated text changes. |
| OBJ-06 | A | NPC and landmark tools | Inspect and set supported NPC/home fields, spawn and dungeon points with numeric entry and map placement. Changing a saved record does not promise immediate runtime NPC behavior. |
| OBJ-07 | B | Advanced tile entities | Dedicated editors for supported displays, mannequins, racks and other entity types. Expose only verified fields; unknown serializers remain preserved and read-only. |
| OBJ-08 | B | Batch entity operations | Rename, fill/clear inventories from templates and apply selected fields across scoped entities. Preview entity count and changed slots, not only affected map cells. |
| OBJ-09 | B | Object repair assistance | Detect inconsistent anchors, incomplete footprints or missing required records. Present supported fixes individually or in a reviewable batch; never guess the contents of a lost chest. |

## Terrain and biomes

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| TER-01 | B | Terrain sculpting | Add/remove, flatten to a reference height, smooth and roughen selected terrain. Control affected channels and protect objects; smoothing remains distinct from tile hammering. |
| TER-02 | B | Tunnel and corridor tool | Draw a path with width, lining, background wall and clearance options. Preview doors, objects or protected areas intersected by the corridor. |
| TER-03 | B | Biome conversion | Convert supported terrain/walls with depth-aware rules and explicit plant/object options. Display the actual changed materials; changing a biome-related header field alone does not count as conversion. |
| TER-04 | B | Infection analysis and editing | Locate relevant corruption/crimson/hallow content, define protected regions and preview purification or containment edits. Runtime spread prediction is separately qualified by supported rules/version. |
| TER-05 | C | Procedural terrain patches | Generate islands, caves, ore pockets and surface contours inside a selected region with seed and adjustable parameters. Keep the generated result as a draft and regenerate without compounding prior edits. |
| TER-06 | B | Vegetation and decoration scatter | Place supported plants/objects using density, spacing, substrate and clearance rules. The same seed and inputs reproduce the same layout; unsupported placement is skipped visibly. |
| TER-07 | C | Rule-based decoration | Map conditions such as surface material, depth and neighborhood to material/object outputs. Show rule order, matches and preview; rules execute within scope and protection limits. |
| TER-08 | R | New playable world generation | Separate blank construction canvases from full world generation. Investigate an explicit game/companion integration before promising vanilla-equivalent generation from seed. |

## Liquids, wiring and movement infrastructure

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| SYS-01 | A | Liquid painting and clearing | Place supported water/lava/honey/shimmer amounts by brush, shape or selection. Distinguish stored liquid data from simulated flow and preserve untargeted channels. |
| SYS-02 | B | Basin fill | Fill a bounded cavity to a chosen level with open-boundary/leak indication. Define the static fill rule and affected volume; it does not promise the game's final equilibrium. |
| SYS-03 | A | Wire and actuator editing | Draw/erase chosen wire colors and actuators independently with clear active targets. Crossing colors remain separate; removing red wire must preserve blue wire in the same tile. |
| SYS-04 | A | Circuit trace | Highlight supported connected circuits, respect junction routing and inspect connected objects. Show ambiguous or unsupported elements; connectivity is not a claim that a mechanism works. |
| SYS-05 | B | Routed wires and buses | Click-to-click orthogonal/diagonal routing, elbows, repeated segments and parallel wires with spacing. Preview collisions, crossings and endpoint connections before commit. |
| SYS-06 | A | Platforms, stairs and tracks | Draw supported paths with appropriate framing, slope, connections and optional clearance. Validate each terrain/object interaction; unsupported junctions require explicit user correction. |
| SYS-07 | B | Circuit documentation | Name/color-label circuits, group mechanisms and define module input/output points as project annotations. Moving a module can preserve relative ports without inventing new game fields. |
| SYS-08 | C | Circuit diagnostics and scoped simulation | Detect supported connectivity problems first; separately simulate a declared subset of devices and state transitions. Display unsupported elements and stop short of claiming Terraria-equivalent timing. |
| SYS-09 | R | Liquid and gameplay simulation | Evaluate feasibility of bounded previews or a companion-game check. Arbitrary liquid, NPC and mod behavior is outside a generic offline save editor's proven model. |

## Structures, projects and reuse

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| LIB-01 | A | Schematic files and library | Save a complete selected build with thumbnail, dimensions, tags, author, dependencies and anchor. Browse, search and place from a local library; broken dependencies remain visible. |
| LIB-02 | A | Paste transforms | Move, nudge, flip and rotate supported content, with repeat placement and exact numeric position. Transform shapes, orientation, anchors and records together; block transforms that lack valid mappings. |
| LIB-03 | B | Scaling with explicit limits | Scale plain tile drafts with a documented raster rule. Multi-tile furniture and entities need a supported reconstruction rule or exclusion; resizing must not stretch a chest into invalid tiles. |
| LIB-04 | B | Interchange adapters | Import/export agreed versions of TEdit schematics and TerraWorld packages with a feature report. Reject or preserve unsupported fields explicitly; do not silently flatten custom data. |
| LIB-05 | B | Standalone structure workspace | Create a bounded structure without opening a world, using the same tools and materials. Resize/crop with preview, memory estimate and object preservation checks. |
| LIB-06 | B | Persistent design layers | Separate shell, furniture, wiring and alternatives with rename, lock, visibility, order and preview opacity. Save/reopen retains editable layers; composition resolves cell/entity conflicts deterministically. |
| LIB-07 | B | Portable editable projects | Preserve layers, notes, references, selection sets, saved views, dependencies and design parameters. Exported game data is separate from the full project and its recovery snapshots. |
| LIB-08 | B | Versions and alternatives | Duplicate a design variant and compare it before replacing another. Switching alternatives never merges mutually exclusive geometry accidentally. |
| LIB-09 | C | Linked components | Instantiate a reusable module with supported local overrides and optional updates from its source. Updating a window reports conflicts with modified instances; users can detach an instance. |
| LIB-10 | C | Parametric component families | Reuse one house/bridge/platform definition with material and dimension variants. Show generated footprint and validate object placement whenever parameters change. |
| LIB-11 | B | Material replacement on placement | Substitute a structure's material palette for the target world before commit. Missing or modded materials require explicit mappings; shape and entity validity are rechecked. |
| LIB-12 | C | Construction stages | Divide a blueprint into foundations, shell, interiors and mechanisms; track manual completion in project metadata. Show remaining material needs without altering the player's inventory. |

## Gameplay planning and adventure authoring

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| MAP-01 | A | Friendly world settings | Edit supported time, weather, difficulty, progression and appearance through validated controls. Presets preview all changed fields and explain that stored flags do not rebuild terrain. |
| MAP-02 | B | Named gameplay regions | Annotate towns, arenas, farms, dungeon rooms and no-edit areas with notes and optional relationships. Regions are editor metadata unless an explicit supported operation uses them. |
| MAP-03 | B | Housing checks | Diagnose supported room boundaries, required objects and relevant surroundings using a declared game-version rule set. Return Valid/Invalid/Unknown with located reasons; do not infer unsupported mod rules. |
| MAP-04 | B | Arena and farm planning | Generate repeated platforms and measure gaps, clearance and zone sizes. Optional spawn/despawn or effect-range overlays identify assumed player position, equipment and rules. |
| MAP-05 | B | Loot and reward templates | Apply item/stack/prefix templates to selected chests and optionally vary them with a seed. Show affected chests and limits; keep existing contents unless replacement is chosen. |
| MAP-06 | B | Progression and puzzle planning | Connect annotated regions, keys, reward chests, signs and mechanisms in an authoring graph. These links document intended gameplay and do not create new runtime quests or triggers. |
| MAP-07 | B | Playtest checkpoints and notes | Save a world copy/checkpoint, record issues with position and category, and compare later changes. A playtest checklist can reference game-only checks not validated by the editor. |
| MAP-08 | C | Reusable adventure templates | Reuse room, loot, sign and mechanism arrangements with declared dependencies. Templates remain editable and export only supported Terraria state. |

## Diagnostics and world maintenance

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| QA-01 | A | World statistics | Count materials, supported entities and selected-region contents in cancellable background work. Refresh affected counts after edits; show stale/recomputing state instead of presenting old numbers as current. |
| QA-02 | B | Structured validation report | Check bounds, invalid references, duplicate records, supported object consistency and export compatibility. Every finding locates the problem and names its evidence or rule. |
| QA-03 | B | World and region diff | Compare two compatible saves by tiles, channels, entities and metadata; filter differences and navigate regions. Distinguish actual edits from serialization-only differences. |
| QA-04 | B | Selective restore | Restore a selected region/channel from a checkpoint with a preview and entity conflict resolution. Unselected terrain and inventory payloads remain intact. |
| QA-05 | C | Portable change packages | Export an edit patch with source identity/revision and scoped expected-before values. Applying to a different world requires conflict review; never silently overwrite mismatched cells. |
| QA-06 | B | World resizing and crop review | Extend the current resize behavior with anchor choice, preview and explicit handling of displaced entities/notes. Define history boundaries and recovery before large allocation. |
| QA-07 | B | Cleanup tasks | Find unsupported/orphaned records, empty containers or chosen material remnants; offer only verified cleanup operations. Inspecting a problem never triggers automatic deletion. |

## History, files and recovery

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| FILE-01 | F | Atomic editing and history | Unify supported edit types into named transactions with cancel/undo/redo. Metadata, object and terrain changes cannot leave mismatched history states. |
| FILE-02 | A | Visible history | Show action, scope, affected counts and saved position. Preview or locate a change; clear distinction between undoing world edits and editing project-only notes. |
| FILE-03 | F | Recovery autosave | Persist bounded recovery checkpoints in background, with storage status and restore choice after interruption. Test forced reload during work and full storage. |
| FILE-04 | A | Verified saves and backup browsing | Preserve Save As verification, list compatible backups and provide explicit replacement only with a defined backup/conflict workflow. Failed verification leaves existing files untouched. |
| FILE-05 | B | External file change detection | Detect source changes since open/save and offer reload, separate save or supported comparison. Do not overwrite a world that the game or another editor has changed silently. |
| FILE-06 | B | Multiple documents | Open several worlds/structures with explicit active document, independent history and bounded memory. Cross-document paste validates target compatibility. |
| FILE-07 | B | Project migration and storage management | Version project files, migrate with backups, show recoverable storage use and remove selected caches without deleting user documents. Missing external references remain repairable. |

## Automation and extensions

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| AUTO-01 | B | Recorded macros | Record supported commands and parameters, expose scope inputs and replay with a preview. Pointer movement is converted into meaningful operations; one replay is undoable as a group. |
| AUTO-02 | B | Batch recipes | Combine search, mask, replace, object placement and validation into named recipes. Show ordered steps, affected counts and cancellation; do not partially apply a failed recipe. |
| AUTO-03 | C | Script API | Provide versioned query/edit APIs using the same transaction and preview system. Bound execution and data access, report errors with no half-applied edits, and keep scripts optional. |
| AUTO-04 | C | Extension packages | Register supported tools, presets or diagnostics through declared APIs with version/dependency information. Extensions must not bypass compatibility or transaction rules. |
| AUTO-05 | R | AI-assisted proposals | If adopted, translate a request into inspectable operations or draft geometry. Show scope and material choices before application; providers, data handling and costs remain open decisions. |

## Compatibility and modded content

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| MOD-01 | F | Explicit capability matrix | Show Open, Preserve, Validate, Render and individual Edit/export capabilities for the loaded format and content. Seeing a sprite is not evidence that moving its object is safe. |
| MOD-02 | B | Paired world management | Load and validate matching `.wld`/`.twld` companions and retain unsupported data as permitted by the codec contract. Export pairs consistently; report missing/mismatched companions. |
| MOD-03 | B | Dependencies and stable identity | Resolve mod/internal-name identities against declared mod versions and mappings; report missing or conflicting definitions. A runtime numeric ID is never treated as portable identity by itself. |
| MOD-04 | B | Mod Export Packs | Connect user-provided manifests, rules and textures for supported rendering and editing. List provenance and capability per content type without executing arbitrary game assemblies in the browser. |
| MOD-05 | C | Supported content adapters | Add independently verified footprints, transformations and entity serializers for selected mods. A mod version change can reduce capabilities until the adapter is validated. |
| MOD-06 | R | Game companion integration | Investigate explicit export/playtest helpers for data the browser cannot reliably derive. Keep the normal editor usable without a running game or companion. |

## Sharing, presentation and adjacent products

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| OUT-01 | A | Map and selection image export | Export viewport, selection or full map at an explicit scale with channel/annotation choices. Large outputs use bounded work and memory; preview matches the chosen composition. |
| OUT-02 | B | Dimensioned plans and reports | Export printable/tiling plans, legends, material tables and validation reports. State whether dimensions are blocks, raster counts or geometric values. |
| OUT-03 | C | Construction replay | Replay recorded supported construction stages or history for explanation and optional video export. Do not present the result as actual gameplay footage. |
| OUT-04 | B | Portable review bundle | Package previews, notes, dependencies, attribution and selected project artifacts. Reviewers can inspect what changed without receiving unrelated worlds or local asset folders. |
| OUT-05 | R | Community library | Investigate discovery, ratings, moderation, attribution and distribution separately from local schematic files. Public sharing is an explicit action. |
| OUT-06 | R | Collaborative editing | Start with exchanged versions/patches; investigate live sessions only after transactions and conflicts are reliable. Presence and comments alone do not solve world merge semantics. |
| OUT-07 | R | Player editor | Consider `.plr` and modded companions as a separately scoped domain: inventory, equipment, appearance and supported progression. Do not claim complete TerraWorld/TManager product parity while excluding this area. |

## Workspace quality and accessibility

| ID | Band | Capability and user value | Required behavior and acceptance example |
| --- | --- | --- | --- |
| UX-01 | F | Stable compact controls | Reuse shared controls and tokens; predictable rows, labels, values and menus. Changing a mode cannot make its neighboring slider jump or overlap. |
| UX-02 | A | Commands and shortcuts | Register every action once for menu, palette and shortcut help; support keyboard paths and conflict-aware shortcut customization. Text inputs keep native editing shortcuts. |
| UX-03 | A | Progressive disclosure | Show core settings first and advanced options on demand, with meaningful presets and short inline reasons. Opening a tool reveals its target and effect without a tutorial modal. |
| UX-04 | B | Workspace presets | Save panel layout, preferred tools and relevant views for building, exploration, wiring or art. Presets reorganize access to shared functionality and never reset the document. |
| UX-05 | A | Accessible feedback | Visible focus, meaningful labels, keyboard handles, numeric alternatives, reduced motion and non-color status cues. Verify dark/light themes and enlarged display scaling. |
| UX-06 | B | Localization readiness | Separate UI strings and preserve content identity across translations. Product-language coverage is a separate decision; repository code and documentation remain English. |
| UX-07 | F | Responsive feedback | Visible cancellable progress for long work, immediate local previews, no surprise canvas dimming and no flicker. Offscreen notes and closed panels should have negligible ongoing cost. |

## Detailed contracts for features shared across tools

### Masks and protection

A write is allowed only where the operation's region, selection, content conditions and channel mask allow it, and where protection does not forbid it. Conditions are inspectable before applying. Object expansion cannot silently escape the declared scope: the preview must either show an explicitly expanded scope or omit the object with a reason.

For example, replacing Stone with Gray Brick inside a selected castle must preserve walls, paint, wires and inventory records unless their changes were requested. A query-selected mask remains fixed during a single transaction; edits cannot cause the operation to chase its own newly created matches indefinitely.

### Geometry and rasterization

Draft paths can retain continuous control geometry for editing, but world writes resolve to integer cell coordinates and supported tile states. Numeric dimensions and displayed footprints are authoritative. All quadrants, reversed drags, odd/even dimensions, zero-length gestures and world boundaries have defined results.

Rotation and scaling of ordinary tiles differ from transformation of furniture and entities. A preview must not stretch or rotate unsupported object frames into a misleading valid-looking result. Supported transformations update shape, orientation, footprint, anchors and attached records together.

### Design layer composition

Before implementing LIB-06, specify channel precedence, empty-cell meaning, erase operations, entity ownership and cross-layer supports. Hiding a layer changes the proposed export composition, so validate objects after composition. Opacity only changes the editor preview; export uses the chosen discrete content.

Opening the project must restore the editable source layers. A flattened structure file is not a replacement for the project. Conversion between the two document types must explain the loss of editability before it happens.

### Components and parametric output

A component has a source definition, parameters, instances and explicit overrides. Preserve source revision on each instance. Updating the source produces an affected-instance preview and lists conflicts; users choose update, retain override or detach. A component placed into a game export becomes supported Terraria data, while its editing relationships remain in the project.

Parameter changes operate on the draft definition and revalidate the generated cells and objects. They do not search a flattened world and guess which nearby blocks belong to the design.

### Analysis versus simulation

Saved-state inspection, static rule validation and runtime simulation are different capability levels. A diagnostic must identify which it provides. A wire trace proves supported connectivity; a room check proves only the implemented housing conditions; a biome estimate states its sampling window and rule version.

Where the game, player state or unknown mods can change the result, return an explanation and Unknown/Approximate as appropriate. Do not label a farm efficient or a puzzle solvable solely because its geometry is plausible.

### Generation and automation

Every generator and recipe exposes its scope, parameters and random seed. Regeneration replaces its preview rather than repeatedly mutating the source. Large jobs run cancellably and commit as a complete operation only after validation. Stored recipes reference stable content identities and explicitly supported API versions.

### Persistence and export

Separate game save, editable project, flattened structure, change patch, image/report and recovery checkpoint. Each export names its format, version, scope, dependencies and omitted information. Source files and local assets are never bundled into a shareable artifact incidentally.

Import adapters validate payloads and record unsupported fields. Unknown content must not be converted to air simply to make an import appear successful.

## Dependency map

| Foundation | Features it enables |
| --- | --- |
| Shared transactions and complete history, FILE-01 | Every mutating tool, batch operation, selective restore and automation |
| Selection and mask engine, SEL-01 through SEL-08 | Fill, replace, sculpt, generation, protection and search-to-action |
| Object metadata and serialization, OBJ-01/02/07 | Correct transforms, schematics, circuit modules, layer composition and diagnostics |
| Content queries and classification, NAV-03/05 | Analysis, material filters, biome tools, repair and recipes |
| GPU overlay lifecycle and performance, CAD-01/02 and UX-07 | Guides, search highlights, references, previews, dimensions and diagnostics |
| Project persistence and composition, LIB-06/07 and FILE-03/07 | Variants, construction stages, linked modules and parametric design |
| Capability registry, MOD-01 | Honest tool availability, mod adapters and trustworthy import/export |

## Coverage review before implementation

For each row selected for implementation, record the beneficiary, existing implementation to extend, exact supported content, interaction states, failure/cancel behavior, history and persistence effects, performance workload and acceptance proof. Split rows with different dependencies into separate issues while retaining their catalog ID.

Review complete workflows, not just feature counts. A library without reliable placement, a diagnostic without a located explanation, or a ruler that visibly slows the map does not satisfy its row.
