// Minecart tracks (tile 314, docs/assets.md "Minecart tracks"): a track stores piece indices, not sheet offsets. frameX
// is its front piece and frameY its back piece (-1: none, a junction otherwise); each piece names a 16 × 16 cell of
// Tiles_314 and the extras drawn on the tile below (decorations under slopes) or above it (bumpers at ends).
import { terrariaSpriteObjects } from "./terraria-sprite-objects.generated.js";

/** The minecart track tile id. */
export const TRACK_TILE = 314;
/** Pixels from one Tiles_314 cell to the next (16-pixel cells, 2-pixel gutter). */
export const TRACK_CELL_STRIDE = 18;

/** An extra a piece draws on a neighbouring tile. */
export type TrackExtra = "leftDown" | "rightDown" | "bumper" | "bouncyBumper";

/** Bits of a piece's extras, as the generated table stores them. */
export const TRACK_FLAGS: Readonly<Record<TrackExtra, number>> = { leftDown: 1, rightDown: 2, bumper: 4, bouncyBumper: 8 };

/** The tile an extra is drawn on, in rows from its track: decorations below, bumpers above. */
export const TRACK_EXTRA_OFFSET: Readonly<Record<TrackExtra, number>> = { leftDown: 1, rightDown: 1, bumper: -1, bouncyBumper: -1 };

const EXTRAS: readonly TrackExtra[] = ["leftDown", "rightDown", "bumper", "bouncyBumper"];

export interface TrackCell {
  readonly column: number;
  readonly row: number;
}

export interface TrackPiece extends TrackCell {
  readonly extras: readonly TrackExtra[];
}

/** The Tiles_314 cell and extras of a stored piece index; undefined for a value that names no piece. */
export function trackPiece(piece: number): TrackPiece | undefined {
  const entry = Number.isInteger(piece) && piece >= 0 ? terrariaSpriteObjects.trackPieces[piece] : undefined;
  if (entry === undefined) return undefined;
  const [column, row, flags] = entry;
  return { column, row, extras: EXTRAS.filter((extra) => (flags & TRACK_FLAGS[extra]) !== 0) };
}

/** The Tiles_314 cell of an extra. */
export function trackExtraCell(extra: TrackExtra): TrackCell {
  const entry = terrariaSpriteObjects.trackExtras[EXTRAS.indexOf(extra)];
  if (entry === undefined) throw new Error(`no cell for the track extra ${extra}`);
  return { column: entry[0], row: entry[1] };
}

/** Number of track pieces a stored frame can name (0 … TRACK_PIECE_COUNT - 1). */
export const TRACK_PIECE_COUNT: number = terrariaSpriteObjects.trackPieces.length;

/**
 * GLSL constants of the track table for the chunk pass: per piece `column | row << 4 | flags << 8`, and the extras'
 * cells `column | row << 4` in TRACK_FLAGS order.
 */
export function trackShaderConstants(): string {
  const pieces = terrariaSpriteObjects.trackPieces.map(([column, row, flags]) => String(column | (row << 4) | (flags << 8)));
  const extras = EXTRAS.map((extra) => {
    const { column, row } = trackExtraCell(extra);
    return String(column | (row << 4));
  });
  return `const int TRACK_PIECE_COUNT = ${String(pieces.length)};
const int TRACK_PIECES[${String(pieces.length)}] = int[](${pieces.join(", ")});
const int TRACK_EXTRAS[${String(extras.length)}] = int[](${extras.join(", ")});
`;
}
