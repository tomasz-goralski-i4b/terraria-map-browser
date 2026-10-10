import type { SpriteAtlas } from "@studio/assets";
import { getDefaultAssetSession, useAssetStore } from "./asset-session.js";
import { getBlockFraming } from "../world/block-framing.js";
import { ThumbnailSource } from "./thumbnails.js";

let current: { readonly atlas: SpriteAtlas; readonly source: Promise<ThumbnailSource> } | null = null;

useAssetStore.subscribe((state) => {
  if (state.status.kind !== "ready") current = null;
});

/** Called from idle effects only; reconnecting owns a fresh cell cache. */
export function getThumbnailSource(): Promise<ThumbnailSource> | null {
  if (useAssetStore.getState().status.kind !== "ready") return null;
  const atlas = getDefaultAssetSession().getAtlas();
  if (atlas === null) return null;
  if (current?.atlas !== atlas) current = { atlas, source: getBlockFraming().then((framing) => new ThumbnailSource(atlas, framing)) };
  return current.source;
}

/** One visible cell per idle callback, including in browsers without requestIdleCallback. */
export function scheduleThumbnail(build: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const handle = window.requestIdleCallback(build);
    return () => { window.cancelIdleCallback(handle); };
  }
  const handle = window.setTimeout(build, 16);
  return () => { window.clearTimeout(handle); };
}
