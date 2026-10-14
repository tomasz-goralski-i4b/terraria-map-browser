import { findSprite, terrariaItems, type SpriteAtlas } from "@studio/assets";
import type { Thumbnail } from "../assets/thumbnails.js";

/** One presentation boundary for known vanilla names and unknown numeric identities. */
export function itemLabel(itemId: number): string {
  const item = terrariaItems.items[itemId];
  return item?.nameStatus === "resolved" ? item.name : `Item ${String(itemId)}`;
}

export function prefixLabel(prefix: number): string {
  const name = terrariaItems.prefixes[prefix];
  return name === undefined || name === "" ? `Prefix ${String(prefix)}` : name;
}

const thumbnails = new WeakMap<SpriteAtlas, Map<number, Thumbnail | null>>();

/** Inventory frames and aliases are observed metadata; pixels come exclusively from the user's atlas. */
export function itemThumbnail(atlas: SpriteAtlas, itemId: number): Thumbnail | null {
  let cache = thumbnails.get(atlas);
  if (cache === undefined) { cache = new Map(); thumbnails.set(atlas, cache); }
  if (cache.has(itemId)) return cache.get(itemId) ?? null;
  const item = terrariaItems.items[itemId];
  const frame = item?.frame;
  const entry = item?.textureId === null || item?.textureId === undefined ? undefined : findSprite(atlas, "item", item.textureId);
  let thumbnail: Thumbnail | null = null;
  if (frame !== undefined && frame !== null && entry !== undefined && frame.x + frame.width <= entry.width && frame.y + frame.height <= entry.height) {
    const page = atlas.pages[entry.page];
    if (page !== undefined) {
      const pixels = new Uint8ClampedArray(frame.width * frame.height * 4);
      for (let row = 0; row < frame.height; row++) {
        const offset = ((entry.y + frame.y + row) * atlas.index.pageSize + entry.x + frame.x) * 4;
        pixels.set(page.subarray(offset, offset + frame.width * 4), row * frame.width * 4);
      }
      thumbnail = { width: frame.width, height: frame.height, pixels };
    }
  }
  cache.set(itemId, thumbnail);
  return thumbnail;
}
