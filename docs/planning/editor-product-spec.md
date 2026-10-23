# Terraria Map Studio product specification

Status: Draft for product review. Updated 2026-10-12.

Terraria Map Studio should let players understand and maintain their worlds, builders design precisely, and map authors deliver complete experiences. The product goal is broad practical coverage of TerraWorld and TEdit, with a consistently faster and clearer workflow across exploration, construction, review and saving.

Feature quantity alone will not distinguish the editor. The proposed product advantage is an editable project that retains design intent: dimensions, reusable components, material choices, construction stages and alternate designs, connected to a reliable Terraria world editor.

This specification describes intended behavior. It does not declare the proposed features implemented or their performance targets achieved. Priorities are proposals for sequencing; the confirmed decisions below are binding. It complements the existing architecture and UI contracts rather than replacing them.

## Documents

- [Feature catalog](editor-feature-catalog.md): tools, feature IDs, scope, expected behavior and acceptance examples.
- [Competitive research](editor-competitive-research.md): documented competitor capabilities and design references.
- [Existing UI contract](../ui.md), [editing behavior](../editor.md), [world property behavior](../world-properties.md) and [architecture](../architecture.md).

## Confirmed product decisions

1. Serve ordinary players, builders and adventure map authors. Each needs complete workflows; none is merely a future audience.
2. Deliver the full desktop experience first. Tablet and phone interaction are later product work.
3. Treat TerraWorld and TEdit as the closest comparisons. Use TerraMap, TManager and in-game tools as adjacent references.
4. Expand mod support in explicit stages: Preserve, Validate, Render and Edit. Display compatibility per content type and operation. Full arbitrary mod behavior is not promised.
5. Preserve the established compact editor style. New features use existing controls, density, themes, commands and panel conventions.
6. Rendering additions must have practically negligible overhead for ordinary usage. Measure the complete application with real worlds and local assets; shader implementation alone is not proof.
7. Grid and ruler behavior already agreed with the user remains the starting contract. Changes to those choices require discussion.
8. This round produces specifications only. It does not authorize implementation of unresolved product choices.

## User groups and complete workflows

| User group | Job to complete | Essential tools | Useful advanced capabilities |
| --- | --- | --- | --- |
| Casual player | Find an item or location, understand a world, make a small edit and save confidently | Search, navigation, Inspector, chest editor, clear save feedback | Spoiler controls, bookmarks, recovery checkpoints |
| Survival builder | Plan a build that can be constructed manually | Ruler, guides, object browser, materials list, blueprint overlay | Construction stages, substitutions for unavailable materials, printable plans |
| Architectural builder | Produce coherent houses, castles, towns and repeated details | Shapes, numeric dimensions, symmetry, align/distribute, schematics | Linked modules, room layouts, parametric roofs and arches |
| Pixel artist | Reproduce art with Terraria materials and textures | Precise drawing, palettes, image conversion, paint/coatings, comparison preview | Dithering, shading ramps, tileable patterns, constrained material matching |
| Terrain and biome designer | Shape caves, islands, vegetation and biome transitions | Sculpt, masks, fill, replace, biome conversion | Seeded generation, erosion-like shaping, rule-based decoration |
| Mechanism builder | Understand and lay out circuits, tracks and actuated structures | Wire tools, trace, layers, object placement, path routing | Circuit labels, connectivity checks, module ports, bounded simulation |
| Farm and arena designer | Design dimensions, spacing, safety and functional zones | Repeated platforms, tunnels, measurement, region analysis | Versioned spawn/housing/range overlays and explicit assumptions |
| Adventure and puzzle author | Plan progression, place rewards and inspect dependencies | Regions, signs, chests, NPC/spawn tools, wiring, checkpoints | Route graph, loot presets, playtest notes, release validation |
| World owner or server administrator | Repair or selectively update a world without losing unrelated work | Backups, diff, region restore, entity search, batch changes | Change packages, conflict review, cleanup reports |
| Modded player or mod author | Inspect supported content and understand compatibility | Paired world import, stable identities, missing-mod report | Mod Export Pack, adapters, portable structures with dependencies |
| Schematic author and collaborator | Reuse and exchange work while retaining editability | Library, project files, tags, previews, interchange | Versions, linked components, review notes and portable patches |
| Educator, guide author or content creator | Explain how a build works | Annotated exports, dimensioned plans, named views | Construction replay, material tables, staged walkthroughs |
| Keyboard or accessibility-focused user | Complete editing without precise pointer work | Command palette, numeric entry, keyboard selection, visible focus | Configurable shortcuts, larger controls, reduced motion, non-color cues |

These groups overlap. A player may search for a location, become a builder, and later publish a map in the same project. Workspace presets must expose useful tools without creating separate incompatible applications.

## Current implementation baseline

Status refers to the inspected working tree on `feat/ruler-measurements`, including uncommitted ruler work. Available means a reachable implementation exists; it is not a claim about a published release or complete validation.

| Capability | Current state | Product gap |
| --- | --- | --- |
| Local world open, file library and verified Save As | Implemented | Recovery projects, backup management, change summaries and external-change conflicts |
| Map colors, sprites, layers, pan/zoom and Inspector | Implemented | Rich find/filter workflows, saved views, comparison and functional overlays |
| World properties | Decoded fields are editable with validation | Friendly presets, cross-field guidance and unified undo; seed edits do not regenerate terrain |
| Brush and Erase | Materials, paint, square/round size, smoothing, stabilizer and history | Fill, masks, complete state tools, terrain tooling and advanced brush modes |
| Content picking | Alt+click picking exists; dedicated Picker is unavailable | Complete standalone picker with explicit sampled properties |
| Selection and paste | Rectangular copy/paste, layer selection, anchor, merge options and entity preservation | Cut/move, edit masks, selection algebra, transforms and reusable library |
| Swatches and palettes | Search, recent/custom palettes, import/export and sprite thumbnails | Material families, similarity, weighted patterns and survival costs |
| Chests and entities | Chest contents can be inspected; some entity records participate in copy/erase | Chest editing, object placement, sign/NPC editors; Entities panel is still a placeholder |
| Grid | GPU implementation committed on the parent branch | Continue regression and UX validation as overlays expand |
| Ruler | Working branch implementation | Finish rendering/performance validation, UX review and broader persistence tests |
| Fill and Place object | Disabled tool entries | Complete behavior and supporting content rules |
| Project layers, schematics library, image conversion, diagnostics and automation | Not established by the inspected implementation | New product areas |

Evidence: [command registry](../../apps/web/src/shell/commands.ts), [Dock](../../apps/web/src/shell/Dock.tsx), [Chest dialog](../../apps/web/src/panels/ChestDialog.tsx), [entity placeholder](../../apps/web/src/panels/placeholders.tsx), [editor contract](../editor.md). Historical milestone status in `architecture.md` is not the feature inventory for this specification.

## Competitive position

Browser operation, local saves, texture preview, image-to-block conversion and a separate structure canvas already exist in TerraWorld. TEdit documents advanced paste transforms, routing, masks and scripting. These belong in the coverage baseline. See the [research matrix](editor-competitive-research.md) for source-specific scope.

Proposed differentiators are complete workflows, to be validated against current competitor versions with the same tasks:

| Proposed advantage | What the user gains | Proof required |
| --- | --- | --- |
| Editable construction projects | Reopen a build with layers, references, dimensions and alternatives intact | Save/reopen preserves the project; export produces the chosen composed result |
| Dimensions that drive a design | Change a room width or column spacing without rebuilding everything | Constrained changes update only related draft geometry and show a tile preview |
| Reusable modules with controlled updates | Change a window design across selected instances | Per-instance overrides survive or appear as explicit conflicts |
| One search-to-edit workflow | Find a problem, inspect it, select matches, preview a fix and undo it | No manual coordinate copying or separate incompatible filter systems |
| Explainable Terraria checks | See why an object, room, circuit or region is problematic | Every warning names the rule, location, supported game version and uncertainty |
| Reviewable changes | Compare versions and restore one region or layer | Chests, wires and entities outside the chosen scope remain intact |
| Construction assistance | Build a blueprint in-game using stages and material counts | Counts reflect the exported composition and distinguish blocks from obtainable items |
| Consistent responsiveness | Keep the editor fluid as design aids accumulate | Repeatable end-to-end measurements across the performance corpus |

None of these rows asserts that every competitor lacks the underlying feature. The target is a demonstrably better combination and execution.

## Workspace and interaction model

### Preserve the editor shell

Keep the map central, the compact tool rail on the left, the options bar above it and the right dock for lists and detailed properties. Retain World, View and Swatches. New Search, Library and History panels should reuse the dock infrastructure. Their final grouping needs a layout prototype before implementation; do not squeeze an unbounded row of tabs into the existing width.

Tools describe pointer actions: draw, select, place, inspect, measure. Panels describe persistent data: results, layers, objects, history, schematics. Commands such as Replace, Export or Run macro do not require permanent tool icons.

Proposed tool families are Navigation, Drawing, Selection, Objects, Terrain, Infrastructure and Annotation. Show frequently used tools directly and group related variants behind a discoverable menu. Every variant remains reachable through the command palette and menus. Full desktop does not mean every option is visible at once.

### Shared interaction contract

- Hover previews; a completed gesture commits one named undoable action. Batch changes preview their affected area and count before commit.
- Escape cancels the active preview or gesture first, then clears the relevant selection. It does not close unrelated work or discard earlier committed changes.
- Right/middle drag pans with every canvas tool. A proposed temporary Space-pan must be checked against keyboard behavior before adoption.
- Inputs have consistent Enter-to-commit and Escape-to-revert behavior. Numeric X/Y/W/H use blocks and make their reference point explicit.
- A selected note or result highlights on the map. Selecting measurements retains the agreed camera centering behavior; list navigation elsewhere should offer a consistent Locate action without repeated camera jumps during text editing.
- Controls keep their positions when modes change. An inapplicable field remains disabled with a short reason where a stable row is useful. Labels, values and sliders never overlap.
- Shortcut modifiers are documented per tool. Preserve Shift-to-rectangle in Ruler; do not silently reuse it for a different ruler constraint. Proposed new modifier assignments need one coordinated shortcut review.
- A tool remembers its own meaningful settings. World-specific notes and project settings are kept with that project; application preferences remain global.
- Labels, legends and selected states remain readable over bright snow, dark caves and dense sprites in both themes. Color alone never conveys validity or a layer's identity.

### Distinguish three kinds of layers

1. **World channels** are Terraria data: blocks, walls, liquids, paint/coatings, wires and entity records. Visibility, edit targeting and protection are separate controls.
2. **Design layers** are editor-owned drafts: shell, furniture, decorations, alternatives and procedural outputs. They compose into Terraria cells with a defined conflict policy.
3. **Annotations** are dimensions, guides, references, labels and regions. They do not alter the world and are omitted from game exports unless explicitly converted to supported content.

Opacity is meaningful for previews, references and overlays. It is not a fractional strength for writing a solid Terraria block. Design-layer blending must not imply that arbitrary Photoshop effects exist in the game format.

### Three document types

- **World document:** existing game data plus editor state. Save As creates a supported game file or paired mod files.
- **Structure project:** a bounded construction canvas with editable layers and components, requiring no loaded world.
- **Portable structure:** a flattened placement artifact plus metadata and dependencies for interchange.

Saving a project preserves editing information. Exporting a world or portable structure composes the chosen content and explains anything omitted. Local autosave is recovery support; it is not a substitute for an explicit portable project file.

## Representative acceptance journeys

### Find and maintain a world

Open a world, find a chest containing a selected item, inspect the matching slots, bookmark its location, change one stack and save a verified copy. Undo restores the original contents. Search results count chests and items distinctly. Reopening the copy confirms the intended change and preservation of unrelated entities.

### Build a measured town

Create a 30 by 18 block house draft, add a roof, lay out three windows with equal gaps, mirror decoration, attach dimensions and save it as a component. Place four copies at a chosen spacing. Change the window style, review affected instances and apply. Reopen the project with its measurements, layers and overrides intact; export a world copy separately.

### Produce survival pixel art

Import an image, choose a target size in blocks and a palette that excludes falling or unavailable materials. Compare map-color and textured previews, adjust dithering, manually fix a face and obtain a material list. Export a blueprint with construction stages or commit the same draft to the world. Image alpha is resolved through an explicit empty/preserve/background choice.

### Repair an affected region

Compare an older world copy to the current file. Restrict the view to a chosen region and inspect changes by channel. Restore walls and furniture from the older copy while retaining the current chest contents where supported. Review conflicts before applying; unsupported partial object restoration is explained and prevented. The result is one undoable transaction.

### Design a mechanism

Place functional objects, route selected wire colors, trace connectivity through supported junctions, name circuits and inspect a possible unintended connection. Save the assembly as a module with connection points. Connectivity checks are available independently of any future game-behavior simulation.

### Publish an adventure map

Organize named regions and progression notes, place signs and reward chests, configure supported world state and create a playtest checkpoint. Record issues at map positions. Export a release candidate with a validation report, map image and optional author notes. Planning links do not create new Terraria quest or scripting mechanics.

### Inspect a modded world

Load matching world companions, see required mods and unsupported content, connect assets and inspect the capability of one object. Editing an unrelated supported region must preserve protected data. Export remains disabled if the selected operation cannot be written and verified without losing unknown data.

## Cross-feature acceptance requirements

### Accuracy and history

All world mutations use a common transaction model covering affected tiles, framing, entity records and metadata. One user action yields one intelligible history entry. Cancel, undo and redo restore complete objects and payloads, not only visible tiles. A shared chronological history is proposed; implementation must resolve the current separate annotation and brush histories and metadata behavior explicitly.

Selections and masks apply consistently across tools. Complete object footprints and supports are considered before edits. Unsupported transforms are never silently approximated. Preview and commit use the same transformation, mask and placement rules.

Coordinate conventions are visible and consistent. Boundary distance 0 to 10 is 10 blocks. An inclusive selection containing tiles 0 through 9 also has width 10. The ruler's raster block count and angle are separately named; Euclidean distance must not return under an ambiguous unit label.

### Reliability and persistence

Recover interrupted work without overwriting the source. Detect when the source file changed externally before replacement workflows. Define dirty state separately for world edits and project annotations. Persist references using explicit project identity and source revision; a renamed file or reused world GUID must not silently attach an incompatible project.

Keep save verification and compatibility behavior from the existing codec contract. A change to seed or progression data is a metadata change unless a separate generation action is chosen. Browser storage exhaustion must leave the last valid recovery state and show an actionable message.

### Proposed performance gates

The numbers below are candidate engineering acceptance budgets, not measured product claims. Pin hardware, browser, build, world and assets before turning them into release gates.

| Workload | Target |
| --- | --- |
| Idle with visible static notes | No continuous frame loop, world scan or repeated GPU upload |
| Grid plus 100 ordinary annotations during pan/zoom | Paired off/on tests show no repeatable missed-frame increase; median frame-time delta at most 3%, p95 delta at most 1 ms on the declared reference machine |
| Overlay CPU work during camera movement | p95 at most 0.5 ms, without rebuilding unchanged geometry |
| Active ordinary tool gesture | Input feedback in the next available frame; tool processing p95 at most 2 ms on the reference workload |
| Stress draft among 100 long saved measurements | Recompute the changed draft only; report total frame, CPU and GPU costs, including buffer assembly/upload |
| Search, fill, conversion or generation | Cancellable background execution; no recurring main-thread task over 50 ms; cancellation acknowledged within 100 ms under the test workload |
| Library and result tables | Only visible rows/thumbnails incur rendering work; scale tests at 10,000 results |
| Closing/switching projects | Release project caches and GPU resources; repeated open/close reaches a stable memory plateau |

Benchmark Small, Medium and Large vanilla worlds, one supported oversized stress world, dense sprites, object-heavy areas, DPR 1 and 2, 1080p and 4K, integrated and discrete graphics, cold and warm caches. Include 0, 10, 100 and 1,000 annotations; visible and offscreen cases; short and world-spanning paths; pan, zoom, drawing and selection.

Use production builds for acceptance. Alternate baseline and feature-enabled runs, warm consistently, repeat at least five times and retain median, p95, p99, long tasks, dropped frames, memory and uploads. A refresh-limited 16.7 ms result alone cannot demonstrate zero GPU cost. Use GPU timing where available and disclose unavailable measurements. Capture browser-composited frames to detect blank terrain and flicker.

### Measurable UX improvement

Run the same representative journeys in pinned TerraWorld, TEdit and our editor. Record completion, time, corrections/undo, mode errors, lost work and participant confidence. Include users familiar with competitors and users new to editors.

Proposed release targets: at least 90% unassisted completion of the basic find/edit/save journey; no lost-work or unintended-area mutation in the scripted acceptance corpus; a 20% reduction in median completion time for at least three selected advanced workflows against the strongest applicable comparator. These are validation targets, not marketing claims before testing.

Keyboard-only paths, 125–200% display scaling, both themes and reduced motion are acceptance cases. Verify stable layout at the existing minimum dock width. Disabled features explain the prerequisite rather than displaying an inaccurate generic message.

## Delivery sequence

The catalog uses four proposed delivery bands. These are dependencies and scope boundaries, not calendar estimates.

| Band | Outcome | Required coverage |
| --- | --- | --- |
| Foundation | Dependable editing platform | Rendering regression closure, common transactions, coordinate/mask contracts, recovery foundation and truthful compatibility |
| A | Complete everyday desktop editor | Basic player search/edit/save; builder draw/select/transform/object workflows; map-author chests/signs/NPCs/world state; basic schematics, pixel-art conversion, wiring and exports |
| B | Advanced creative and maintenance workflows | Persistent design projects, richer selections, precision layout, terrain/biome tooling, filters, history comparison, initial diagnostics, macros and staged mod support |
| C | Deeper differentiation | Linked parametric components, sophisticated construction assistance, advanced rule systems, review packages and scoped simulation where validated |
| Research | Explicit investigation before commitment | Full mod gameplay semantics, unrestricted game simulation, collaborative live editing, cloud community and player-save editor expansion |

Band A is the first complete desktop editing release, not the final competitive coverage claim. Band B closes advanced gaps. Band C adds depth after foundations and actual user testing. Every band must include useful player, builder and map-author journeys.

Recommended first implementation packages after product review:

1. Finish ruler/rendering verification and define shared overlay budgets.
2. Establish transactional edits, history and recovery boundaries.
3. Add reusable selection/mask primitives, fill, replace and dedicated picking.
4. Add validated object placement, entity editors and entity search.
5. Add geometry, transforms, numeric placement and basic schematic files.
6. Complete search/filter-to-edit flows, wiring/liquids and map exports.
7. Add structure projects and image-to-material conversion using the same editing core.
8. Expand into diagnostics, procedural tools, advanced design and mod capabilities.

Parallel issue ownership can be decided later. This specification does not replace existing issue numbers, declare historical milestones complete or schedule work without estimates.

## Dependencies and feasibility boundaries

- Accurate object placement and transformation depend on independently established footprints, anchors, styles, supports and entity serialization.
- Search, diagnostics, replace and generators should share content classification and region queries. Their indexes must update after edits and undo.
- Persistent layers and linked components require a project document and composition model before UI expansion.
- Material costs, housing, biome, spawn and circuit checks require versioned rule data. Unknown rules produce Unknown, not a false pass.
- A blank structure canvas is straightforward product scope; a complete new playable world generator is a separate system.
- Schematics interoperability is versioned and independently implemented from documented contracts and permitted fixtures. Never promise support from a filename extension alone.
- In-game execution remains necessary to validate behavior beyond the supported editor model. A future companion tool is a separate opt-in integration.
- Browser portability and local privacy are product requirements; filesystem integrations may differ by platform. Avoid making direct folder access a prerequisite for ordinary open/edit/download.

## Decisions still open

The following choices are deliberately left as product decisions, not implementation defaults:

| Decision | Proposed direction | Why it needs a decision |
| --- | --- | --- |
| Player save editor | Separate optional product area after world workflows | TerraWorld/TManager coverage extends beyond this repository's world-editor domain |
| Community and cloud | Local libraries and file exchange first | Hosting, moderation, ownership and synchronization create a separate operational product |
| AI-assisted editing | Optional proposal generator behind the same preview/transaction system | Model choice, privacy, cost and quality require a dedicated decision |
| Project and interchange formats | Open versioned project format plus explicit adapters | Editable projects and flattened game exports preserve different information |
| Complete parity boundary | Agree the must-match rows after reviewing the catalog | “Everything competitors have” includes adjacent player, distribution and live-game products |
| Diagnostics and simulation depth | Static validated checks first; bounded simulation later | Gameplay depends on version, player state and mods |
| Display grouping and new shortcuts | Prototype within the existing shell | Avoid repeating unstable controls or conflicting modifier behavior |
| Numeric performance budgets | Adopt after one representative hardware baseline run | The near-zero requirement is confirmed; the exact thresholds are proposed |
| Desktop browser support | Publish a tested browser/platform matrix and file-picker fallback behavior | Desktop-first does not itself select supported browsers, operating systems or filesystem integrations |

Each implementation issue should reference catalog IDs, state supported content/versions, describe the interaction, list dependencies and provide acceptance evidence. The catalog is a comprehensive product backlog; it is not permission to resolve these open decisions silently.
