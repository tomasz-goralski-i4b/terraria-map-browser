# Terraria editor competitive research

Reviewed 2026-10-12. This document supports the [product specification](editor-product-spec.md) and [feature catalog](editor-feature-catalog.md).

TerraWorld and TEdit are the primary comparisons. Their documented capabilities establish a substantial baseline: browser delivery, texture rendering, reusable builds, image conversion, masks, routing and scripting cannot each be presented as a unique advantage without a narrower demonstrated claim.

Evidence below is from official product documentation and publisher pages. Documented means the publisher describes the capability; it does not mean this research independently validated correctness, performance or every supported version. Unverified capabilities are left unclassified rather than treated as absent. Release and UX comparisons should pin actual builds and repeat the same user tasks.

## Direct and adjacent competitors

| Product | Relevant documented capabilities | Implication for Terraria Map Studio |
| --- | --- | --- |
| TerraWorld | Browser world/player editing, local processing, textured viewing, world search and supported modded workflows. [Product overview](https://terraworld.dev/en) | Local browser operation and a texture view are baseline expectations. Player editing is an adjacent scope decision. |
| TerraWorld Structure Studio | Independent structure canvas, shared editing tools and design layers; exported structure packages flatten the visible result. [Structure Studio guide](https://terraworld.dev/en/guide/design-terraria-builds-with-structure-studio) | A separate building canvas and layers are baseline. Preserving a complete editable project across exchange is a concrete area to evaluate for improvement. |
| TerraWorld search | Multiple content modes, chest-item lookup, map highlights and optional smart region grouping. [Search guide](https://terraworld.dev/en/guide/search-and-highlight-terraria-world) | Compare result usefulness, exact versus grouped results and how easily a search becomes a scoped edit. |
| TerraWorld pixel art | Image conversion with output dimensions, palette choices, paint-aware Real Art and placement through clipboard. [Pixel art guide](https://terraworld.dev/en/guide/create-terraria-pixel-art-from-an-image) | Compete through controllable materials, preview accuracy, responsiveness and construction assistance. |
| TerraWorld mod support | Paired files, local mod sources and operation-specific restrictions; displaying content does not automatically allow editing it. [Mod support guide](https://terraworld.dev/en/guide/tmodloader-support) | Transparent capability levels are necessary. Avoid a single misleading supported/unsupported badge. |
| TEdit 5 | Drawing, fills, object/point tools, biome conversion, selection, paste transforms, wire tracing and hammering. [Toolbar documentation](https://docs.tedit.dev/interface/toolbar/) | Match practical editing coverage and test real object correctness, not just geometric appearance. |
| TEdit 5 advanced editing | Routed infrastructure, brush options, backups and improved search/filter interfaces are documented. [TEdit 5 changes](https://docs.tedit.dev/whats-new/) | CAD-like routing and convenient batch workflows belong in the coverage target. |
| TEdit panels and automation | Entity/world panels, schematics, analysis, find/filter and scripting are documented. [Panel overview](https://docs.tedit.dev/sidebar-panels/overview/), [scripting guide](https://docs.tedit.dev/advanced/scripting-guide/) | A mature editor needs inspection and automation paths alongside drawing tools. |
| TerraMap | Interactive world viewing and locating blocks, ores, chest items, dungeons and NPCs. [Official repository overview](https://github.com/TerraMap/terramap.github.io) | Evaluate lightweight exploration as its own complete workflow; editing power must not make ordinary finding cumbersome. |
| TManager | Publisher lists save discovery/import/sharing, player editing, world analysis and a map viewer. [Publisher listing](https://play.google.com/store/apps/details?hl=en_GB&id=com.jbro129.tmanager) | Discovery and save management serve a different audience from precision construction. Do not assume full world-editor parity from these claims. |
| DragonLens and in-game utilities | DragonLens describes a customizable tModLoader utility/debugging environment. [Publisher description](https://steamcommunity.com/sharedfiles/filedetails/?id=2939737748) | In-game tools provide runtime context an offline editor lacks. A future companion should serve a specific validation or interchange need. |

Product documentation can change independently of releases. In particular, current TEdit 5 documentation is the intended benchmark; archived TEdit 4 material should not be used to claim that modern TEdit lacks a feature.

## Practical competitive coverage

The table identifies the baseline to implement or improve. It does not claim exhaustive product parity.

| Workflow | Documented reference | Required outcome in our editor | Catalog coverage |
| --- | --- | --- | --- |
| Find content and move through useful results | TerraWorld Search; TEdit Find; TerraMap | Correct counts, located results, scope and reusable queries | NAV-03 through NAV-06 |
| Draw and modify terrain | TEdit tools; TerraWorld Structure Studio tool list | Brush, fill, erase, shapes, masks and complete undo | SEL, DRAW, MAT |
| Place and edit furniture/data | TEdit object and entity tools | Correct footprints, styles, supports and attached records | OBJ |
| Reuse a build | Both primary competitors | Reliable library, import/export, placement and transforms | LIB-01 through LIB-04 |
| Design without a world | TerraWorld Structure Studio | Dedicated editable construction project | LIB-05 through LIB-08 |
| Convert image to a build | TerraWorld Pixel Art | Controlled material mapping, useful previews and editable output | ART |
| Plan wiring and routes | TEdit routing and trace | Supported connectivity, routing and correct infrastructure framing | SYS-03 through SYS-08 |
| Inspect and change world settings | Both primary competitors | Complete supported values, validation and clear consequences | MAP-01, QA-01 |
| Automate repeated edits | TEdit scripting | Discoverable recipes and optional advanced automation | AUTO |
| Work with modded data | TerraWorld mod support | Explicit per-operation capability and preservation | MOD |
| Recover and review work | TEdit backups; TerraWorld recovery guidance | Portable projects, checkpoints, diff and selective restore | FILE, QA |
| Prepare output for another person | Both primary competitors' structure/export workflows | Portable artifacts with dependencies and optional plans | OUT |

The next parity audit should also examine exact selection behavior, object/style coverage, supported formats, maximum practical operation sizes, entity transformations, export fidelity and cold-start behavior. A toolbar screenshot is insufficient evidence for those details.

## Design patterns from specialist tools

The adaptations below are proposed product choices. They borrow interaction concepts rather than source code, asset tables or unrestricted promises about Terraria mechanics.

| Reference | Documented pattern | Terraria adaptation | Relevant users |
| --- | --- | --- | --- |
| Aseprite | Movable horizontal/vertical symmetry axes, including between or through pixels. [Symmetry](https://www.aseprite.org/docs/symmetry/) | Mirror a castle around a central block or the gap between two columns | Builders, pixel artists |
| Aseprite | Palette-based shading and reusable tilemap cells. [Shading](https://www.aseprite.com/docs/shading/), [tilemaps](https://www.aseprite.org/docs/tilemap/) | Material/paint shading ramps and repeating patterns with stable palette identities | Pixel artists, decorators |
| Krita | Multiple related brush instances and interval repetition. [Multibrush](https://docs.krita.org/en/reference_manual/tools/multibrush.html) | Repeated pillars, ornamentation and patterned decoration with bounded previews | Builders, terrain artists |
| Krita | Movable reference images with opacity and embedded/external storage. [Reference images](https://docs.krita.org/en/reference_manual/tools/reference_images_tool.html) | Calibrated blueprint references stored with a construction project | Survival builders, artists |
| Inkscape | Temporary alignment guides, equal-distance snapping and numerical placement origins. [Inkscape 1.2 release notes](https://wiki.inkscape.org/wiki/Release_notes/1.2#Alignment_and_Distribution_snapping) | Align windows or objects and display exact block gaps during placement | Architectural builders |
| FreeCAD | Geometric and dimensional constraints for editable sketches. [Official constraint tutorial](https://github.com/FreeCAD/FreeCAD-documentation/blob/main/wiki/Sketcher_Micro_Tutorial_-_Constraint_Practices.md) | A limited set of driving dimensions for draft rooms, roofs and arches | Precision builders |
| Figma | Components, variants and reusable component properties. [Component documentation](https://help.figma.com/hc/en-us/sections/4403935997847-Components) | Linked building modules with material variants and explicit per-instance overrides | Town builders, schematic authors |
| Tiled | Stamp-based editing, annotation objects and selection tools. [Introduction](https://docs.mapeditor.org/en/stable/manual/introduction/) | Shared editing tools plus named planning regions and reusable construction fragments | Builders, map authors |
| Tiled | Rules match existing input patterns and generate output tiles. [Automapping](https://docs.mapeditor.org/en/latest/manual/automapping/) | Scoped decoration and correction recipes with preview and deterministic rule order | Terrain artists, power users |
| LDtk | Entities with typed, constrained fields and visual representations. [Entity documentation](https://ldtk.io/docs/general/editor-components/entities/) | Friendly validated editors for supported game entities and typed project-only annotations | Map authors, mod authors |

## Opportunities to test

### Retain the editable source of a build

A portable project can keep dimensions, layers, references, generation parameters and component relationships through save/reopen and exchange. Test whether users can revise a design after a week without reconstructing how it was made. The game export remains a discrete composition of supported Terraria data.

### Make repetitive construction predictable

Combine numeric geometry, align/distribute, symmetry, arrays and controlled component updates. The evaluation task should be a real structure, such as a town with repeated houses and a later material change, rather than isolated demonstrations of individual controls.

### Connect exploration with maintenance

Reuse one query across map highlights, selected results, validation and replacements. Evaluate a real maintenance job: locate unwanted material inside a protected-region boundary, inspect affected objects, apply a scoped fix and verify the saved result.

### Explain functional uncertainty

Offer located explanations for supported object, housing, circuit and compatibility checks. Separate a verified rule failure from an approximation or unknown rule. This creates value only if warnings are precise enough to act on and do not overstate the model's knowledge.

### Help users build in the actual game

Material lists, stages, dimensioned plans and selectable substitutions support survival builders who use the editor as a design tool. Test whether the output is usable without a custom runtime mod and whether item counts match complete objects rather than raw footprint cells.

## Comparison protocol

1. Pin product versions, platform/browser, hardware and local test worlds. Record features that require extra assets or plugins.
2. Run find/edit/save, measured construction, image conversion, mechanism layout and schematic reuse tasks with equivalent inputs.
3. Measure setup time separately from steady editing. Include cold/warm assets, large worlds and crowded scenes.
4. Record completion, time, errors, undo/corrections, scope mistakes and confidence; compare against the strongest relevant product for each task.
5. Inspect saved outputs and reopen them. Visual preview alone does not prove correct world serialization or game behavior.
6. Treat a feature advantage as provisional until tested. Do not infer competitor absence from undocumented behavior.

This research does not establish that our current editor is faster or easier than any competitor. It establishes what to cover and how to substantiate a future claim.
