import { findSprite, type SpriteAtlas } from "@studio/assets";
import { NO_CELL, WALL_OVERHANG, wallSourceRect, wrappedFrame, type BlockFraming, type FramingWorld, type WallFramingWorld } from "@studio/renderer";
import type { BrushContentLayer, ContentRef, Tile } from "@studio/world-model";

export interface Thumbnail {
  readonly width: number;
  readonly height: number;
  readonly pixels: Uint8ClampedArray<ArrayBuffer>;
}

export interface TileThumbnailSource {
  readonly world: FramingWorld & WallFramingWorld;
  readonly x: number;
  readonly y: number;
  readonly tile: Tile;
}

/** Copies only a cell from an atlas page; decoded sheets are never retained or allocated. */
export function thumbnailPixels(atlas: SpriteAtlas, layer: BrushContentLayer, id: number, x: number, y: number, width = 16, height = 16): Thumbnail | null {
  const entry = findSprite(atlas, layer === "block" ? "tile" : "wall", id);
  if (entry === undefined || x < 0 || y < 0 || x + width > entry.width || y + height > entry.height) return null;
  const page = atlas.pages[entry.page];
  if (page === undefined) return null;
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row++) {
    const start = ((entry.y + y + row) * atlas.index.pageSize + entry.x + x) * 4;
    pixels.set(page.subarray(start, start + width * 4), row * width * 4);
  }
  return { width, height, pixels };
}

/** Small cell cache, owned by one atlas connection. Failures are cached as well. */
export class ThumbnailSource {
  private readonly cells = new Map<string, Thumbnail | null>();

  private readonly atlas: SpriteAtlas;
  private readonly framing: BlockFraming;

  constructor(atlas: SpriteAtlas, framing: BlockFraming) {
    this.atlas = atlas;
    this.framing = framing;
  }

  material(layer: BrushContentLayer, ref: ContentRef): Thumbnail | null {
    if (ref.kind !== "vanilla") return null;
    const key = `${layer}:${String(ref.id)}`;
    if (this.cells.has(key)) return this.cells.get(key) ?? null;
    let thumbnail: Thumbnail | null = null;
    if (layer === "wall") {
      const rect = wallSourceRect(this.framing.walls.wallCell(ref.id, 15, 0, 0));
      if (rect !== null) thumbnail = thumbnailPixels(this.atlas, layer, ref.id, rect.x + WALL_OVERHANG, rect.y + WALL_OVERHANG);
    } else {
      const cell = this.framing.frameBlock({ type: ref.id, shape: 0, x: 0, y: 0, neighbours: new Int32Array(8).fill(ref.id) });
      const entry = findSprite(this.atlas, "tile", ref.id);
      if (cell !== null && entry !== undefined) thumbnail = thumbnailPixels(this.atlas, layer, ref.id,
        cell.column * (entry.frameWidth + entry.gapX), cell.row * (entry.frameHeight + entry.gapY));
    }
    this.cells.set(key, thumbnail);
    return thumbnail;
  }

  /** Actual Inspector cells are intentionally uncached: edits can change their neighbours. */
  tile(layer: BrushContentLayer, ref: ContentRef, source: TileThumbnailSource): Thumbnail | null {
    if (ref.kind !== "vanilla") return null;
    const { world, x, y, tile } = source;
    if (layer === "wall") {
      const rect = wallSourceRect(this.framing.walls.cellAt(world, x, y));
      return rect === null ? null : thumbnailPixels(this.atlas, layer, ref.id, rect.x + WALL_OVERHANG, rect.y + WALL_OVERHANG);
    }
    const entry = findSprite(this.atlas, "tile", ref.id);
    if (entry === undefined) return null;
    if (tile.frameX !== undefined && tile.frameY !== undefined) {
      const [left, top] = wrappedFrame(ref.id, tile.frameX, tile.frameY);
      return thumbnailPixels(this.atlas, layer, ref.id, left, top, entry.frameWidth, entry.frameHeight);
    }
    const cells = new Uint16Array(1);
    this.framing.frameRegion(world, { left: x, top: y, width: 1, height: 1 }, cells);
    const cell = cells[0] ?? NO_CELL;
    return cell === NO_CELL ? null : thumbnailPixels(this.atlas, layer, ref.id,
      (cell >> 6) * (entry.frameWidth + entry.gapX), (cell & 63) * (entry.frameHeight + entry.gapY));
  }
}
