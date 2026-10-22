import { DEFAULT_HIGHLIGHT_COLOR } from "@studio/renderer";
import type { TilePoint } from "../shell/view-store.js";

/** Below this many CSS pixels per tile the pinned tile also gets a ring, so it stays visible zoomed out. */
export const PIN_RING_ZOOM = 12;
/** The ring's width in CSS pixels. */
export const PIN_RING_SIZE = 16;
const HOVER = DEFAULT_HIGHLIGHT_COLOR.map((channel) => channel / 255) as [number, number, number];

/**
 * GPU annotation records (see `MapAnnotations`) marking the Inspector's tiles: the hovered tile outlined thin in the
 * highlight colour, then the pinned one outlined white over its dark halo (visible on light and dark tiles) and, with
 * `ring`, inside a fixed-size ring. Nothing animates, so reduced motion needs no case.
 */
export function tileMarkers(pinned: TilePoint | null, hover: TilePoint | null, ring: boolean): Float32Array {
  const records: number[] = [];
  const outline = ({ x, y }: TilePoint, color: readonly number[], width: number): void => {
    for (const [ax, ay, bx, by] of [[x, y, x + 1, y], [x + 1, y, x + 1, y + 1], [x + 1, y + 1, x, y + 1], [x, y + 1, x, y]] as const) {
      records.push(ax, ay, bx, by, ...color, width, 0);
    }
  };
  if (hover !== null && (hover.x !== pinned?.x || hover.y !== pinned.y)) outline(hover, HOVER, 1);
  if (pinned !== null) {
    outline(pinned, [1, 1, 1], 2);
    if (ring) records.push(pinned.x + 0.5, pinned.y + 0.5, pinned.x + 0.5, pinned.y + 0.5, 1, 1, 1, PIN_RING_SIZE, 3);
  }
  return new Float32Array(records);
}
