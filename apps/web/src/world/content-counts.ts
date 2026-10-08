/** The planes counted per content id; any CWM planes object (docs/cwm.md) fits. */
export interface CountablePlanes {
  readonly block: Uint16Array;
  readonly wall: Uint16Array;
  readonly liquid: Uint8Array;
}

/** Tiles per palette index (as block, as wall) and per CWM liquid kind (index 0 = no liquid, never counted). */
export interface ContentCounts {
  readonly blocks: Uint32Array;
  readonly walls: Uint32Array;
  readonly liquids: Uint32Array;
}

const LIQUID_KINDS = 5;
const LIQUID_KIND_MASK = 0b111;

function emptyCounts(paletteLength: number): ContentCounts {
  return { blocks: new Uint32Array(paletteLength), walls: new Uint32Array(paletteLength), liquids: new Uint32Array(LIQUID_KINDS) };
}

function countRange(planes: CountablePlanes, counts: ContentCounts, from: number, to: number): void {
  const { block, wall, liquid } = planes;
  const { blocks, walls, liquids } = counts;
  const palette = blocks.length;
  for (let index = from; index < to; index++) {
    const b = block[index] ?? 0xffff;
    if (b < palette) blocks[b] = (blocks[b] ?? 0) + 1;
    const w = wall[index] ?? 0xffff;
    if (w < palette) walls[w] = (walls[w] ?? 0) + 1;
    const l = (liquid[index] ?? 0) & LIQUID_KIND_MASK;
    if (l !== 0 && l < LIQUID_KINDS) liquids[l] = (liquids[l] ?? 0) + 1;
  }
}

/** Counts in one pass; for small worlds and tests. The app uses `countContentInSlices`. */
export function countContent(planes: CountablePlanes, paletteLength: number): ContentCounts {
  const counts = emptyCounts(paletteLength);
  countRange(planes, counts, 0, planes.block.length);
  return counts;
}

export interface SliceOptions {
  /** Tiles per slice; the default keeps a slice well under a frame on a large world. */
  readonly sliceSize?: number;
  readonly signal?: AbortSignal;
  /** Gives the main thread back between slices (input, rendering); defaults to a macrotask. */
  readonly yieldControl?: () => Promise<void>;
  readonly onProgress?: (done: number, total: number) => void;
}

function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Counts in slices that yield between them, so a large world never blocks input in one long task. */
export async function countContentInSlices(planes: CountablePlanes, paletteLength: number, options: SliceOptions = {}): Promise<ContentCounts> {
  const { sliceSize = 1 << 20, signal, yieldControl = nextTask, onProgress } = options;
  const counts = emptyCounts(paletteLength);
  const total = planes.block.length;
  for (let from = 0; from < total; from += sliceSize) {
    signal?.throwIfAborted();
    const to = Math.min(total, from + sliceSize);
    countRange(planes, counts, from, to);
    onProgress?.(to, total);
    if (to < total) await yieldControl();
  }
  signal?.throwIfAborted();
  return counts;
}
