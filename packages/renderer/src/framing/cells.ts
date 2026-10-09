// What the block and wall framers share: the region they frame and the value of a tile without a cell. A leaf module,
// so frame-block.ts (which builds the wall framing) and frame-wall.ts import it without importing each other.

export interface BlockRegion {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** A region cell with no sheet cell (no block or wall, not framed by the database, or a falling block with nothing below). */
export const NO_CELL = 0xffff;
