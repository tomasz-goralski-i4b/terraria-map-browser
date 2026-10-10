// Wires and actuators in sprite mode (docs/assets.md, "Wires"). WiresNew holds one 16 × 16 piece per combination of
// the four sides a wire continues to, at a stride of 18: the column is up 1 + right 2 + down 4 + left 8 (measured in the
// art, S), and the row is the colour (rows 0–3: red, blue, green, yellow). The actuator is one 16 × 16 image.

export type WireColor = "red" | "blue" | "green" | "yellow";

/** The order wires are drawn in, from the bottom: yellow ends on top, as the colour overlay shows it. */
export const WIRE_DRAW_ORDER: readonly WireColor[] = ["red", "blue", "green", "yellow"];

/** Pixels from one WiresNew cell to the next. */
export const WIRE_CELL_STRIDE = 18;

export interface WireNeighbours {
  readonly up: boolean;
  readonly right: boolean;
  readonly down: boolean;
  readonly left: boolean;
}

/** The WiresNew column of a wire whose same-colour wire continues on the given sides. */
export function wirePiece(neighbours: WireNeighbours): number {
  return (neighbours.up ? 1 : 0) | (neighbours.right ? 2 : 0) | (neighbours.down ? 4 : 0) | (neighbours.left ? 8 : 0);
}

/** The WiresNew cell of a piece of a colour. */
export function wireCell(color: WireColor, piece: number): { readonly column: number; readonly row: number } {
  return { column: piece, row: WIRE_DRAW_ORDER.indexOf(color) };
}
