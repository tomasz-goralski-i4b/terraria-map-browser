import type { CanonicalWorld } from "@studio/world-model";
import type { WorldTilesResult } from "@studio/world-codec";

/** The loaded world as a CanonicalWorld over the same plane buffers `toRenderableWorld` reads (nothing is copied). */
export function toCanonicalWorld(_loaded: WorldTilesResult): CanonicalWorld {
  throw new Error("not implemented");
}
