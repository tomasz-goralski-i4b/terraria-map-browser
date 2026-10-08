import type { ContentRef, Tile } from "@studio/world-model";

export type ContentLayer = "block" | "wall";

/** A palette entry as the UI names it until vanilla names ship: its layer and id (mod content by its key). */
export function contentName(ref: ContentRef, layer: ContentLayer, _frame?: Pick<Tile, "frameX" | "frameY">): string {
  const noun = layer === "block" ? "Block" : "Wall";
  if (ref.kind === "vanilla") return `${noun} ${String(ref.id)}`;
  if (ref.kind === "unknown") return `Unknown ${layer} ${String(ref.runtimeId)}`;
  return `${ref.mod}:${ref.internalName}`;
}

/** The palette key shown in the ID column: `vanilla:1`, `unknown:700`, `Mod:Name`. */
export function contentKey(ref: ContentRef): string {
  if (ref.kind === "vanilla") return `vanilla:${String(ref.id)}`;
  if (ref.kind === "unknown") return `unknown:${String(ref.runtimeId)}`;
  return `${ref.mod}:${ref.internalName}`;
}

export const LIQUID_NAMES = ["", "Water", "Lava", "Honey", "Shimmer"] as const;

/** One line for the status bar: block, wall and liquid of a tile, or "Empty". */
export function describeTile(tile: Tile): string {
  const parts: string[] = [];
  if (tile.block !== undefined) parts.push(contentName(tile.block, "block"));
  if (tile.wall !== undefined) parts.push(contentName(tile.wall, "wall"));
  if (tile.liquid !== undefined) {
    const name = tile.liquid.kind.charAt(0).toUpperCase() + tile.liquid.kind.slice(1);
    parts.push(`${name} ${String(tile.liquid.amount)}`);
  }
  return parts.length === 0 ? "Empty" : parts.join(" · ");
}
