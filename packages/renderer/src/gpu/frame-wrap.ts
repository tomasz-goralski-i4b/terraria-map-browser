/**
 * Frame-important tiles whose stored frames lie past their sheet's edge (docs/assets.md, "Frames past the sheet's
 * edge"). Their styles do not fit one row of the sheet: past `period` pixels along `axis` the styles continue at the
 * sheet's start, `shift` pixels further along the other axis. Measured in the art of the local install (1.4.5.8): the
 * period is where the first block's art ends (rounded up to the next style), the shift where the art resumes on the
 * other axis; the sheets are a few pixels short of `period` where the last gap is trimmed, or padded past it.
 */
export interface FrameWrap {
  readonly axis: "x" | "y";
  readonly period: number;
  readonly shift: number;
}

const X = (period: number, shift: number): FrameWrap => ({ axis: "x", period, shift });
const Y = (period: number, shift: number): FrameWrap => ({ axis: "y", period, shift });

export const SPRITE_FRAME_WRAPS: ReadonlyMap<number, FrameWrap> = new Map<number, FrameWrap>([
  // Tables: 3 × 2 styles; the second block starts 38 rows down.
  [14, X(1890, 38)],
  // Chairs and toilets: 1 × 2 styles every 40 rows, both directions side by side.
  [15, Y(2040, 36)],
  [497, Y(2040, 36)],
  // Work benches: 2 × 1 styles; the second block starts 20 rows down.
  [18, X(2016, 20)],
  // Chandeliers: 3 × 3 styles, on and off side by side.
  [34, Y(1998, 108)],
  // Lanterns: 1 × 2 styles, on and off side by side.
  [42, Y(2016, 36)],
  // Beds and bathtubs: 4 × 2 styles, both directions side by side.
  [79, Y(2016, 144)],
  [90, Y(2016, 144)],
  // Pianos, dressers, sofas: 3 × 2 styles in two blocks of 36-pixel rows.
  [87, X(1998, 36)],
  [88, X(1998, 36)],
  [89, X(1998, 36)],
  // Banners: 1 × 3 styles in three blocks of 54-pixel rows.
  [91, X(1998, 54)],
  // Lamps: 1 × 3 styles, on and off side by side.
  [93, Y(1998, 36)],
  // Candelabras and music boxes: 2 × 2 styles, two columns per block.
  [100, Y(2016, 72)],
  [139, Y(2016, 72)],
  // Bookcases: 3 × 4 styles.
  [101, X(1998, 72)],
  // Clocks: 2 × 5 styles.
  [104, X(2016, 90)],
  // Statues: 2 × 3 styles; both facing bands continue in the band below them.
  [105, X(1980, 54)],
  // Sinks: 2 × 2 styles every 38 rows.
  [172, Y(2014, 36)],
  // Small piles: the 2 × 1 row (y = 18) continues in the third row (the 1 × 1 row ends far short of the edge); their
  // rubblemaker copy holds that row alone.
  [185, X(1908, 18)],
  [649, X(1908, 18)],
  // Large piles 2 and their rubblemaker copy: 3 × 2 styles.
  [187, X(1890, 36)],
  [648, X(1890, 36)],
]);

/** The sheet position of a stored frame of tile `id`: the frame itself unless its styles wrap (SPRITE_FRAME_WRAPS). */
export function wrappedFrame(id: number, frameX: number, frameY: number): readonly [number, number] {
  const wrap = SPRITE_FRAME_WRAPS.get(id);
  if (wrap === undefined) return [frameX, frameY];
  if (wrap.axis === "x") {
    const block = Math.floor(frameX / wrap.period);
    return [frameX - block * wrap.period, frameY + block * wrap.shift];
  }
  const block = Math.floor(frameY / wrap.period);
  return [frameX + block * wrap.shift, frameY - block * wrap.period];
}
