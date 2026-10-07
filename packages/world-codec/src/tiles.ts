import { isFrameImportant, type WorldSectionTable } from "./header.js";
import { readWorldMetadata, type WorldMetadataResult } from "./metadata.js";
import { WorldFormatError } from "./world-format-error.js";

/** A stable reference to world content as stored in the CWM palette (vanilla or unknown ids in this section). */
export type TileContentRef =
  | { readonly kind: "vanilla"; readonly id: number }
  | { readonly kind: "unknown"; readonly runtimeId: number };

/** The ten CWM planes (docs/cwm.md), column-major: index = x * height + y. */
export interface TilePlanes {
  readonly block: Uint16Array;
  readonly wall: Uint16Array;
  readonly frameX: Int16Array;
  readonly frameY: Int16Array;
  readonly paint: Uint8Array;
  readonly wallPaint: Uint8Array;
  readonly liquid: Uint8Array;
  readonly liquidAmount: Uint8Array;
  readonly shape: Uint8Array;
  readonly flags: Uint16Array;
}

/** Header, metadata and the decoded tile section as CWM planes plus the first-appearance palette. */
export interface WorldTilesResult extends WorldMetadataResult {
  readonly planes: TilePlanes;
  readonly palette: readonly TileContentRef[];
}

const HIGHEST_VANILLA_BLOCK = 753;
const HIGHEST_VANILLA_WALL = 366;
/** Block and wall plane value for "no content". */
const NO_CONTENT = 0xffff;
/** Palette indices 0 … 65534 are usable; 65535 means "absent" in the block and wall planes. */
const MAX_PALETTE = 0xffff;
const ID_SPACE = 0x10000;
const SHIMMER = 4;

/** First-appearance palette; per-id caches keep the per-record path free of hashing once an id is seen. */
class Palette {
  readonly entries: TileContentRef[] = [];
  private readonly blocks = new Int32Array(ID_SPACE).fill(-1);
  private readonly walls = new Int32Array(ID_SPACE).fill(-1);
  private readonly vanilla = new Map<number, number>();
  private readonly unknown = new Map<number, number>();

  /** Index of the block ref for `id`, or -1 when the palette is full. */
  block(id: number): number {
    const cached = this.blocks[id] ?? -1;
    return cached >= 0 ? cached : this.remember(this.blocks, id, id <= HIGHEST_VANILLA_BLOCK);
  }

  /** Index of the wall ref for `id`, or -1 when the palette is full. */
  wall(id: number): number {
    const cached = this.walls[id] ?? -1;
    return cached >= 0 ? cached : this.remember(this.walls, id, id <= HIGHEST_VANILLA_WALL);
  }

  private remember(cache: Int32Array, id: number, isVanilla: boolean): number {
    const byValue = isVanilla ? this.vanilla : this.unknown;
    let index = byValue.get(id);
    if (index === undefined) {
      if (this.entries.length >= MAX_PALETTE) return -1;
      index = this.entries.length;
      this.entries.push(isVanilla ? { kind: "vanilla", id } : { kind: "unknown", runtimeId: id });
      byValue.set(id, index);
    }
    cache[id] = index;
    return index;
  }
}

/** One decoding pass over the tile section; the fields hold the context of the record being decoded. */
class TileDecoder {
  readonly planes: TilePlanes;
  readonly palette = new Palette();
  private readonly bytes: Uint8Array;
  private readonly sections: WorldSectionTable;
  private readonly width: number;
  private readonly height: number;
  private readonly end: number;
  private pos: number;
  private recordStart = 0;
  private x = 0;
  private y = 0;

  constructor(bytes: Uint8Array, sections: WorldSectionTable, width: number, height: number) {
    this.bytes = bytes;
    this.sections = sections;
    this.width = width;
    this.height = height;
    this.pos = sections.tiles.start;
    this.end = sections.tiles.end;
    const count = width * height;
    this.planes = {
      block: new Uint16Array(count).fill(NO_CONTENT),
      wall: new Uint16Array(count).fill(NO_CONTENT),
      frameX: new Int16Array(count).fill(-1),
      frameY: new Int16Array(count).fill(-1),
      paint: new Uint8Array(count),
      wallPaint: new Uint8Array(count),
      liquid: new Uint8Array(count),
      liquidAmount: new Uint8Array(count),
      shape: new Uint8Array(count),
      flags: new Uint16Array(count),
    };
  }

  decode(): void {
    for (let x = 0; x < this.width; x++) {
      for (let y = 0; y < this.height;) y += this.record(x, y) + 1;
    }
    if (this.pos !== this.end) throw new WorldFormatError("MalformedTiles", this.pos, "section not fully consumed");
  }

  private fail(reason: string): never {
    throw new WorldFormatError("MalformedTiles", this.recordStart, reason, { x: this.x, y: this.y });
  }

  private u8(): number {
    if (this.pos >= this.end) this.fail("truncated record");
    return this.bytes[this.pos++] ?? 0;
  }

  private i16(): number {
    const low = this.u8();
    const value = low | (this.u8() << 8);
    return value >= 0x8000 ? value - 0x10000 : value;
  }

  private paletteIndex(index: number): number {
    if (index < 0) this.fail("palette exceeds 65535 entries");
    return index;
  }

  /** Decodes the record at (x, y), fills its cells and returns its run. */
  private record(x: number, y: number): number {
    this.recordStart = this.pos;
    this.x = x;
    this.y = y;
    const flag1 = this.u8();
    const flag2 = (flag1 & 1) === 0 ? 0 : this.u8();
    const flag3 = (flag2 & 1) === 0 ? 0 : this.u8();
    const flag4 = (flag3 & 1) === 0 ? 0 : this.u8();

    const hasBlock = (flag1 & 2) !== 0;
    const hasWall = (flag1 & 4) !== 0;
    const liquid = (flag1 >> 3) & 3;
    const runWidth = flag1 >> 6;
    const shape = (flag2 >> 4) & 7;
    const shimmer = (flag3 & 0x80) !== 0;
    const hasBlockPaint = (flag3 & 8) !== 0;
    const hasWallPaint = (flag3 & 16) !== 0;
    const hasWallHigh = (flag3 & 64) !== 0;

    if ((flag2 & 0x80) !== 0 || (flag4 & 0xe1) !== 0) this.fail("reserved bit");
    if (runWidth === 3) this.fail("reserved run width");
    if (shape > 5) this.fail("undefined block shape");
    if (shimmer && liquid !== 1) this.fail("shimmer without water");
    if (!hasBlock && ((flag1 & 32) !== 0 || hasBlockPaint || shape !== 0)) this.fail("flag without owner");
    if (!hasWall && (hasWallPaint || hasWallHigh)) this.fail("flag without owner");

    let blockIndex = NO_CONTENT;
    let framed = false;
    let frameX = -1;
    let frameY = -1;
    let paint = 0;
    if (hasBlock) {
      const id = (flag1 & 32) === 0 ? this.u8() : this.u8() | (this.u8() << 8);
      if (id >= this.sections.frameImportantCount) this.fail("no frame-important entry");
      blockIndex = this.paletteIndex(this.palette.block(id));
      framed = isFrameImportant(this.sections, id);
      if (framed) {
        frameX = this.i16();
        frameY = this.i16();
      }
      if (hasBlockPaint) paint = this.u8();
    }
    let wallId = 0;
    let wallPaint = 0;
    if (hasWall) {
      wallId = this.u8();
      if (hasWallPaint) wallPaint = this.u8();
    }
    const amount = liquid === 0 ? 0 : this.u8();
    if (hasWallHigh) wallId |= this.u8() << 8;
    if (hasWall && wallId === 0) this.fail("wall flag with wall id 0");
    const wallIndex = hasWall ? this.paletteIndex(this.palette.wall(wallId)) : NO_CONTENT;
    const run = runWidth === 0 ? 0 : runWidth === 1 ? this.u8() : this.i16();
    if (run < 0) this.fail("negative run");
    if (y + run > this.height - 1) this.fail("run crosses column end");

    // flag2 bits 1-3 = wires red/blue/green -> flags 0-2; flag3 yellow (5) -> 3, actuator (1) -> 4, inactive (2) -> 5;
    // flag4 bits 1-4 (invisible and full-bright block/wall) -> flags 6-9.
    const flags = ((flag2 >> 1) & 7) | ((flag3 & 0x20) >> 2) | ((flag3 & 2) << 3) | ((flag3 & 4) << 3) |
      ((flag4 & 0x1e) << 5);
    const kind = shimmer ? SHIMMER : liquid;
    const first = x * this.height + y;
    const end = first + run + 1;
    const { planes } = this;
    if (hasBlock) {
      planes.block.fill(blockIndex, first, end);
      if (framed) {
        planes.frameX.fill(frameX, first, end);
        planes.frameY.fill(frameY, first, end);
      }
      if (paint !== 0) planes.paint.fill(paint, first, end);
    }
    if (hasWall) {
      planes.wall.fill(wallIndex, first, end);
      if (wallPaint !== 0) planes.wallPaint.fill(wallPaint, first, end);
    }
    if (kind !== 0) {
      planes.liquid.fill(kind, first, end);
      if (amount !== 0) planes.liquidAmount.fill(amount, first, end);
    }
    if (shape !== 0) planes.shape.fill(shape, first, end);
    if (flags !== 0) planes.flags.fill(flags, first, end);
    return run;
  }
}

/**
 * Decodes the tile section (docs/file-format/tiles.md, "Tile data (section 2)") straight into CWM planes.
 * Malformed records throw `MalformedTiles` with the record's `x`, `y` and absolute `offset`.
 */
export function readWorldTiles(bytes: Uint8Array): WorldTilesResult {
  const world = readWorldMetadata(bytes);
  const { width, height } = world.metadata;
  const decoder = new TileDecoder(bytes, world.sections, width, height);
  decoder.decode();
  return { ...world, planes: decoder.planes, palette: decoder.palette.entries };
}
