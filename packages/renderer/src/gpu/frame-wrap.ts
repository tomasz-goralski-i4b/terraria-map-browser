/**
 * Frame-important tiles whose stored frames lie past their sheet's edge (docs/assets.md, "Frames past the sheet's
 * edge"). Their styles do not fit one row of the sheet: past `period` pixels along `axis` the styles continue at the
 * sheet's start, `shift` pixels further along the other axis. Measured in the art of the local install (1.4.5.8) against
 * the frames worlds store; the sheets are a pixel or two short of `period` where the last gap is trimmed.
 */
export interface FrameWrap {
  readonly axis: "x" | "y";
  readonly period: number;
  readonly shift: number;
}

export const SPRITE_FRAME_WRAPS: ReadonlyMap<number, FrameWrap> = new Map<number, FrameWrap>([
  // Pianos, dressers, sofas: 3 × 2 styles in two blocks of 36-pixel rows.
  [87, { axis: "x", period: 1998, shift: 36 }],
  [88, { axis: "x", period: 1998, shift: 36 }],
  [89, { axis: "x", period: 1998, shift: 36 }],
  // Lamps: 1 × 3 styles, two columns (off, on) per block.
  [93, { axis: "y", period: 2052, shift: 36 }],
  // Bookcases: 3 × 4 styles.
  [101, { axis: "x", period: 1998, shift: 72 }],
  // Small piles: the 2 × 1 row (y = 18) continues in the third row.
  [185, { axis: "x", period: 1908, shift: 18 }],
  // Large piles 2: 3 × 2 styles.
  [187, { axis: "x", period: 1890, shift: 36 }],
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
