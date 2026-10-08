import { viewWorld, type CanonicalWorld } from "@studio/world-model";
import type { WorldTilesResult } from "@studio/world-codec";

/**
 * The loaded world as a CanonicalWorld over the same plane buffers `toRenderableWorld` reads (nothing is copied).
 * The codec writes only palette indices it has interned, so the per-tile index scan is skipped (`indicesChecked`):
 * creating the view costs O(1), not a pass over every tile on the main thread.
 */
export function toCanonicalWorld(loaded: WorldTilesResult): CanonicalWorld {
  const { width, height } = loaded.metadata;
  return viewWorld(width, height, loaded.planes, loaded.palette, { indicesChecked: true });
}

const views = new WeakMap<WorldTilesResult, CanonicalWorld>();

/** The one CanonicalWorld view of a loaded world, created on first use and shared by every panel. */
export function canonicalWorldOf(loaded: WorldTilesResult): CanonicalWorld {
  let view = views.get(loaded);
  if (view === undefined) {
    view = toCanonicalWorld(loaded);
    views.set(loaded, view);
  }
  return view;
}
