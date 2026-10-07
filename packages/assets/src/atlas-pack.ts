import type { AtlasEntry, PackableSheet, SheetKind, SheetMetrics, SpriteAtlas } from "./atlas-types.js";

/** Bump when the page layout or index shape changes; it is part of the cache key. */
export const ATLAS_FORMAT_VERSION = 2;

/** Page edge used when the caller passes none. */
export const DEFAULT_PAGE_SIZE = 4096;
/** Transparent border used when the caller passes none. */
export const DEFAULT_PADDING = 2;

/** Frame and gutter metrics from docs/assets.md ("Sprite layout"). */
const METRICS: Readonly<Record<SheetKind, SheetMetrics>> = {
  tile: { cell: 16, gap: 2 },
  wall: { cell: 32, gap: 4 },
};

interface SheetLayout {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly gapX: number;
  readonly gapY: number;
}

/**
 * Tile ids whose texture grid or gutter differs from the 16×16 / 2×2 default, restated from the per-id statistics in
 * docs/assets.md ("Sprite layout", "Blocks"; source A12). Only the ids that document names are listed; every other id
 * uses the default until a follow-up derives the full table.
 */
const TILE_LAYOUT_EXCEPTIONS: ReadonlyMap<number, Partial<SheetLayout>> = new Map([
  [3, { frameHeight: 20 }], // short plants: 16×20 grid
  [4, { frameWidth: 20, frameHeight: 20 }], // torches
  [5, { frameWidth: 20, frameHeight: 20 }], // trees
  [323, { frameWidth: 20, frameHeight: 20 }], // palm trees
  [15, { gapY: 4 }], // chairs
  [216, { gapY: 4 }], // rockets
  [497, { gapY: 4 }], // toilets
  [172, { gapY: 3 }], // sinks
  [751, { gapX: 0, gapY: 0 }],
  [752, { gapX: 0, gapY: 0 }],
]);

function layoutOf(kind: SheetKind, id: number): SheetLayout {
  const { cell, gap } = METRICS[kind];
  const base: SheetLayout = { frameWidth: cell, frameHeight: cell, gapX: gap, gapY: gap };
  return kind === "tile" ? { ...base, ...TILE_LAYOUT_EXCEPTIONS.get(id) } : base;
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

/** Finds room for a `width × height` rectangle (padding excluded) on an existing page, or `undefined`. */
function place(pages: PageLayout[], width: number, height: number, pageSize: number, padding: number): Placement | undefined {
  for (const [page, layout] of pages.entries()) {
    for (const shelf of layout.shelves) {
      if (shelf.height >= height && shelf.nextX + width + padding <= pageSize) {
        const x = shelf.nextX;
        shelf.nextX = x + width + padding;
        return { page, x, y: shelf.y };
      }
    }
    if (layout.nextY + height + padding <= pageSize) {
      const shelf: Shelf = { y: layout.nextY, height, nextX: padding + width + padding };
      layout.shelves.push(shelf);
      layout.nextY += height + padding;
      return { page, x: padding, y: shelf.y };
    }
  }
  return undefined;
}

/** Packs sheets into pages, each placed exactly once, inside the page and without overlap (padding included). */
export function packSheets(sheets: readonly PackableSheet[], options?: PackOptions): SpriteAtlas {
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const padding = options?.padding ?? DEFAULT_PADDING;

  for (const sheet of sheets) {
    if (sheet.width + 2 * padding > pageSize || sheet.height + 2 * padding > pageSize) {
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
      layouts.push({ shelves: [], nextY: padding });
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
