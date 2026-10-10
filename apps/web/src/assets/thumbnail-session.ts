import type { SpriteAtlas } from "@studio/assets";
import type { BrushContentLayer, ContentRef } from "@studio/world-model";
import { getDefaultAssetSession, useAssetStore } from "./asset-session.js";
import { getBlockFraming } from "../world/block-framing.js";
import { ThumbnailSource, type Thumbnail } from "./thumbnails.js";

let current: { readonly atlas: SpriteAtlas; readonly source: Promise<ThumbnailSource>; ready: ThumbnailSource | null } | null = null;

useAssetStore.subscribe((state) => {
  if (state.status.kind !== "ready") current = null;
});

/** Called from visibility effects only; reconnecting owns a fresh cell cache. */
export function getThumbnailSource(): Promise<ThumbnailSource> | null {
  if (useAssetStore.getState().status.kind !== "ready") return null;
  const atlas = getDefaultAssetSession().getAtlas();
  if (atlas === null) return null;
  if (current?.atlas !== atlas) {
    const source = getBlockFraming().then((framing) => {
      const ready = new ThumbnailSource(atlas, framing);
      if (current?.source === source) current.ready = ready;
      return ready;
    });
    current = { atlas, source, ready: null };
  }
  return current.source;
}

/** Reads existing pixels synchronously; never starts framing, decoding or an idle job. */
export function cachedMaterialThumbnail(layer: BrushContentLayer, ref: ContentRef): Thumbnail | null | undefined {
  if (useAssetStore.getState().status.kind !== "ready" || current?.ready === null || current === null) return undefined;
  if (current.atlas !== getDefaultAssetSession().getAtlas()) return undefined;
  return current.ready.cachedMaterial(layer, ref);
}

/** One visible cell per idle callback, including in browsers without requestIdleCallback. */
export function scheduleThumbnail(build: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(build, { timeout: 250 });
    return () => { window.cancelIdleCallback(handle); };
  }
  const handle = window.setTimeout(build, 16);
  return () => { window.clearTimeout(handle); };
}
