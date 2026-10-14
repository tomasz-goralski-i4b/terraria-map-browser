# Right-side art generation

Generated with the built-in ImageGen tool on 2026-10-14. These prompts describe the earlier right-side concepts. Their masters are not retained (see [branding.md](../branding.md)); the active master is `world-art-right-matched-b-master.png`, described in [matched-pair-prompt.md](matched-pair-prompt.md). The application derivative is `apps/web/src/brand/world-art-right.webp`. Both use genuine RGBA transparency. The tree correction uses the user's two screenshots of bare boreal trees; those private reference files are not copied into the repository.

## Visual references

The references informed silhouettes and biome details, not shipped sprites. Screenshot files stay in ignored `.tdd/brand-references/` and are never included as application assets.

- [Official Wiki: Floating Island](https://terraria.wiki.gg/wiki/Floating_Island): cloud underside and sky-building material language.
- [Official Wiki: Snow biome](https://terraria.wiki.gg/wiki/Snow_biome): snow surface and boreal vegetation.
- [Classic floating-island screenshot](https://steamcommunity.com/sharedfiles/filedetails/?id=2724317960): flat terrain and modest building scale.
- [Snow-biome screenshot](https://pinion.jp/%E3%82%AC%E3%82%A4%E3%83%89/%E3%83%86%E3%83%A9%E3%83%AA%E3%82%A2-%E5%85%A8%E3%83%90%E3%82%A4%E3%82%AA%E3%83%BC%E3%83%A0%E8%A7%A3%E8%AA%AC/): terrain reference. Its conifer tree type was superseded by the user's explicit bare-boreal-tree reference.
- The left-side illustration at the time: style reference for pixel scale, textures, contrast and blueprint rendering.

## Initial revised composition

```text
Use case: stylized-concept.
Asset type: ORIGINAL transparent portrait illustration, RIGHT companion to a world-editor's existing left art, 2:3 canvas.
Input images:
1. Actual Terraria screenshot of a floating island: reference ONLY for flat orthographic 2D terrain, small tile scale, slender trees and modest rectangular building proportions. Do not copy screenshot pixels or HUD.
2. Actual Terraria screenshot of snowy surface: reference ONLY for rolling stepped snow-covered hills and Terraria's slim boreal trees with sparse snow-capped foliage. Do not copy sprites.
3. Existing left branding illustration: reference ONLY for polish, palette and overall decorative pixel-art finish, but PRIORITIZE the actual game screenshots' flat 2D appearance over glossy fantasy concept-art shapes.
Primary composition: upper 25% of the portrait shows one small unmistakably Terraria-like FLOATING ISLAND: a shallow flat grassy earth strip resting on a SOLID BANK OF CLOUD BLOCKS, pale white and blue rounded cloud masses form the main underside, NOT a dangling jagged rock mountain. A compact simple rectangular golden-yellow and pale-blue sky shrine, Sunplate/Skyware-inspired color language, with one understated flat blue roof, square door and windows; no huge pointed roofs, turret, cross, pagoda, or fantasy cathedral. One slender small tree. A tiny unfinished edge of the sky shrine transitions into a blue architectural plan, subtly linking to world editing.
Middle 35-40%: truly EMPTY TRANSPARENT AIR. No clouds, atmospheric gradient or connecting objects in this large gap.
Lower 35-40%: a SNOWY HILL / small rising mountain slope, viewed from the SIDE. Solid continuous ground, an asymmetrical gently peaked stepped silhouette with one slope rising from left to right, thick soft white snow cap, slate gray-blue soil/ice strata. Three slender Terraria-like boreal trees with long thin trunks and sparse horizontal branches capped with irregular small snowy leaf clusters; NOT idealized triangular Christmas trees. A few small snow plants. Only shallow visible terrain depth below the slope, mostly solid filled earth, NO CAVE, no huge hollow, no glowing crystals, no underground lake, no mine infrastructure. This should read as a winter landscape hill, not a second floating cavern chunk.
Rendering: fine crisp flat 2D pixel art with small clusters and a limited color palette. Natural squared terrain steps and slim sprite-like silhouettes. 2-3 tone shading, not glossy 3D. Every form drawn in strict side elevation, no visible top faces or isometric cubes. Keep the landscape flatter and simpler than the earlier AI concept.
Background: GENUINELY TRANSPARENT alpha outside both scenes and across the entire empty middle; no black matte, no gradient glow, no rectangular vignette. Preserve internal opaque terrain. Soft short alpha edges only. Safe transparent margins. Attractive and legible at 280 by 420 pixels.
Constraints: no text, labels, HUD, game characters, watermarks, logos, copied sprites, cube foliage, caves, bright crystal grotto. Two original distinct scene silhouettes on one transparent tall canvas.
```

## Final tree and style correction

```text
Use case: precise-object-edit.
Asset type: final RIGHT companion illustration in a matched pair for Terraria Map Studio, transparent RGBA portrait 2:3.
Input image 1: EDIT TARGET, right illustration with floating cloud island and snowy rising hill. Preserve its two-scene composition, sky shrine, grass strip on cloud underside, big transparent air gap, and SOLID snowy hill.
Input image 2: LEFT companion, definitive STYLE REFERENCE. Match this image's pixel cluster size, detail density, dark outlines, subtle 2-3 tone shading, earthy/slate texture, blueprint line treatment and amber lamps. The pair must look drawn by the same pixel artist at the same resolution. Avoid the overly saturated chunky embossed toy blocks in image 1; the blue/gold sky shrine should have the same restrained flat pixel rendering as image 2's cottage.
Input image 3: recent in-game Terraria SNOW TREE REFERENCE. Use the foreground snow-covered conifer trees, not the background forest. These have long slim exposed brown trunks, small tiers of NEEDLE BRANCHES, dark blue-green evergreen foliage, delicate snow on the tips, and a compact pointed/multi-tiered evergreen crown. NOT round leafy broccoli canopies covered with snow. Do not copy sprite pixels.
Required changes:
1. Replace ALL THREE snowy hill trees with original Terraria-like boreal snowy CONIFERS following image 3: slender trunks, short needle-branch tiers and small pointed crowns, varied sizes. They must immediately read as snow biome trees, different from the leafy green tree on the floating island.
2. Unify pixel-art rendering with image 2. Crisp deliberate small square clusters, finely detailed but flat side elevation, no glossy 3D, no beveled cube blocks. Match terrain scale and tonal contrast, do not change image 2.
3. Preserve genuinely transparent exterior and empty middle gap. No opaque backdrop, no broad painted halo, no vignette rectangle. Any local lamp glow uses only short translucent alpha.
Keep: snowy rising hillside as solid ground WITHOUT caves, no underground pools or crystals. Floating island at top with cloud bank and compact gold/pale-blue shrine, one small unfinished blue blueprint extension. Transparent margins and generous EMPTY middle. Keep the right scene's cooler snowy palette to complement the left's warm Hell.
Constraints: no UI, text, characters, labels, watermark, copied game textures or sprites. Original pixel-art illustration, strict orthographic side view, matching left illustration in style.
```

## Left-side transparency edit

```text
Use case: background-extraction.
Edit target: the provided portrait illustration of a tile world, with green surface and unfinished cottage/blueprint, blue caves in the middle and lava Hell at the bottom.
Primary request: Remove the solid charcoal BACKGROUND OUTSIDE the world silhouette and make it truly TRANSPARENT. Deliver RGBA with genuine alpha, no solid or checkerboard background. Preserve the complete original illustration, exactly the existing cottage, tree, blueprint, terrain, internal cave walls and dark chambers, pools, lava and Underworld arch. Keep the same portrait composition and proportions.
Transparency details: The empty external space above, to the sides and below the terrain must be transparent; also transparent between upper tree/house/blueprint outlines. Preserve the dark shading INSIDE the caves and Hell, do not punch transparency into internal terrain/chambers. A gentle short feather of semi-transparent alpha along the outer silhouette, and translucent glow beyond the lava edges, should let it blend into BOTH a dark charcoal UI and a pale gray UI without a visible rectangular frame. Upper atmospheric clouds can be removed or left very faint and semi-transparent, never dark opaque patches.
Constraints: no changes to subject, biomes, colors, pixel-art style, or architecture. Do not add editing handles or measurement lines in this pass. No text, no logos, no new features, no border, no black matte, no rectangular vignette. Output the final transparent portrait cutout only.
```
