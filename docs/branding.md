# Brand assets

Terraria Map Studio uses a stepped world section that also reads as an M, with a detached editable tile. The start-screen illustration expands the same motif into terrain, caves and construction plans. The cobalt and mint palette follows the compact editor's existing accents; neutral chrome and system typography remain the foundation.

These are original AI-generated illustrations, not extracted Terraria assets. Generated with the built-in ImageGen tool on 2026-10-14. The mark has genuine alpha transparency. Keep the image text-free; render the product name as accessible application text.

## Files and usage

- [Original mark](branding/mark-master.png): full-resolution transparent source.
- [Selected left illustration: concept B](branding/concepts/b-hellevator.png): surface workshop, planned hellevator, ordinary stone caves and open Underworld with lava and an obsidian structure. This is the final pixel-art style reference for the pair.
- [Matched right illustration](branding/world-art-right-matched-b-master.png): cloud island with a selected terrain parcel and displaced ghost copy, empty air, and a snowy hillside with bare, snow-capped boreal trees. Pixel scale, shading and textures follow concept B. Earlier masters remain as concepts.
- [Opaque portrait source](branding/world-art-portrait-master.png): retained input to the background-removal edit.
- [Earlier landscape concept](branding/world-art-master.png): retained source for the previous version.
- Runtime illustration and mark: `apps/web/src/brand/`; browser and install icons: `apps/web/public/brand/`.
- `mark.png`: 256px transparent mark for the toolbar and start title.
- `favicon-16.png`, `favicon-32.png`: tab icons.
- `icon-192.png`, `icon-512.png`: transparent PWA icons.
- `icon-maskable-512.png`: charcoal background with the mark kept within the central mask-safe area.
- `apple-touch-icon.png`: 180px charcoal-backed iOS icon.
- `world-art-portrait-transparent.webp`: 768 × 1152px active RGBA derivative of selected concept B on the left of the world chooser. Decorative, with empty alt text. Removed with the start screen when a world is open. Earlier portrait and landscape files are retained as concepts.
- `world-art-right.webp`: 768 × 1152px RGBA companion on the right, showing terrain selection/movement above a solid snowy hill. The left artwork shows construction; the right shows another editor tool. Hidden on phone widths to keep controls accessible.

The desktop start screen centers the chooser content itself within the map area; the illustrations occupy the available space on either side. Folder worlds and recent worlds use adjacent columns. Populated eight-entry lists are tested at 1280 × 720 in both themes. Shorter or phone layouts retain vertical scrolling when needed rather than clipping controls. The illustrations scale down with the side margins on narrower desktop windows.

PNG derivatives use Lanczos resampling. The illustrations use WebP quality 88 and retain source alpha. Original outputs are retained for future exports. Outside the portrait's silhouette, transparency blends the illustration into both editor themes; cave interiors retain dark shading. Both assets are precached for offline use. No animation or map-renderer changes.


### Portrait revision

```text
Use case: stylized-concept.
Asset type: portrait 2:3 illustration for LEFT SIDE of Terraria Map Studio's world chooser.
Reference image 1: earlier landscape art, reference only for cool blue/mint palette, underground cutaway and unfinished architecture concept. Recompose completely for portrait. Change the visual style substantially.
Primary request: original exquisite 2D SIDE-VIEW PIXEL ART fantasy world section under construction. A slender surface hill in the upper third with one elegant asymmetrical timber-and-stone cottage only partly completed; its right wing is a precise blue wireframe blueprint with a few selected square tiles hovering beside it. Below, a deep vertical cutaway: earthy strata, organically irregular winding caves, narrow timber platforms and tiny glowing underground pools, descending to blue crystal grotto at the bottom. A tall thin-trunk tree with delicate irregular leafy canopy, small shrubs, hanging roots and vines. A subtle suggestion of exploration and precise world building.
Style: faithful to the visual LANGUAGE of Terraria's richly detailed flat side-on 2D pixel landscapes, while all scenery and pixel art are original. Fine hand-placed-looking pixel clusters, 2-3 tone sprite shading, graceful silhouettes, small tile scale, natural soil edges, thin trunks and organic foliage. Orthographic front elevation. Strictly no visible top or side faces, no cubic voxel blocks, no LEGO chunky square trees, no Minecraft look, no 3D render, no isometric perspective, no low-poly.
Composition: tall 2:3 canvas. One connected slender world cross-section occupies the central 80% of height and 85% of width. Surface at top, depth below. Quiet charcoal #0d0f12 backdrop and generous negative space around the silhouette. Keep the whole world visible, nothing cropped. Strong main shapes legible at 280x440 pixels, fine decorative pixel detail.
Palette: natural muted earth browns, slate caves, mint greenery, cobalt and pale-blue water/blueprint, very sparse warm amber window lights. Dark background fades naturally at image edges. Beautiful understated atmosphere.
Constraints: NO text, no logo, no UI, no frames, no watermark, no character, no weapon, no official game assets or copied sprites. Do not paste or squeeze the old landscape. Produce a finished original portrait composition.
```

### Depth biome edit

```text
Use case: precise-object-edit.
Edit target: attached portrait world cutaway. Preserve the excellent upper surface with delicate trees and unfinished cottage transitioning into blue architectural wireframe, preserve the original flat side-on pixel-art style, portrait proportions, charcoal exterior, palette at the top and the world construction concept.
Requested edit: Give the world a clear Terraria-like sequence of THREE depth biomes, all original artwork. Top: green surface with the existing cottage under construction. Middle roughly from 35% to 70% of the total canvas: earth caves turning into slate stone caverns, a few blue pools/crystals and timber mining platforms. BOTTOM 25-30%: unmistakable HELL / UNDERWORLD biome instead of another blue crystal cave. Show craggy charcoal-black obsidian and ash, an open underground chamber with a horizontal glowing molten orange-red lava lake, a small dark ruined brick arch/bridge, subtle red embers and heat lighting. The transition into Hell should be geological and seamless, part of one connected world section; warm lava at the bottom contrasts beautifully with cool caves above.
Composition: Keep the entire world visible inside the portrait canvas, fit on the left of a compact editor world chooser at 280x440px. All three biomes must be recognizable at that small size. Simplify a little if needed. Blue water ends ABOVE the Hell layer, never flows into lava. Maintain restrained pixel-art lighting, no excessive fire explosion.
Constraints: no text, no labels, no characters, no copied Terraria sprites, no Minecraft cubic voxels, no 3D or isometric perspective. Do not change the upper cottage, blueprint, tree, or world silhouette more than needed. Final standalone portrait illustration only.
```


## Generation prompts

### Mark

```text
Use case: logo-brand.
Asset type: original standalone app emblem, transparent square PNG, for Terraria Map Studio, a precise local 2D tile world editor, favicon and 18-24px toolbar mark.
Primary request: Design a striking, exceptionally simple original geometric emblem: a squared U-shaped cutaway terrain / architectural section formed from bold cobalt blue rectangular blocks, with a stepped turquoise-green surface across its upper interior, and a single detached small square tile poised at the upper right, implying selection and building. The negative space through the middle suggests a cavern and a subtle letter M. Make one coherent flat silhouette, instantly recognizable at 16px. This is a world-section editing studio identity, not a game logo.
Style: disciplined Swiss geometric symbol fused with block-world geometry. Strict right angles, large flat shapes, three solid colors max. Blue #2f6fe0, bright light blue #86b4ff, muted mint #6fcf8a. No fine grid or texture. Thick masses and open negative space. Polished optical balance.
Composition: one centered symbol filling 85 percent of square canvas, generous consistent safety margins, genuine transparent exterior and interior negative spaces. No badge, no background.
Constraints: no words, no lettering, no watermark, no tree logo, no pickaxe, no compass, no globe, no official Terraria sprites or imagery, no gradients, no glow, no shadows, no 3D, no thin lines. Produce just the final mark, not a brand presentation sheet.
```

### Start illustration

```text
Use case: stylized-concept.
Asset type: premium original landscape illustration for the world-selection start screen of Terraria Map Studio, a professional compact desktop tile-world editor.
Input image 1: reference for brand motif and palette only, not an edit target. Extend its stepped world cross-section, detached square tile, blue/mint palette into an atmospheric original illustration.
Scene: a carefully composed SIDE-ON 2D CUTAWAY of a small fantasy tile world as a wide floating rectangular section. The silhouette has stepped grassy hills descending into a central valley and rising again, subtly echoes the M brand. Above, a few stylized trees and a tiny elegant builder's stone-and-timber observatory. Below, stratified slate earth, winding dark caves, luminous blue underground pools and tiny mineral deposits. On the right the actual terrain transitions into a sparse cobalt architectural blueprint grid with a partly constructed arch and a few detached luminous square tiles, suggesting deliberate editing, selection and construction.
Style: refined editorial pixel-inspired illustration, crisp squared tile edges and restrained painterly shading within large forms, beautiful art direction, 2D orthographic front elevation, NOT an isometric cube. A memorable designed landscape, not a screenshot. Original invented scenery, no copied game sprites.
Composition: wide approximately 3:1 panorama, subject centered with breathing space all around. Terrain occupies middle 70 percent of width, clean dark charcoal #0d0f12 background, edges fall gently into background. Subtle cool moonlit atmosphere with a few warm amber windows, not neon sci-fi. Clearly legible main terrain masses at 760 by 220 pixels; detail supports rather than crowds.
Palette: dominant slate charcoal, restrained cobalt #2f6fe0 and pale blue #86b4ff, mint greenery #6fcf8a, desaturated earth, tiny warm amber accents. Matches neutral compact editor chrome.
Constraints: NO text, logos, labels, UI, mockups, frames, characters, weapons, pickaxes, official Terraria tree/logo or game assets, dragons, floating planets, lens flares, purple cyberpunk. Produce one finished landscape art only.
```
