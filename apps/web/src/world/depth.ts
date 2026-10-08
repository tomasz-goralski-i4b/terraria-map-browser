export type DepthLabel = "sky" | "surface" | "underground" | "caverns" | "underworld";

export interface DepthLevels {
  readonly height: number;
  /** Row of the surface level as stored (may be fractional). */
  readonly surfaceLevel: number;
  /** Row where the cavern (rock) layer starts, as stored. */
  readonly rockLevel: number;
}

/** The underworld is the bottom 200 rows, as on the map background (packages/renderer, `backgroundColor`). */
const UNDERWORLD_ROWS = 200;
/** Our convention for "sky": the upper third of the rows above the surface level (see docs/ui.md, "Status bar"). */
const SKY_FRACTION = 1 / 3;

/** The depth band of row `y`, from the levels stored in the world's metadata. */
export function depthLabel(y: number, levels: DepthLevels): DepthLabel {
  if (y >= levels.height - UNDERWORLD_ROWS) return "underworld";
  if (y >= levels.rockLevel) return "caverns";
  if (y >= levels.surfaceLevel) return "underground";
  if (y >= levels.surfaceLevel * SKY_FRACTION) return "surface";
  return "sky";
}
