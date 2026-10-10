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

const queue: (() => void)[] = [];
let pumping = false;

/** Builds queued cells while the idle period lasts (about 8 ms without requestIdleCallback), then yields. */
function pump(): void {
  if (pumping || queue.length === 0) return;
  pumping = true;
  const run = (deadline?: IdleDeadline): void => {
    pumping = false;
    const end = performance.now() + 8;
    do queue.shift()?.();
    while (queue.length > 0 && (deadline === undefined ? performance.now() < end : deadline.timeRemaining() > 1));
    pump();
  };
  if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(run, { timeout: 250 });
  else window.setTimeout(run, 16);
}

/** Queues one cell build for idle time, batching as many as fit in each idle period. */
export function scheduleThumbnail(build: () => void): () => void {
  queue.push(build);
  pump();
  return () => {
    const index = queue.indexOf(build);
    if (index >= 0) queue.splice(index, 1);
  };
}

/**
 * Builds the block and wall cells of every material in a world's palette in idle time, so the Content, Swatches and
 * Inspector panels draw them straight from the cache when opened. Cells for one atlas are kept until it changes.
 */
export function prewarmThumbnails(palette: readonly ContentRef[]): () => void {
  const source = getThumbnailSource();
  if (source === null) return () => { /* Nothing scheduled without an atlas. */ };
  let cancelled = false;
  const cancels: (() => void)[] = [];
  void source.then((ready) => {
    for (const ref of palette) {
      if (cancelled || ref.kind !== "vanilla") continue;
      for (const layer of ["block", "wall"] as const) {
        if (ready.cachedMaterial(layer, ref) !== undefined) continue;
        cancels.push(scheduleThumbnail(() => { if (!cancelled) ready.material(layer, ref); }));
      }
    }
  }).catch(() => { /* Swatches fall back to map colours when framing cannot load. */ });
  return () => { cancelled = true; for (const cancel of cancels) cancel(); };
}
