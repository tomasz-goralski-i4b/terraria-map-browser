import type { ContentRef, Tile } from "@studio/world-model";
import { mapOption, terrariaMapNames, terrariaMapPalette } from "@studio/renderer";

export type ContentLayer = "block" | "wall";

/** A generated vanilla name, using the known frame axis; unnamed, unknown and mod content keep their key. */
export function contentName(ref: ContentRef, layer: ContentLayer, frame?: Pick<Tile, "frameX" | "frameY">): string {
  if (ref.kind !== "vanilla") return contentKey(ref);
  const names = (layer === "block" ? terrariaMapNames.tiles : terrariaMapNames.walls)[ref.id];
  const rule = (layer === "block" ? terrariaMapPalette.tileOptions : terrariaMapPalette.wallOptions)?.[ref.id];
  const axis = rule === undefined ? undefined : frame?.[rule.axis];
  const option = axis === undefined || axis < 0 ? 0 : mapOption(rule, frame?.frameX ?? 0, frame?.frameY ?? 0);
  const selected = names?.[option];
  if (selected !== undefined && selected.length > 0) return selected;
  const first = names?.[0];
  return first !== undefined && first.length > 0 ? first : contentKey(ref);
}

/** The palette key shown in the ID column: `vanilla:1`, `unknown:700`, `Mod:Name`. */
export function contentKey(ref: ContentRef): string {
  if (ref.kind === "vanilla") return `vanilla:${String(ref.id)}`;
  if (ref.kind === "unknown") return `unknown:${String(ref.runtimeId)}`;
  return `${ref.mod}:${ref.internalName}`;
}

export const LIQUID_NAMES = ["", ...terrariaMapNames.liquids] as const;

/** A generated paint name, retaining the numeric key for an unknown paint. */
export function paintName(paint: number): string {
  const name = terrariaMapNames.paints[paint];
  if (name !== undefined && name.length > 0) return name;
  return `paint:${String(paint)}`;
}

function paintedName(ref: ContentRef, layer: ContentLayer, paint: number | undefined, frame?: Pick<Tile, "frameX" | "frameY">): string {
  const name = contentName(ref, layer, frame);
  return paint === undefined || paint === 0 ? name : `${name} (${paintName(paint)})`;
}

const liquidNames = Object.fromEntries(
  (["water", "lava", "honey", "shimmer"] as const).map((kind, index) => [kind, terrariaMapNames.liquids[index]]),
);

/** One line for the status bar: block, wall and liquid of a tile, or "Empty". */
export function describeTile(tile: Tile): string {
  const parts: string[] = [];
  if (tile.block !== undefined) parts.push(paintedName(tile.block, "block", tile.paint, tile));
  if (tile.wall !== undefined) parts.push(paintedName(tile.wall, "wall", tile.wallPaint));
  if (tile.liquid !== undefined) {
    const name = liquidNames[tile.liquid.kind] ?? tile.liquid.kind;
    parts.push(`${name} ${String(tile.liquid.amount)}`);
  }
  return parts.length === 0 ? "Empty" : parts.join(" · ");
}
