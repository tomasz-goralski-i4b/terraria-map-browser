import type { RenderableWorld } from "@studio/renderer";
import type { WorldTilesResult } from "@studio/world-codec";

/**
 * What the renderer reads of a loaded world: its planes and palette by reference (nothing is copied), and the header's
 * tree-style zones and tree top variations, which pick tree tops (docs/assets.md, "Trees").
 */
export function toRenderableWorld(loaded: WorldTilesResult): RenderableWorld {
  const { width, height, surfaceLevel, rockLevel } = loaded.metadata;
  const { treeX, treeTopVariations } = loaded.details.generation;
  return {
    width, height, surfaceY: surfaceLevel, rockY: rockLevel, planes: loaded.planes, palette: loaded.palette,
    trees: { treeX, treeTopVariations },
  };
}
