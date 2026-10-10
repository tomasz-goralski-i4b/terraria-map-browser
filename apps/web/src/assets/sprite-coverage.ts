import type { ContentRef } from "@studio/world-model";

/** The planes needed to find framed content: column-major block palette indices and the stored `frameX`. */
export interface FramedPlanes {
  readonly block: Uint16Array;
  /** -1 where the world stores no frame; absent when it stores none at all. */
  readonly frameX?: Int16Array;
}

/**
 * The content sprite mode draws as the missing-texture checkerboard: blocks placed with a stored frame whose content
 * has no tile sheet in the atlas (newer than the install, mod, unknown), once each, in palette order. One pass over the
 * planes, no allocation per tile.
 */
export function contentWithoutSprite(planes: FramedPlanes, palette: readonly ContentRef[], tileSheets: ReadonlySet<number>): ContentRef[] {
  const { block, frameX } = planes;
  if (frameX === undefined) return [];
  const framed = new Uint8Array(palette.length);
  for (let index = 0; index < block.length; index++) {
    const content = block[index] ?? 0xffff;
    if (content < framed.length && (frameX[index] ?? -1) >= 0) framed[content] = 1;
  }
  return palette.filter((ref, index) =>
    framed[index] === 1 && !(ref.kind === "vanilla" && tileSheets.has(ref.id)));
}

/**
 * The walls sprite mode draws as the missing-texture checkerboard: vanilla walls placed in the world whose wall has no
 * sheet in the atlas (newer than the install), once each, in palette order. Walls that are not vanilla content keep
 * their map colour (nothing frames them) and are not listed. One pass over the wall plane.
 */
export function wallsWithoutSprite(wall: Uint16Array, palette: readonly ContentRef[], wallSheets: ReadonlySet<number>): ContentRef[] {
  const placed = new Uint8Array(palette.length);
  for (const content of wall) if (content < placed.length) placed[content] = 1;
  return palette.filter((ref, index) => placed[index] === 1 && ref.kind === "vanilla" && !wallSheets.has(ref.id));
}
