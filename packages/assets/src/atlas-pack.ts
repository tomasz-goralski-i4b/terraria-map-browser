import type { AtlasEntry, PackableSheet, SheetKind, SheetMetrics, SpriteAtlas } from "./atlas-types.js";

/** Bump when the page layout or index shape changes; it is part of the cache key. */
export const ATLAS_FORMAT_VERSION = 6;

/** Page edge used when the caller passes none. */
export const DEFAULT_PAGE_SIZE = 4096;
/** Transparent border used when the caller passes none. */
export const DEFAULT_PADDING = 2;

/** Frame and gutter metrics from docs/assets.md ("Sprite layout"). */
const METRICS: Readonly<Record<SheetKind, SheetMetrics>> = {
  tile: { cell: 16, gap: 2 },
  wall: { cell: 32, gap: 4 },
  // docs/assets.md, "Trees": the common styles' tops are 80 × 80 (others differ: the renderer takes their size from
  // the generated foliage table); branches 40 × 40.
  treeTop: { cell: 80, gap: 2 },
  treeBranch: { cell: 40, gap: 2 },
  // Measured (S): three 60 × 42 caps side by side; layoutOf carries the height.
  shroomTop: { cell: 60, gap: 2 },
  // docs/assets.md, "Wires": 16 × 16 pieces at a stride of 18; the actuator is one 16 × 16 image.
  wire: { cell: 16, gap: 2 },
  actuator: { cell: 16, gap: 0 },
  // Items (chest contents, …) and liquids are kept for later use; their frame layout is not described yet, so cell 0
  // stands for the whole sheet.
  item: { cell: 0, gap: 0 },
  liquid: { cell: 0, gap: 0 },
  liquidSlope: { cell: 0, gap: 0 },
};

interface SheetLayout {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly gapX: number;
  readonly gapY: number;
}

/**
 * Tile ids whose texture grid or gutter differs from the 16×16 / 2×2 default, as
 * `[id, frameWidth, frameHeight, gapX, gapY]`. Restated in our own words from the per-id `textureGrid` and `frameGap`
 * fields of A12 (TEdit `tiles.json` @ 99928583, all 754 ids 0–753; see docs/assets.md "Sprite layout"); 56 ids
 * differ, every other id uses the default.
 */
const TILE_LAYOUT_EXCEPTIONS: ReadonlyMap<number, SheetLayout> = new Map(
  (
    [
      [3, 16, 20, 2, 2],
      [4, 20, 20, 2, 2],
      [5, 20, 20, 2, 2],
      [15, 16, 16, 2, 4],
      [16, 16, 18, 2, 2],
      [18, 16, 18, 2, 2],
      [24, 16, 20, 2, 2],
      [33, 16, 20, 2, 2],
      [49, 16, 20, 2, 2],
      [61, 16, 20, 2, 2],
      [71, 16, 20, 2, 2],
      [73, 16, 32, 2, 2],
      [74, 16, 32, 2, 2],
      [81, 24, 26, 2, 2],
      [82, 16, 20, 2, 2],
      [83, 16, 20, 2, 2],
      [84, 16, 20, 2, 2],
      [110, 16, 20, 2, 2],
      [113, 16, 32, 2, 2],
      [172, 16, 16, 2, 3],
      [174, 16, 20, 2, 2],
      [184, 20, 16, 2, 2],
      [201, 16, 20, 2, 2],
      [216, 16, 16, 2, 4],
      [227, 32, 38, 2, 2],
      [323, 20, 20, 2, 2],
      [324, 20, 20, 2, 2],
      [372, 16, 20, 2, 2],
      [388, 16, 18, 2, 2],
      [389, 16, 18, 2, 2],
      [442, 20, 20, 2, 2],
      [476, 20, 18, 2, 2],
      [497, 16, 16, 2, 4],
      [529, 16, 15, 2, 2],
      [567, 26, 18, 2, 2],
      [579, 20, 20, 2, 2],
      [583, 20, 20, 2, 2],
      [584, 20, 20, 2, 2],
      [585, 20, 20, 2, 2],
      [586, 20, 20, 2, 2],
      [587, 20, 20, 2, 2],
      [588, 20, 20, 2, 2],
      [589, 20, 20, 2, 2],
      [596, 20, 20, 2, 2],
      [616, 20, 20, 2, 2],
      [624, 20, 18, 2, 2],
      [634, 20, 20, 2, 2],
      [637, 16, 20, 2, 2],
      [646, 16, 20, 2, 2],
      [656, 24, 34, 2, 2],
      [700, 20, 16, 2, 2],
      [701, 24, 34, 2, 2],
      [703, 16, 20, 2, 2],
      [726, 20, 20, 2, 2],
      [751, 18, 18, 0, 0],
      [752, 18, 18, 0, 0],
    ] as const
  ).map(([id, frameWidth, frameHeight, gapX, gapY]) => [id, { frameWidth, frameHeight, gapX, gapY }]),
);

/** The giant mushroom caps are 60 × 42 (measured, S). */
const SHROOM_TOP_HEIGHT = 42;

function layoutOf(kind: SheetKind, id: number): SheetLayout {
  const { cell, gap } = METRICS[kind];
  const height = kind === "shroomTop" ? SHROOM_TOP_HEIGHT : cell;
  const base: SheetLayout = { frameWidth: cell, frameHeight: height, gapX: gap, gapY: gap };
  return kind === "tile" ? (TILE_LAYOUT_EXCEPTIONS.get(id) ?? base) : base;
}

export interface PackOptions {
  /** Power-of-two page edge in pixels. */
  readonly pageSize?: number;
  /** Transparent pixels kept around every sheet. */
  readonly padding?: number;
}

/** A sheet does not fit into one atlas page. */
export class AtlasSheetTooLargeError extends Error {
  readonly kind: SheetKind;
  readonly id: number;

  constructor(kind: SheetKind, id: number, message: string) {
    super(message);
    this.name = "AtlasSheetTooLargeError";
    this.kind = kind;
    this.id = id;
  }
}

/** A horizontal strip of a page; sheets are placed left to right along it. */
interface Shelf {
  readonly y: number;
  readonly height: number;
  nextX: number;
}

interface PageLayout {
  readonly shelves: Shelf[];
  nextY: number;
}

interface Placement {
  readonly page: number;
  readonly x: number;
  readonly y: number;
}

/** `value` rounded up to an even number. */
const even = (value: number): number => value + (value & 1);

/**
 * Finds room for a `width × height` rectangle (padding excluded) on an existing page, or `undefined`. Sheets start at
 * even pixels: the renderer's half-resolution atlas averages 2 × 2 pixels from even positions, so each sheet's cells
 * stay apart from their gutters there.
 */
function place(pages: PageLayout[], width: number, height: number, pageSize: number, padding: number): Placement | undefined {
  for (const [page, layout] of pages.entries()) {
    for (const shelf of layout.shelves) {
      if (shelf.height >= height && shelf.nextX + width + padding <= pageSize) {
        const x = shelf.nextX;
        shelf.nextX = even(x + width + padding);
        return { page, x, y: shelf.y };
      }
    }
    if (layout.nextY + height + padding <= pageSize) {
      const x = even(padding);
      const shelf: Shelf = { y: layout.nextY, height, nextX: even(x + width + padding) };
      layout.shelves.push(shelf);
      layout.nextY = even(layout.nextY + height + padding);
      return { page, x, y: shelf.y };
    }
  }
  return undefined;
}

/** Packs sheets into pages, each placed exactly once, inside the page and without overlap (padding included). */
export function packSheets(sheets: readonly PackableSheet[], options?: PackOptions): SpriteAtlas {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const padding = options?.padding ?? DEFAULT_PADDING;

  for (const sheet of sheets) {
    // A sheet starts at the first even pixel past the padding (place).
    if (even(padding) + sheet.width + padding > pageSize || even(padding) + sheet.height + padding > pageSize) {
      throw new AtlasSheetTooLargeError(
        sheet.kind,
        sheet.id,
        `Sheet ${sheet.kind} ${String(sheet.id)} is ${String(sheet.width)}×${String(sheet.height)} px; with ${String(padding)} px ` +
          `padding it does not fit into a ${String(pageSize)}×${String(pageSize)} atlas page.`,
      );
    }
  }

  // Tallest first keeps the shelves tight; the id tie-break makes the layout deterministic.
  const ordered = [...sheets].sort((a, b) => b.height - a.height || a.kind.localeCompare(b.kind) || a.id - b.id);
  const layouts: PageLayout[] = [];
  const pages: Uint8Array[] = [];
  const entries: AtlasEntry[] = [];

  for (const sheet of ordered) {
    let placement = place(layouts, sheet.width, sheet.height, pageSize, padding);
    if (placement === undefined) {
      layouts.push({ shelves: [], nextY: even(padding) });
      pages.push(new Uint8Array(pageSize * pageSize * 4));
      placement = place(layouts, sheet.width, sheet.height, pageSize, padding);
      if (placement === undefined) throw new Error("A sheet that passed the size check did not fit an empty page.");
    }
    const page = pages[placement.page];
    if (page === undefined) throw new Error("Placement refers to a missing page.");
    const rowBytes = sheet.width * 4;
    for (let row = 0; row < sheet.height; row++) {
      page.set(sheet.rgba.subarray(row * rowBytes, (row + 1) * rowBytes), ((placement.y + row) * pageSize + placement.x) * 4);
    }
    entries.push({ kind: sheet.kind, id: sheet.id, page: placement.page, x: placement.x, y: placement.y, width: sheet.width, height: sheet.height, ...layoutOf(sheet.kind, sheet.id) });
  }

  return {
    pages,
    index: { formatVersion: ATLAS_FORMAT_VERSION, pageSize, padding, pageCount: pages.length, metrics: METRICS, entries },
  };
}

/** The entry of (kind, id), or `undefined` when the sheet is not in the atlas. */
export function findSprite(atlas: Pick<SpriteAtlas, "index">, kind: SheetKind, id: number): AtlasEntry | undefined {
  return atlas.index.entries.find((entry) => entry.kind === kind && entry.id === id);
}

/** Copies the entry's rectangle out of its page as `width × height × 4` bytes. */
export function readSpritePixels(atlas: SpriteAtlas, entry: AtlasEntry): Uint8Array {
  const page = atlas.pages[entry.page];
  if (page === undefined) throw new RangeError(`Atlas page ${String(entry.page)} does not exist.`);
  const { pageSize } = atlas.index;
  const rowBytes = entry.width * 4;
  const out = new Uint8Array(rowBytes * entry.height);
  for (let row = 0; row < entry.height; row++) {
    const start = ((entry.y + row) * pageSize + entry.x) * 4;
    out.set(page.subarray(start, start + rowBytes), row * rowBytes);
  }
  return out;
}
