/**
 * The game-derived tables of minecart tracks and trees (docs/assets.md, "Minecart tracks" and "Trees"), as
 * scripts/sprite-objects/export.mjs writes them from the observer's output (ADR 0003). Numbers only.
 */
export interface SpriteObjectData {
  readonly gameVersion: string;
  /**
   * Track pieces by the index a track stores (frameX: front piece, frameY: back piece): [column, row, flags], the
   * piece's cell on Tiles_314 (16 × 16 at a stride of 18) and the extras it draws (TRACK_FLAGS).
   */
  readonly trackPieces: readonly (readonly [number, number, number])[];
  /** Cells of the extras: left-down decoration, right-down decoration, bumper, bouncy bumper ([column, row]). */
  readonly trackExtras: readonly (readonly [number, number])[];
  /** [ground block type, Tiles_5 block]: the 176-pixel block a common tree's trunk uses on that ground (else 0). */
  readonly trunkBlocks: readonly (readonly [number, number])[];
  /** [ground block type, row]: the Tiles_323 row (22-pixel rows) and Tree_Tops_15 row of a palm on that ground. */
  readonly palmRows: readonly (readonly [number, number])[];
  /**
   * Foliage patterns: [period, then per column: style, frame offset, top width, top height], the style
   * (Tree_Tops_N / Tree_Branches_N), frame offset and top frame size of a top or branch at column x, by x mod period;
   * style -1 draws no foliage.
   */
  readonly foliagePatterns: readonly (readonly number[])[];
  /**
   * Per tree type, per ground block type: [ground, area, pattern for variation 0, 1, …]. The area is the index into the
   * world's tree top variations the foliage reads: -1 none (one pattern), -2 the forest zone of the tree's column.
   */
  readonly foliage: readonly { readonly type: number; readonly grounds: readonly (readonly number[])[] }[];
}
