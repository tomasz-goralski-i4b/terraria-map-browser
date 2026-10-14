/** Every item display goes through these, so item and prefix names drop in later without UI changes (#156). */
export function itemLabel(itemId: number): string {
  return `Item ${String(itemId)}`;
}

export function prefixLabel(prefix: number): string {
  return `Prefix ${String(prefix)}`;
}
import type { SpriteAtlas } from "@studio/assets";
import type { Thumbnail } from "../assets/thumbnails.js";

export function itemThumbnail(_atlas: SpriteAtlas, _itemId: number): Thumbnail | null {
  throw new Error("not implemented");
}
