// Wires and actuators in sprite mode (docs/assets.md, "Wires"). WiresNew holds one 16 × 16 piece per combination of
// the four sides a wire continues to, at a stride of 18: the column is up 1 + right 2 + down 4 + left 8 (measured in the
// art, S), and the row is the colour (rows 0–3: red, blue, green, yellow). The actuator is one 16 × 16 image.

import { CHUNK_SIZE } from "../camera/camera.js";
import { WIRE_LAYER } from "../chunk/render.js";

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

/** The wire and actuator bits (0–4) set anywhere in a chunk, and its vertical runs of tiles with any, as (x, y, 1, h). */
export interface WireRuns {
  readonly bits: number;
  readonly runs: Int32Array;
}

/** The wire runs of the CHUNK_SIZE² chunk at `chunk` (in chunks) of a world with a flags plane (column-major). */
export function collectWireRuns(
  world: { readonly width: number; readonly height: number; readonly planes: { readonly flags?: Uint16Array } },
  chunk: { readonly x: number; readonly y: number },
): WireRuns {
  const flags = world.planes.flags;
  const runs: number[] = [];
  let bits = 0;
  if (flags !== undefined) {
    const top = chunk.y * CHUNK_SIZE;
    const bottom = Math.min(world.height, top + CHUNK_SIZE);
    const right = Math.min(world.width, (chunk.x + 1) * CHUNK_SIZE);
    for (let x = chunk.x * CHUNK_SIZE; x < right; x++) {
      const column = x * world.height;
      let start = -1;
      for (let y = top; y <= bottom; y++) {
        const wire = y < bottom ? (flags[column + y] ?? 0) & WIRE_LAYER.all : 0;
        bits |= wire;
        if (wire !== 0 && start < 0) start = y;
        else if (wire === 0 && start >= 0) {
          runs.push(x, start, 1, y - start);
          start = -1;
        }
      }
    }
  }
  return { bits, runs: Int32Array.from(runs) };
}
