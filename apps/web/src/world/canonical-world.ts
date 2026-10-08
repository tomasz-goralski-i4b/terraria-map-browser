import { viewWorld, type CanonicalWorld } from "@studio/world-model";
import type { WorldTilesResult } from "@studio/world-codec";

/** The loaded world as a CanonicalWorld over the same plane buffers `toRenderableWorld` reads (nothing is copied). */
export function toCanonicalWorld(loaded: WorldTilesResult): CanonicalWorld {
  const { width, height } = loaded.metadata;
  return viewWorld(width, height, loaded.planes, loaded.palette);
}
