import type { CountablePlanes } from "./content-counts.js";

/** What a content search highlights: palette indices as block and as wall, and CWM liquid kinds (1–4). */
export interface ContentSelection {
  readonly blocks: readonly number[];
  readonly walls: readonly number[];
  readonly liquids: readonly number[];
}

/** A searchable content entry, as the Content panel lists it (`block:3`, `wall:3`, `liquid:1`). */
export interface ContentEntry {
  readonly key: string;
  readonly kind: "block" | "wall" | "liquid";
  readonly name: string;
  readonly id: string;
}

/** Entries whose name or key contains the query, case-insensitively; an empty query matches nothing. */
export function matchContent<E extends ContentEntry>(entries: readonly E[], query: string): E[] {
  const text = query.trim().toLowerCase();
  if (text === "") return [];
  return entries.filter((entry) => entry.name.toLowerCase().includes(text) || entry.id.toLowerCase().includes(text));
}

export function selectionOf(entries: readonly ContentEntry[]): ContentSelection {
  const blocks: number[] = [], walls: number[] = [], liquids: number[] = [];
  for (const entry of entries) {
    const index = Number(entry.key.slice(entry.key.indexOf(":") + 1));
    (entry.kind === "block" ? blocks : entry.kind === "wall" ? walls : liquids).push(index);
  }
  return { blocks, walls, liquids };
}

const LIQUID_KIND_MASK = 0b111;

/** The same rule as the Content panel's counts (content-counts.ts) and the renderer's highlight. */
function matcher(planes: CountablePlanes, selection: ContentSelection): (index: number) => boolean {
  const blocks = new Set(selection.blocks), walls = new Set(selection.walls), liquids = new Set(selection.liquids);
  const { block, wall, liquid } = planes;
  return (index) => blocks.has(block[index] ?? 0xffff) || walls.has(wall[index] ?? 0xffff)
    || liquids.has((liquid[index] ?? 0) & LIQUID_KIND_MASK);
}

export interface ContentStep { readonly x: number; readonly y: number; readonly ordinal: number }

/**
 * Stepping through a selection's tiles in column-major order (the planes' order). Only per-column counts are kept,
 * so the index of a content covering most of a Large world is one Uint32Array per column, not one entry per tile.
 * A step skips the rest of the vertical run it is in, so a 2 × 2 object is visited once per column, not four times.
 */
export interface ContentStepIndex {
  /** Matching tiles in the world. */
  readonly total: number;
  /** The next (1) or previous (-1) run start after `from` (a tile, or null to start at an end), wrapping around. */
  readonly step: (from: { readonly x: number; readonly y: number } | null, direction: 1 | -1) => ContentStep | null;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Builds the step index in slices of whole columns that yield between them (by default about 1M tiles each), so a
 * content covering a large share of a Large world never blocks input. Rejects with an AbortError when aborted.
 */
export async function buildContentStepIndex(
  planes: CountablePlanes, width: number, height: number, selection: ContentSelection,
  options: { readonly signal?: AbortSignal; readonly sliceTiles?: number; readonly yieldControl?: () => Promise<void> } = {},
): Promise<ContentStepIndex> {
  const { signal, sliceTiles = 1 << 20, yieldControl = nextTask } = options;
  const matches = matcher(planes, selection);
  // before[x] = matching tiles in the columns left of x.
  const before = new Uint32Array(width + 1);
  const columnsPerSlice = Math.max(1, Math.floor(sliceTiles / Math.max(1, height)));
  for (let x = 0; x < width; x++) {
    if (x > 0 && x % columnsPerSlice === 0) {
      await yieldControl();
      if (signal?.aborted === true) throw new DOMException("Content search aborted", "AbortError");
    }
    let count = 0;
    for (let index = x * height, end = index + height; index < end; index++) if (matches(index)) count++;
    before[x + 1] = (before[x] ?? 0) + count;
  }
  const total = before[width] ?? 0;
  const columnCount = (x: number): number => (before[x + 1] ?? 0) - (before[x] ?? 0);
  const ordinalOf = (x: number, y: number): number => {
    let ordinal = before[x] ?? 0;
    for (let index = x * height, end = index + y; index <= end; index++) if (matches(index)) ordinal++;
    return ordinal;
  };
  const isRunStart = (x: number, y: number): boolean => matches(x * height + y) && (y === 0 || !matches(x * height + y - 1));

  const forward = (startX: number, startY: number): ContentStep | null => {
    for (let pass = 0; pass <= width; pass++) {
      const x = (startX + pass) % width;
      if (columnCount(x) === 0) continue;
      for (let y = pass === 0 ? startY : 0; y < height; y++) {
        if (isRunStart(x, y)) return { x, y, ordinal: ordinalOf(x, y) };
      }
    }
    return null;
  };
  const backward = (startX: number, startY: number): ContentStep | null => {
    for (let pass = 0; pass <= width; pass++) {
      const x = (startX - pass + width * 2) % width;
      if (columnCount(x) === 0) continue;
      for (let y = pass === 0 ? startY : height - 1; y >= 0; y--) {
        if (isRunStart(x, y)) return { x, y, ordinal: ordinalOf(x, y) };
      }
    }
    return null;
  };

  return {
    total,
    step: (from, direction) => {
      if (total === 0 || width === 0) return null;
      if (from === null) return direction === 1 ? forward(0, 0) : backward(width - 1, height - 1);
      if (direction === 1) {
        // Past the run `from` is in, then on.
        let y = from.y + 1;
        while (y < height && matches(from.x * height + y)) y++;
        return y < height ? forward(from.x, y) : forward((from.x + 1) % width, 0);
      }
      return from.y > 0 ? backward(from.x, from.y - 1) : backward((from.x - 1 + width) % width, height - 1);
    },
  };
}
