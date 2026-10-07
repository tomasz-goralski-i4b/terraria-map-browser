import type { RenderableWorld } from "@studio/renderer";
import type { WorldTilesResult } from "@studio/world-codec";

/** What the renderer reads of a loaded world: its planes and palette by reference (nothing is copied). */
export function toRenderableWorld(loaded: WorldTilesResult): RenderableWorld {
  const { width, height, surfaceLevel, rockLevel } = loaded.metadata;
  return { width, height, surfaceY: surfaceLevel, rockY: rockLevel, planes: loaded.planes, palette: loaded.palette };
}
