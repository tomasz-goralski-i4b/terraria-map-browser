import type { RenderableWorld } from "@studio/renderer";
import type { WorldTilesResult } from "@studio/world-codec";

/**
 * What the renderer reads of a loaded world: its planes and palette by reference (nothing is copied), the header's
 * tree-style zones and tree top variations, which pick tree tops (docs/assets.md, "Trees"), and its underground
 * background settings ("Cave backgrounds").
 */
export function toRenderableWorld(loaded: WorldTilesResult): RenderableWorld {
  const { width, height, surfaceLevel, rockLevel, worldId } = loaded.metadata;
  const { treeX, treeTopVariations, caveBackX, caveBackStyles, iceBackStyle, jungleBackStyle, hellBackStyle } = loaded.details.generation;
  return {
    width, height, surfaceY: surfaceLevel, rockY: rockLevel, planes: loaded.planes, palette: loaded.palette,
    trees: { treeX, treeTopVariations },
    caves: { caveBackX, caveBackStyles, iceBackStyle, jungleBackStyle, hellBackStyle, worldId },
  };
}
