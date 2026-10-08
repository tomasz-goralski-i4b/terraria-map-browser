import { viewWorld, type CanonicalWorld } from "@studio/world-model";
import type { WorldTilesResult } from "@studio/world-codec";

/** The loaded world as a CanonicalWorld over the same plane buffers `toRenderableWorld` reads (nothing is copied). */
export function toCanonicalWorld(loaded: WorldTilesResult): CanonicalWorld {
  const { width, height } = loaded.metadata;
  return viewWorld(width, height, loaded.planes, loaded.palette);
}

const views = new WeakMap<WorldTilesResult, CanonicalWorld>();

/**
 * The one CanonicalWorld view of a loaded world, created on first use. `viewWorld` validates every block and wall
 * index, a full pass over the planes, so the chrome creates it lazily (first hover) and shares it, instead of each
 * panel paying that pass on the main thread while the world is being shown.
 */
export function canonicalWorldOf(loaded: WorldTilesResult): CanonicalWorld {
  let view = views.get(loaded);
  if (view === undefined) {
    view = toCanonicalWorld(loaded);
    views.set(loaded, view);
  }
  return view;
}
