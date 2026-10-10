import type { BrushContentLayer } from "@studio/world-model";
import { findMaterial, type BrushMaterials } from "../world/brush-materials.js";

/** A map colour (0xRRGGBB) as CSS; null (no map colour) shows the transparency checkerboard. */
export function cssColor(color: number | null | undefined): string | undefined {
  return color === null || color === undefined ? undefined : `#${color.toString(16).padStart(6, "0")}`;
}

export function paintColor(materials: BrushMaterials | null, paint: number): number | null {
  return paint === 0 ? null : materials?.paints.find((candidate) => candidate.id === paint)?.color ?? null;
}

export function paintLabel(materials: BrushMaterials | null, paint: number): string {
  if (paint === 0) return "No paint";
  return materials?.paints.find((candidate) => candidate.id === paint)?.name ?? `Paint ${String(paint)}`;
}

/** "Stone Block", "Wood Wall · Red Paint". */
export function swatchName(materials: BrushMaterials | null, layer: BrushContentLayer, id: number, paint = 0): string {
  const name = materials === null ? undefined : findMaterial(materials, layer, id)?.name;
  const base = name ?? `${layer === "block" ? "Block" : "Wall"} ${String(id)}`;
  return paint === 0 ? base : `${base} · ${paintLabel(materials, paint)}`;
}

/**
 * A material as image editors show a colour: its map colour, with the paint it is put down with as a corner, so a
 * painted and an unpainted swatch of the same block stay apart.
 */
export function MaterialSwatch({ color, paint, layer }: {
  readonly color: number | null;
  readonly paint?: number | null;
  readonly layer?: BrushContentLayer;
}): React.JSX.Element {
  const paintCss = cssColor(paint ?? null);
  return (
    <span className="material-swatch" data-layer={layer} data-empty={color === null} style={{ backgroundColor: cssColor(color) }} aria-hidden="true">
      {paintCss !== undefined && <span className="material-swatch-paint" style={{ borderTopColor: paintCss }} />}
    </span>
  );
}
