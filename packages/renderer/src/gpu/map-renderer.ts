// The WebGL2 backend draws into a DOM canvas; the DOM types are declared here, where they are used, so the rest of
// the package keeps the DOM-free lib of the base config.
/// <reference lib="dom" />

import type { ContentRef } from "@studio/world-model";
import { CHUNK_SIZE, visibleChunks } from "../camera/camera.js";
import type { Camera, ChunkCoord, Size } from "../camera/camera.js";
import { filterTilesPerPixel } from "../chunk/box-filter.js";
import { WIRE_ALPHA, WIRE_COLORS, WIRE_LAYER, type ChunkLayers } from "../chunk/render.js";
import { createChunkCellCache } from "../framing/chunk-cells.js";
import type { ChunkCellCache } from "../framing/chunk-cells.js";
import type { BlockFraming } from "../framing/frame-block.js";
import { backgroundColor, contentColor, liquidColors } from "../palette/map-palette.js";
import type { MapPalette } from "../palette/map-palette.js";
import {
  CELLS_INSTANCE_BIT, LAYER_ATTRIBUTE, PAGE_APRON, PLANES_16, PLANES_8, PLANE_COUNT_16, PLANE_COUNT_8, PRESENT, RECT_ATTRIBUTE,
  RULE_HEADER_ROWS, RULE_ROW, SPRITE_MIN_ZOOM, SPRITE_SHEET_ROW, SPRITE_STATE, chunkFragmentSource, chunkVertexSource, overviewBuildFragmentSource,
  overviewBuildVertexSource, overviewFragmentSource, overviewVertexSource,
} from "./shaders.js";

/** The slice of a world the renderer reads. Planes are column-major (`x * height + y`); never copied by the caller. */
export interface RenderableWorld {
  readonly width: number;
  readonly height: number;
  /** The world's surface level: the sky is above it. */
  readonly surfaceY: number;
  /** The world's rock level; without one the dirt layer reaches the underworld (only drawn with a map palette). */
  readonly rockY?: number;
  readonly planes: {
    readonly block: Uint16Array;
    readonly wall: Uint16Array;
    readonly liquid: Uint8Array;
    readonly liquidAmount: Uint8Array;
    readonly paint: Uint8Array;
    readonly wallPaint: Uint8Array;
    /**
     * Frame planes pick the map option of multi-option content; absent planes mean frame 0 everywhere. They are
     * uploaded as their 16-bit pattern (through a Uint16Array view of the same memory) and sign-extended on the GPU.
     */
    readonly frameX?: Int16Array;
    readonly frameY?: Int16Array;
    /** CWM flags; only the wire and actuator bits (0–4) are read, for the wire overlay. Absent means none. */
    readonly flags?: Uint16Array;
    /** Block shapes (0 full, 1 half, 2–5 slopes): framing and drawing of self-framed blocks. Absent means all full. */
    readonly shape?: Uint8Array;
  };
  /** Append-only palette. */
  readonly palette: readonly ContentRef[];
}

/** One sheet of a sprite atlas: where it lies on its page and the size of its frame cells (docs/assets.md, "Atlas"). */
export interface SpriteSheetEntry {
  readonly kind: "tile" | "wall";
  readonly id: number;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

/**
 * A sprite atlas as the renderer reads it: square RGBA8 pages (`pageSize² × 4` bytes, straight alpha) and the sheets
 * on them. `@studio/assets`' `SpriteAtlas` has this shape.
 */
export interface SpriteAtlasSource {
  readonly pages: readonly Uint8Array[];
  readonly index: { readonly pageSize: number; readonly entries: readonly SpriteSheetEntry[] };
}

export interface MapRendererOptions {
  /**
   * Upper bound of chunks uploaded per scheduled animation frame. Default 256; the time budget below usually ends a
   * frame's uploads first (a chunk upload is one texSubImage3D per plane, about 0.08 ms). Finite values are
   * floored and clamped to at least 1; non-finite values use the default.
   */
  readonly maxChunkUploadsPerFrame?: number;
  /**
   * Time a scheduled animation frame may spend on chunk uploads, in milliseconds. Default 8. Once it is spent the
   * frame uploads no more chunks (it always uploads one), so a fast machine uploads more chunks per frame than a slow
   * one and input stays responsive on both. Positive values and `Infinity` (no time limit) are accepted; others use the
   * default.
   */
  readonly maxUploadMillisecondsPerFrame?: number;
  /**
   * Baseline chunk texture cache capacity (LRU). Default 512 (about 150 MiB of chunk pages).
   * Grows to fit the largest set drawn chunk by chunk (at half a pixel per tile and above, so bounded by the
   * viewport) for the current world; resets when the world changes. Zoomed-out views come from the overview and do
   * not grow it.
   */
  readonly maxCachedChunks?: number;
  /** Map colours (content, paint, background by depth), as in `renderChunk`; without one, placeholders are drawn. */
  readonly mapPalette?: MapPalette;
}

export interface MapRendererStats {
  /**
   * Texture uploads since creation: one per chunk upload (all its planes), one per palette append (colours and map
   * option rules) and one per background (once per world).
   */
  readonly textureUploads: number;
  /** Draw calls issued on the canvas by the last synchronous or scheduled frame. */
  readonly drawCalls: number;
  /** Chunks drawn by the last synchronous or scheduled frame, at full resolution or through the overview. */
  readonly visibleChunks: readonly ChunkCoord[];
  /** Chunks currently held by the cache. */
  readonly residentChunks: number;
  /** Chunks evicted from the cache since creation (to make room for uploads). */
  readonly evictedChunks: number;
  /** Sprite atlas uploads since creation: one per `setAtlas` with an atlas (and after a context restore). */
  readonly atlasUploads: number;
  /**
   * Tiles framed since creation: every tile of a chunk (air and other content included) once on its first upload at a
   * sprite zoom, and the cached tiles of the areas `invalidateTiles` recomputes.
   */
  readonly framedTiles: number;
}

export interface MapRenderer {
  readonly setWorld: (world: RenderableWorld | null) => void;
  /** The viewport is the canvas backing store (`canvas.width` × `canvas.height`). */
  readonly setCamera: (camera: Camera) => void;
  readonly setLayers: (layers: ChunkLayers) => void;
  /**
   * The sprite atlas, uploaded at once and kept until replaced; null removes it. Frame-important blocks (a stored
   * frame) whose content ID has a tile sheet are drawn from it in sprite mode. Throws when the GPU cannot hold it.
   */
  readonly setAtlas: (atlas: SpriteAtlasSource | null) => void;
  /**
   * Sprite mode: from `SPRITE_MIN_ZOOM` pixels per tile, frame-important blocks show their sprite (and, with a framing,
   * self-framed blocks their framed cell). A uniform switch: turning it on or off, or crossing the zoom threshold,
   * uploads no chunk planes and no atlas. The one exception is a resident chunk's first draw at a sprite zoom with a
   * framing, which frames it and uploads its cells once (`setFraming`).
   */
  readonly setSpriteMode: (enabled: boolean) => void;
  /**
   * The block framing (`createBlockFraming`): with it, sprite mode also draws self-framed blocks (dirt, stone, ores,
   * grass, …) with the cell their neighbours give them, half blocks and slopes cut by their shape. A chunk is framed
   * on its first upload at a sprite zoom and keeps its cells while it stays resident; null draws them in map colours.
   */
  readonly setFraming: (framing: BlockFraming | null) => void;
  /**
   * After the world's planes changed at `tiles`: recomputes the framed cells around them (docs/assets.md, "Inputs
   * beyond 3 × 3": up to d + 1 tiles away, d the deepest framing depth there) and uploads the touched chunks again.
   */
  readonly invalidateTiles: (tiles: readonly { readonly x: number; readonly y: number }[]) => void;
  /** Integer tile under a canvas pixel, or null outside the world. */
  readonly tileAt: (screenX: number, screenY: number) => { readonly x: number; readonly y: number } | null;
  /** Uploads and draws all visible chunks synchronously. Setters schedule frames with bounded chunk uploads. */
  readonly render: () => void;
  readonly stats: () => MapRendererStats;
  readonly dispose: () => void;
}

/** Thrown by `createMapRenderer` when the canvas cannot provide a WebGL2 context. */
export class WebGl2UnavailableError extends Error {
  constructor() {
    super("WebGL2 is not available in this browser");
    this.name = "WebGl2UnavailableError";
  }
}

const PALETTE_ROW = 256;
const PALETTE_WIDTH = PALETTE_ROW * 2;
const PALETTE_CAPACITY = 0xffff;
const PALETTE_HEIGHT = PALETTE_ROW;
const DEFAULT_MAX_CACHED_CHUNKS = 512;
const DEFAULT_MAX_CHUNK_UPLOADS_PER_FRAME = 256;
const DEFAULT_MAX_UPLOAD_MILLISECONDS_PER_FRAME = 8;
/**
 * Chunks per page. A page holds one layer per plane and chunk: 32 × 6 = 192 layers of the 16-bit texture and
 * 32 × 5 = 160 of the 8-bit one, within the 256 array layers WebGL2 guarantees, with room for two more 16-bit
 * planes (32 × 8 = 256). A page of both textures is about 9.2 MiB.
 */
const CHUNKS_PER_PAGE = 32;
/** Texels per side of a page layer: the chunk and its apron of neighbouring tiles on every side. */
const PAGE_SIZE = CHUNK_SIZE + 2 * PAGE_APRON;
/** Ints per instance: the chunk rectangle (origin x, origin y, columns, rows) and its page layer. */
const INSTANCE_INTS = 5;
/** The smallest overview factor: one overview texel per 2 × 2 tiles, used below half a pixel per tile. */
const MIN_OVERVIEW_FACTOR = 2;

// Texture units: 0–1 the chunk page; 2 palette; 3 background and paint colours; 4 map option rules; 5 overview;
// 6 sprite atlas pages; 7 sprite sheet lookup. WebGL2 guarantees 16.
const UNIT_PLANES_16 = 0;
const UNIT_PLANES_8 = 1;
const UNIT_PALETTE = 2;
const UNIT_BACKGROUND = 3;
const UNIT_RULES = 4;
const UNIT_OVERVIEW = 5;
const UNIT_ATLAS = 6;
const UNIT_SPRITE_SHEETS = 7;
const TEXTURE_UNITS = 8;
/**
 * Tile IDs sprite mode leaves in map colours although they store frames: trees and the giant mushroom (5 Tree,
 * 72 Giant Mushroom, 323 Palm Tree, 583–589 gem trees, 596, 616 and 634 vanity and ash trees, by the shipped content
 * names). Their trunk cells are wider than a tile and overlap, their tops and branches come from other sheets, and the
 * palm tree's frame is not a sheet offset (docs/assets.md, "Special handling": trees are deferred).
 */
export const SPRITE_DEFERRED_TILES: ReadonlySet<number> = new Set([5, 72, 323, 583, 584, 585, 586, 587, 588, 589, 596, 616, 634]);
/** Texels per row of the sprite sheet lookup: two per palette index (SPRITE_SHEET_ROW in shaders.ts). */
const SPRITE_SHEET_WIDTH = SPRITE_SHEET_ROW * 2;

const TILE_UNIFORMS = [
  "uPlanes16", "uPlanes8", "uPresent", "uPalette", "uBackground", "uRules", "uPaintRow", "uPaintCount", "uPaletteLength",
  "uLayers", "uLiquids", "uWireColors", "uWireBits", "uWireAlpha", "uAtlas", "uSpriteSheets", "uSprites",
] as const;
const CHUNK_UNIFORMS = [...TILE_UNIFORMS, "uCamera", "uZoom", "uViewport", "uFilter", "uStep", "uWorldSize"] as const;
const BUILD_UNIFORMS = [...TILE_UNIFORMS, "uFactor", "uTarget"] as const;
const OVERVIEW_UNIFORMS = ["uCamera", "uZoom", "uViewport", "uWorld", "uExtent", "uOverview"] as const;

interface Program<Name extends string> {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<Name, WebGLUniformLocation>>;
}

/** One array texture per plane format, holding up to CHUNKS_PER_PAGE chunks with their aprons, a layer per plane. */
interface Page {
  /** R16UI, PLANES_16 per chunk: block, wall, flags, frameX, frameY, framed cell. */
  readonly planes16: WebGLTexture;
  /** R8UI, PLANES_8 per chunk: liquid kind, liquid amount, block paint, wall paint, block shape. */
  readonly planes8: WebGLTexture;
}

/** One plane of a world as uploaded: its layer within a chunk's layers and the memory read in place. */
interface PlaneSource {
  readonly plane: number;
  readonly data: Uint16Array | Uint8Array;
}

/** The planes of one world, by page texture. */
interface WorldPlanes {
  readonly world: RenderableWorld;
  readonly planes16: readonly PlaneSource[];
  readonly planes8: readonly PlaneSource[];
  /** PRESENT bits of the optional planes. */
  readonly present: number;
}

/**
 * The map option rules of a map palette, for the rules texture: the ranges of every ruled tile ID, and where they are.
 */
interface RuleTable {
  /** (from, to, colour, 0) per range, RGBA32I, RULE_ROW per row. */
  readonly ranges: Int32Array;
  readonly rows: number;
  /** By tile ID: (first range, range count, axis, colour of option 0), the header of each palette entry with that ID. */
  readonly headers: ReadonlyMap<number, readonly [number, number, number, number]>;
}

/** Everything owned by one GL context; rebuilt after a context loss. */
interface GpuResources {
  readonly chunk: Program<(typeof CHUNK_UNIFORMS)[number]>;
  readonly build: Program<(typeof BUILD_UNIFORMS)[number]>;
  readonly overview: Program<(typeof OVERVIEW_UNIFORMS)[number]>;
  /** Instance attributes of the chunk passes. */
  readonly instances: WebGLBuffer;
  readonly instanceArray: WebGLVertexArrayObject;
  /** No attributes: the overview quad comes from gl_VertexID. */
  readonly emptyArray: WebGLVertexArrayObject;
  readonly framebuffer: WebGLFramebuffer;
  readonly palette: WebGLTexture;
  /** Map option rules: headers by palette index, then the ranges (see RULE_ROW in shaders.ts). */
  readonly rules: WebGLTexture;
  /** The sheet of each palette index (SPRITE_SHEET_ROW in shaders.ts); all zero (no sheet) without an atlas. */
  readonly spriteSheets: WebGLTexture;
}

/** The overview of one world: a mipmapped RGBA8 texture, one texel per factor × factor tiles, premultiplied. */
interface Overview {
  readonly world: RenderableWorld;
  readonly texture: WebGLTexture;
  readonly factor: number;
  readonly width: number;
  readonly height: number;
  /** Per chunk (y * chunksX + x): 1 once its texels hold the current layers. */
  readonly built: Uint8Array;
  /** Number of chunks marked in `built`. */
  builtCount: number;
  /** Whether any texel was ever built: invalidation keeps the old texels until the rebuild overwrites them. */
  filled: boolean;
}

function requireValue<T>(value: T | null, what: string): T {
  if (value === null) throw new Error(`WebGL2 could not create ${what}`);
  return value;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = requireValue(gl.createShader(type), "a shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!(gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean)) {
    throw new Error(`Shader compilation failed: ${gl.getShaderInfoLog(shader) ?? "unknown error"}`);
  }
  return shader;
}

function link<Name extends string>(
  gl: WebGL2RenderingContext, vertex: string, fragment: string, names: readonly Name[],
): Program<Name> {
  const program = requireValue(gl.createProgram(), "a program");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!(gl.getProgramParameter(program, gl.LINK_STATUS) as boolean)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program) ?? "unknown error"}`);
  }
  const uniforms = Object.fromEntries(
    names.map((name) => [name, requireValue(gl.getUniformLocation(program, name), `uniform ${name}`)]),
  ) as Record<Name, WebGLUniformLocation>;
  return { program, uniforms };
}

function integerTexture(gl: WebGL2RenderingContext, format: number, width: number, height: number): WebGLTexture {
  const texture = requireValue(gl.createTexture(), "a texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
  // Integer textures are incomplete unless they use NEAREST filtering.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

function pageTexture(gl: WebGL2RenderingContext, format: number, planes: number): WebGLTexture {
  const texture = requireValue(gl.createTexture(), "a texture");
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, format, PAGE_SIZE, PAGE_SIZE, CHUNKS_PER_PAGE * planes);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

function instanceArray(gl: WebGL2RenderingContext, buffer: WebGLBuffer): WebGLVertexArrayObject {
  const array = requireValue(gl.createVertexArray(), "a vertex array");
  gl.bindVertexArray(array);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(RECT_ATTRIBUTE);
  gl.enableVertexAttribArray(LAYER_ATTRIBUTE);
  gl.vertexAttribDivisor(RECT_ATTRIBUTE, 1);
  gl.vertexAttribDivisor(LAYER_ATTRIBUTE, 1);
  gl.bindVertexArray(null);
  return array;
}

/**
 * The rules of every tile ID with a frame → option rule and map colours, in ID order: each range carries the colour
 * of its option (`optionColor`: an option the ID lacks falls back to option 0), each header the colour of option 0,
 * which a frame outside every range selects (`mapOption`).
 */
function ruleTable(mapPalette: MapPalette | undefined): RuleTable {
  const headers = new Map<number, readonly [number, number, number, number]>();
  const ranges: number[] = [];
  const entries = Object.entries(mapPalette?.tileOptions ?? {}).map(([id, rule]) => [Number(id), rule] as const);
  for (const [id, rule] of entries.sort(([first], [second]) => first - second)) {
    const colors = mapPalette?.tiles[id];
    const fallback = colors?.[0];
    if (colors === undefined || fallback === undefined) continue;
    headers.set(id, [ranges.length / 4, rule.ranges.length, rule.axis === "frameX" ? 0 : 1, fallback]);
    for (const [from, to, option] of rule.ranges) ranges.push(from, to, colors[option] ?? fallback, 0);
  }
  const rows = Math.ceil(ranges.length / 4 / RULE_ROW);
  const padded = new Int32Array(rows * RULE_ROW * 4);
  padded.set(ranges);
  return { ranges: padded, rows, headers };
}

/** Throws when the GPU offers fewer texture units or array layers than the map needs. */
function checkLimits(gl: WebGL2RenderingContext): void {
  const units = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number;
  if (units < TEXTURE_UNITS) {
    throw new Error(`The map needs ${String(TEXTURE_UNITS)} texture units; this GPU offers ${String(units)}`);
  }
  const layers = gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number;
  const needed = CHUNKS_PER_PAGE * Math.max(PLANE_COUNT_16, PLANE_COUNT_8);
  if (layers < needed) {
    throw new Error(`The map needs ${String(needed)} array texture layers; this GPU offers ${String(layers)}`);
  }
}

/**
 * Sets GL's default unpack state. The context belongs to the canvas, not the renderer: a previous renderer on the
 * same canvas, or other code, may have left any state behind.
 */
function defaultUnpack(gl: WebGL2RenderingContext): void {
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
  gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  gl.pixelStorei(gl.UNPACK_SKIP_IMAGES, 0);
}

function createResources(gl: WebGL2RenderingContext, rules: RuleTable): GpuResources {
  defaultUnpack(gl);
  const instances = requireValue(gl.createBuffer(), "a buffer");
  const rulesTexture = integerTexture(gl, gl.RGBA32I, RULE_ROW, RULE_HEADER_ROWS + rules.rows);
  if (rules.rows > 0) {
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, RULE_HEADER_ROWS, RULE_ROW, rules.rows, gl.RGBA_INTEGER, gl.INT, rules.ranges);
  }
  return {
    chunk: link(gl, chunkVertexSource, chunkFragmentSource, CHUNK_UNIFORMS),
    build: link(gl, overviewBuildVertexSource, overviewBuildFragmentSource, BUILD_UNIFORMS),
    overview: link(gl, overviewVertexSource, overviewFragmentSource, OVERVIEW_UNIFORMS),
    instances,
    instanceArray: instanceArray(gl, instances),
    emptyArray: requireValue(gl.createVertexArray(), "a vertex array"),
    framebuffer: requireValue(gl.createFramebuffer(), "a framebuffer"),
    palette: integerTexture(gl, gl.RGBA8UI, PALETTE_WIDTH, PALETTE_HEIGHT),
    rules: rulesTexture,
    spriteSheets: integerTexture(gl, gl.RGBA32I, SPRITE_SHEET_WIDTH, PALETTE_HEIGHT),
  };
}

function layerBits(layers: ChunkLayers): number {
  return (layers.background ? 1 : 0) | (layers.walls ? 2 : 0) | (layers.blocks ? 4 : 0) | (layers.liquids ? 8 : 0)
    | (((layers.wires ?? 0) & WIRE_LAYER.all) << 4);
}

const wireColorUniform = new Int32Array(WIRE_COLORS.flatMap(([, color]) => [...color]));
const wireBitUniform = new Int32Array(WIRE_COLORS.map(([bit]) => bit));

export function createMapRenderer(canvas: HTMLCanvasElement, options?: MapRendererOptions): MapRenderer {
  // Straight (non-premultiplied) alpha: the shader writes the same RGBA that `renderChunk` produces. No multisampling:
  // it would blend a pixel the edge of a chunk quad crosses (the world's edge at a sub-tile camera) by coverage.
  const context = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false });
  if (context === null) throw new WebGl2UnavailableError();
  const gl: WebGL2RenderingContext = context;
  const maxCachedChunks = Math.max(1, options?.maxCachedChunks ?? DEFAULT_MAX_CACHED_CHUNKS);
  const requestedUploadBudget = options?.maxChunkUploadsPerFrame ?? DEFAULT_MAX_CHUNK_UPLOADS_PER_FRAME;
  const maxChunkUploadsPerFrame = Number.isFinite(requestedUploadBudget)
    ? Math.max(1, Math.floor(requestedUploadBudget))
    : DEFAULT_MAX_CHUNK_UPLOADS_PER_FRAME;
  const requestedUploadTime = options?.maxUploadMillisecondsPerFrame ?? DEFAULT_MAX_UPLOAD_MILLISECONDS_PER_FRAME;
  const maxUploadMillisecondsPerFrame = requestedUploadTime > 0
    ? requestedUploadTime
    : DEFAULT_MAX_UPLOAD_MILLISECONDS_PER_FRAME;
  const mapPalette = options?.mapPalette;
  // The four liquid kinds (CWM kinds 1–4) as the shader's ivec3 array.
  const liquidUniform = new Int32Array(liquidColors(mapPalette).slice(1).flatMap(([red, green, blue]) => [red, green, blue]));
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  checkLimits(gl);
  const rules = ruleTable(mapPalette);

  // Looked up once: getExtension returns null while the context is lost. Used only to restore a forced loss.
  const loseContext = gl.getExtension("WEBGL_lose_context");
  let resources = createResources(gl, rules);
  let world: RenderableWorld | null = null;
  let cacheCapacity = maxCachedChunks;
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let layers = 15;
  // LRU of chunk key → page slot (page * CHUNKS_PER_PAGE + slot in page): Map iteration order is insertion order, and
  // a hit re-inserts its key at the end.
  const chunks = new Map<number, number>();
  const pages: Page[] = [];
  const freeSlots: number[] = [];
  let nextSlot = 0;
  let planeSources: WorldPlanes | null = null;
  let instanceData = new Int32Array(INSTANCE_INTS * 256);
  const paletteMirror = new Uint8Array(PALETTE_WIDTH * PALETTE_HEIGHT * 4);
  // Rule headers by palette index, written only with a palette that has rules (the texture starts zeroed: no rule).
  const ruleHeaders = rules.headers.size === 0 ? null : new Int32Array(RULE_ROW * RULE_HEADER_ROWS * 4);
  let paletteUploaded = 0;
  // Sprite mode: the atlas as given, its pages on the GPU, and the sheet lookup by palette index.
  let atlas: SpriteAtlasSource | null = null;
  let atlasTexture: WebGLTexture | null = null;
  let tileSheets = new Map<number, SpriteSheetEntry>();
  const sheetMirror = new Int32Array(SPRITE_SHEET_WIDTH * PALETTE_HEIGHT * 4);
  let spriteMode = false;
  let atlasUploads = 0;
  // Self-framed blocks: the framing, the framed cells of the current world's resident chunks, and the slots whose cell
  // layer holds their chunk's current cells. Tiles framed by caches already let go are kept in framedBefore.
  let framing: BlockFraming | null = null;
  let cellCache: ChunkCellCache | null = null;
  let framedBefore = 0;
  const framedSlots = new Set<number>();
  // Resident chunks whose planes changed (invalidateTiles): uploaded again on their next draw.
  const dirtyChunks = new Set<number>();
  // The world the plane unpack state (alignment, row length, image height) is set for; null for GL's defaults. Chunk
  // uploads set it once and then only move the skip parameters; other uploads restore the defaults first.
  let unpackWorld: RenderableWorld | null = null;
  // Per-row background colours plus the paint row, for the world they were computed for.
  let background: { readonly texture: WebGLTexture; readonly world: RenderableWorld; readonly paintRow: number } | null = null;
  let overview: Overview | null = null;
  // The overview build order of the last frame's camera, viewport and world (see overviewFootprint).
  let sweep: {
    readonly world: RenderableWorld; readonly camera: Camera; readonly width: number; readonly height: number;
    readonly order: readonly ChunkCoord[];
  } | null = null;
  const paintCount = mapPalette === undefined ? 0 : Math.min(PALETTE_ROW, mapPalette.paints.length);
  let textureUploads = 0;
  let evictedChunks = 0;
  let drawCalls = 0;
  let drawn: readonly ChunkCoord[] = [];
  let frame = 0;
  let disposed = false;

  /** Lets go of the framed cells (the next sprite-mode upload frames chunks again); the slots' cell layers are stale. */
  const releaseCells = (): void => {
    framedBefore += cellCache?.framedTiles ?? 0;
    cellCache = null;
    framedSlots.clear();
  };

  const clearChunks = (): void => {
    for (const page of pages) {
      gl.deleteTexture(page.planes16);
      gl.deleteTexture(page.planes8);
    }
    pages.length = 0;
    chunks.clear();
    freeSlots.length = 0;
    nextSlot = 0;
    dirtyChunks.clear();
    releaseCells();
  };

  const releaseOverview = (): void => {
    if (overview !== null && !gl.isContextLost()) gl.deleteTexture(overview.texture);
    overview = null;
    // The cached sweep order references its world: drop it so the previous world's planes can be collected.
    sweep = null;
  };

  /**
   * Marks every overview texel stale: their chunks draw them again on demand. The texture is not cleared, so the old
   * texels stay visible until the rebuild overwrites them and the map never blanks.
   */
  const invalidateOverview = (): void => {
    if (overview === null) return;
    overview.built.fill(0);
    overview.builtCount = 0;
  };

  /** Restores GL's default unpack state after chunk uploads. */
  const resetUnpack = (): void => {
    if (unpackWorld === null) return;
    defaultUnpack(gl);
    unpackWorld = null;
  };

  const uploadPalette = (palette: readonly ContentRef[]): void => {
    const total = Math.min(palette.length, PALETTE_CAPACITY);
    if (total <= paletteUploaded) return;
    for (let index = paletteUploaded; index < total; index++) {
      const ref = palette[index];
      if (ref === undefined) break;
      const row = Math.floor(index / PALETTE_ROW);
      const column = index % PALETTE_ROW;
      paletteMirror.set(contentColor(ref, "block", mapPalette), (row * PALETTE_WIDTH + column) * 4);
      paletteMirror.set(contentColor(ref, "wall", mapPalette), (row * PALETTE_WIDTH + PALETTE_ROW + column) * 4);
      ruleHeaders?.set((ref.kind === "vanilla" ? rules.headers.get(ref.id) : undefined) ?? [0, 0, 0, 0], index * 4);
    }
    const firstRow = Math.floor(paletteUploaded / PALETTE_ROW);
    const lastRow = Math.floor((total - 1) / PALETTE_ROW);
    resetUnpack();
    gl.activeTexture(gl.TEXTURE0 + UNIT_PALETTE);
    gl.bindTexture(gl.TEXTURE_2D, resources.palette);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, PALETTE_WIDTH);
    // Only the appended entries: a partial first/last row is cut at the entry, in both colour halves.
    for (let row = firstRow; row <= lastRow; row++) {
      const start = row === firstRow ? paletteUploaded % PALETTE_ROW : 0;
      const end = row === lastRow ? ((total - 1) % PALETTE_ROW) + 1 : PALETTE_ROW;
      for (const half of [0, PALETTE_ROW]) {
        gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, half + start);
        gl.pixelStorei(gl.UNPACK_SKIP_ROWS, row);
        gl.texSubImage2D(
          gl.TEXTURE_2D, 0, half + start, row, end - start, 1, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, paletteMirror,
        );
      }
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    if (ruleHeaders !== null) {
      // Whole rows: headers of a previous world's palette are overwritten with this one's.
      gl.activeTexture(gl.TEXTURE0 + UNIT_RULES);
      gl.bindTexture(gl.TEXTURE_2D, resources.rules);
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, firstRow, RULE_ROW, lastRow - firstRow + 1, gl.RGBA_INTEGER, gl.INT,
        ruleHeaders.subarray(firstRow * RULE_ROW * 4),
      );
    }
    if (atlas !== null) uploadSheets(palette, paletteUploaded, total);
    textureUploads++;
    // Content colours the overview already holds may have been absent (out of range) before this append.
    invalidateOverview();
    paletteUploaded = total;
  };

  /**
   * Writes the sheet of palette indices `from` … `to` - 1 into the lookup (whole rows). With an atlas, an index whose
   * content has a tile sheet gets its place and frame size, deferred content (trees) the map colour, and any other
   * (newer than the install, mod, unknown) the missing-texture state; the shader only uses it for blocks with a
   * stored frame. Without an atlas every index has the map colour.
   */
  const uploadSheets = (palette: readonly ContentRef[], from: number, to: number): void => {
    if (to <= from) return;
    for (let index = from; index < to; index++) {
      const ref = palette[index];
      const vanilla = ref?.kind === "vanilla" ? ref.id : undefined;
      const sheet = vanilla === undefined ? undefined : tileSheets.get(vanilla);
      const at = ((Math.floor(index / SPRITE_SHEET_ROW) * SPRITE_SHEET_WIDTH) + (index % SPRITE_SHEET_ROW) * 2) * 4;
      if (sheet !== undefined) {
        sheetMirror.set([sheet.page, sheet.x, sheet.y, SPRITE_STATE.sheet, sheet.width, sheet.height, sheet.frameWidth, sheet.frameHeight], at);
      } else {
        const deferred = atlasTexture === null || (vanilla !== undefined && SPRITE_DEFERRED_TILES.has(vanilla));
        sheetMirror.set([0, 0, 0, deferred ? SPRITE_STATE.mapColor : SPRITE_STATE.missing, 0, 0, 0, 0], at);
      }
    }
    const firstRow = Math.floor(from / SPRITE_SHEET_ROW);
    const lastRow = Math.floor((to - 1) / SPRITE_SHEET_ROW);
    resetUnpack();
    gl.activeTexture(gl.TEXTURE0 + UNIT_SPRITE_SHEETS);
    gl.bindTexture(gl.TEXTURE_2D, resources.spriteSheets);
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, firstRow, SPRITE_SHEET_WIDTH, lastRow - firstRow + 1, gl.RGBA_INTEGER, gl.INT,
      sheetMirror.subarray(firstRow * SPRITE_SHEET_WIDTH * 4),
    );
  };

  /** Uploads the atlas pages as one RGBA8 array texture, one layer per page. */
  const uploadAtlas = (source: SpriteAtlasSource): void => {
    const { pageSize } = source.index;
    const pageCount = Math.max(1, source.pages.length);
    if (pageSize > maxTextureSize || pageCount > (gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number)) {
      throw new Error(`This GPU cannot hold a sprite atlas of ${String(pageCount)} pages of ${String(pageSize)} pixels`);
    }
    resetUnpack();
    const texture = requireValue(gl.createTexture(), "a texture");
    gl.activeTexture(gl.TEXTURE0 + UNIT_ATLAS);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, pageSize, pageSize, pageCount);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    source.pages.forEach((page, layer) => {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, pageSize, pageSize, 1, gl.RGBA, gl.UNSIGNED_BYTE, page);
    });
    atlasTexture = texture;
    atlasUploads++;
  };

  const releaseAtlas = (): void => {
    if (atlasTexture !== null && !gl.isContextLost()) gl.deleteTexture(atlasTexture);
    atlasTexture = null;
  };

  /** Puts `source` on the GPU and rewrites the sheet of every palette index uploaded so far. */
  const applyAtlas = (source: SpriteAtlasSource | null): void => {
    releaseAtlas();
    tileSheets = new Map(source?.index.entries
      .filter((entry) => entry.kind === "tile" && !SPRITE_DEFERRED_TILES.has(entry.id))
      .map((entry) => [entry.id, entry]));
    if (source !== null) uploadAtlas(source);
    if (world !== null) uploadSheets(world.palette, 0, paletteUploaded);
  };

  const allocateSlot = (): number => {
    const free = freeSlots.pop();
    if (free !== undefined) return free;
    const slot = nextSlot++;
    if (slot >= pages.length * CHUNKS_PER_PAGE) {
      pages.push({ planes16: pageTexture(gl, gl.R16UI, PLANE_COUNT_16), planes8: pageTexture(gl, gl.R8UI, PLANE_COUNT_8) });
    }
    return slot;
  };

  /** The planes of `source` to upload, by page texture; the frame planes as Uint16Array views of their memory. */
  const planesOf = (source: RenderableWorld): WorldPlanes => {
    if (planeSources?.world === source) return planeSources;
    const { block, wall, flags, frameX, frameY, liquid, liquidAmount, paint, wallPaint, shape } = source.planes;
    const bits = (frame: Int16Array): Uint16Array => new Uint16Array(frame.buffer, frame.byteOffset, frame.length);
    const planes16: PlaneSource[] = [{ plane: PLANES_16.block, data: block }, { plane: PLANES_16.wall, data: wall }];
    let present = 0;
    if (flags !== undefined) {
      planes16.push({ plane: PLANES_16.flags, data: flags });
      present |= PRESENT.flags;
    }
    if (frameX !== undefined) {
      planes16.push({ plane: PLANES_16.frameX, data: bits(frameX) });
      present |= PRESENT.frameX;
    }
    if (frameY !== undefined) {
      planes16.push({ plane: PLANES_16.frameY, data: bits(frameY) });
      present |= PRESENT.frameY;
    }
    const planes8: PlaneSource[] = [
      { plane: PLANES_8.liquid, data: liquid }, { plane: PLANES_8.liquidAmount, data: liquidAmount },
      { plane: PLANES_8.paint, data: paint }, { plane: PLANES_8.wallPaint, data: wallPaint },
    ];
    if (shape !== undefined) {
      planes8.push({ plane: PLANES_8.shape, data: shape });
      present |= PRESENT.shape;
    }
    planeSources = { world: source, planes16, planes8, present };
    return planeSources;
  };

  /**
   * Uploads one chunk, with its apron of neighbouring tiles, into its page layers: one texSubImage3D per present plane,
   * read in place from the world's plane. A chunk is a rectangle of a column-major plane and a layer stores it
   * transposed, so the unpack parameters select it: an upload row is a world column (UNPACK_ROW_LENGTH is the world's
   * height, UNPACK_IMAGE_HEIGHT its width), starting at the chunk's first column (UNPACK_SKIP_ROWS) and first row
   * (UNPACK_SKIP_PIXELS). No tile is touched in JavaScript.
   */
  const uploadChunk = (source: RenderableWorld, chunk: ChunkCoord, slot: number): void => {
    const originX = chunk.x * CHUNK_SIZE;
    const originY = chunk.y * CHUNK_SIZE;
    // The apron, clipped to the world: texels past the world's edges keep stale values the shaders never read.
    const firstColumn = Math.max(-PAGE_APRON, -originX);
    const endColumn = Math.min(CHUNK_SIZE + PAGE_APRON, source.width - originX);
    const firstRow = Math.max(-PAGE_APRON, -originY);
    const endRow = Math.min(CHUNK_SIZE + PAGE_APRON, source.height - originY);
    const page = pages[Math.floor(slot / CHUNKS_PER_PAGE)];
    if (page === undefined) throw new Error(`chunk slot ${String(slot)} has no page`);
    const inPage = slot % CHUNKS_PER_PAGE;
    const { planes16, planes8 } = planesOf(source);
    if (unpackWorld !== source) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, source.height);
      // A 3D upload must fit its skipped rows within the image height, which defaults to the upload's own height.
      gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, source.width);
      unpackWorld = source;
    }
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, originY + firstRow);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, originX + firstColumn);
    const upload = (planes: readonly PlaneSource[], count: number, type: number): void => {
      for (const { plane, data } of planes) {
        gl.texSubImage3D(
          gl.TEXTURE_2D_ARRAY, 0, firstRow + PAGE_APRON, firstColumn + PAGE_APRON, inPage * count + plane,
          endRow - firstRow, endColumn - firstColumn, 1, gl.RED_INTEGER, type, data,
        );
      }
    };
    gl.activeTexture(gl.TEXTURE0 + UNIT_PLANES_16);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.planes16);
    upload(planes16, PLANE_COUNT_16, gl.UNSIGNED_SHORT);
    gl.activeTexture(gl.TEXTURE0 + UNIT_PLANES_8);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.planes8);
    upload(planes8, PLANE_COUNT_8, gl.UNSIGNED_BYTE);
    textureUploads++;
    // The slot's cell layer still holds the cells of whatever was there before.
    framedSlots.delete(slot);
  };

  /** The framed cells of `source`'s chunks; null without a framing. */
  const cellsOf = (source: RenderableWorld): ChunkCellCache | null => {
    if (framing === null) return null;
    if (cellCache?.world !== source) {
      releaseCells();
      cellCache = createChunkCellCache(source, framing);
    }
    return cellCache;
  };

  /**
   * Uploads the framed cells of `chunk` (framing it on first use) into the cell layer of its slot: the chunk's cells
   * without the apron, which the sprite pass never reads.
   */
  const uploadCells = (source: RenderableWorld, chunk: ChunkCoord, slot: number): void => {
    const cells = cellsOf(source)?.cells(chunk);
    const page = pages[Math.floor(slot / CHUNKS_PER_PAGE)];
    if (cells === undefined || page === undefined) return;
    const columns = Math.min(CHUNK_SIZE, source.width - chunk.x * CHUNK_SIZE);
    const rows = Math.min(CHUNK_SIZE, source.height - chunk.y * CHUNK_SIZE);
    resetUnpack();
    // Column-major cells are the transposed layer's rows: `rows` cells each, 2-byte aligned.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.activeTexture(gl.TEXTURE0 + UNIT_PLANES_16);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.planes16);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0, PAGE_APRON, PAGE_APRON, (slot % CHUNKS_PER_PAGE) * PLANE_COUNT_16 + PLANES_16.cell,
      rows, columns, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, cells,
    );
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    textureUploads++;
    framedSlots.add(slot);
  };

  /** Drops the background of the previous world: its texture and the reference that would keep its planes alive. */
  const releaseBackground = (): void => {
    if (background !== null && !gl.isContextLost()) gl.deleteTexture(background.texture);
    background = null;
  };

  /**
   * Background colour of every world row, resolved on the CPU by the same `backgroundColor` as `renderChunk` (so the
   * GPU output is exact), 256 rows per texture row; the last texture row holds the paint colours by paint ID.
   */
  const uploadBackground = (source: RenderableWorld): void => {
    if (background?.world === source) return;
    releaseBackground();
    const paintRow = Math.ceil(source.height / PALETTE_ROW);
    resetUnpack();
    const texels = new Uint8Array(PALETTE_ROW * (paintRow + 1) * 4);
    const depth = { surfaceY: source.surfaceY, height: source.height, ...(source.rockY === undefined ? {} : { rockY: source.rockY }) };
    for (let y = 0; y < source.height; y++) texels.set(backgroundColor(y, depth, mapPalette), y * 4);
    for (let paint = 0; paint < paintCount; paint++) {
      const color = mapPalette?.paints[paint] ?? 0;
      texels.set([(color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff, 255], (paintRow * PALETTE_ROW + paint) * 4);
    }
    gl.activeTexture(gl.TEXTURE0 + UNIT_BACKGROUND);
    const texture = integerTexture(gl, gl.RGBA8UI, PALETTE_ROW, paintRow + 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PALETTE_ROW, paintRow + 1, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, texels);
    textureUploads++;
    background = { texture, world: source, paintRow };
  };

  /** The overview of `source`, created (empty) on first use; null when even the largest factor cannot fit it. */
  const overviewOf = (source: RenderableWorld): Overview | null => {
    if (overview?.world === source) return overview;
    releaseOverview();
    let factor = MIN_OVERVIEW_FACTOR;
    while (factor < CHUNK_SIZE && Math.ceil(Math.max(source.width, source.height) / factor) > maxTextureSize) factor *= 2;
    const width = Math.ceil(source.width / factor);
    const height = Math.ceil(source.height / factor);
    if (width === 0 || height === 0 || Math.max(width, height) > maxTextureSize) return null;
    const texture = requireValue(gl.createTexture(), "a texture");
    gl.activeTexture(gl.TEXTURE0 + UNIT_OVERVIEW);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(width, height))) + 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    // Magnified only as the stand-in for chunks still loading: smooth rather than blocky.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const chunksX = Math.ceil(source.width / CHUNK_SIZE);
    const chunksY = Math.ceil(source.height / CHUNK_SIZE);
    overview = { world: source, texture, factor, width, height, built: new Uint8Array(chunksX * chunksY), builtCount: 0, filled: false };
    // Storage starts zeroed but its mip chain is incomplete until generated.
    gl.generateMipmap(gl.TEXTURE_2D);
    return overview;
  };

  /** Uniforms of the tile colour function shared by both chunk passes. */
  const setTileUniforms = (
    uniforms: Readonly<Record<(typeof TILE_UNIFORMS)[number], WebGLUniformLocation>>, sprites = false, cells = false,
  ): void => {
    gl.uniform1i(uniforms.uPlanes16, UNIT_PLANES_16);
    gl.uniform1i(uniforms.uPlanes8, UNIT_PLANES_8);
    gl.uniform1i(uniforms.uPresent, (planeSources?.present ?? 0) | (cells ? PRESENT.cells : 0));
    gl.uniform1i(uniforms.uPalette, UNIT_PALETTE);
    gl.uniform1i(uniforms.uBackground, UNIT_BACKGROUND);
    gl.uniform1i(uniforms.uRules, UNIT_RULES);
    gl.uniform1i(uniforms.uPaletteLength, paletteUploaded);
    gl.uniform1i(uniforms.uLayers, layers);
    gl.uniform3iv(uniforms.uWireColors, wireColorUniform);
    gl.uniform1iv(uniforms.uWireBits, wireBitUniform);
    gl.uniform1i(uniforms.uWireAlpha, WIRE_ALPHA);
    gl.uniform3iv(uniforms.uLiquids, liquidUniform);
    gl.uniform1i(uniforms.uPaintRow, background?.paintRow ?? 0);
    gl.uniform1i(uniforms.uPaintCount, paintCount);
    gl.uniform1i(uniforms.uAtlas, UNIT_ATLAS);
    gl.uniform1i(uniforms.uSpriteSheets, UNIT_SPRITE_SHEETS);
    gl.uniform1i(uniforms.uSprites, sprites ? 1 : 0);
  };

  /**
   * Draws `items` (chunk and slot) with the current program: one instanced draw call per page. Returns the number
   * of draw calls.
   */
  const drawInstances = (source: RenderableWorld, items: readonly (readonly [ChunkCoord, number])[]): number => {
    if (items.length === 0) return 0;
    const sorted = [...items].sort((first, second) => first[1] - second[1]);
    if (instanceData.length < sorted.length * INSTANCE_INTS) instanceData = new Int32Array(sorted.length * INSTANCE_INTS * 2);
    sorted.forEach(([chunk, slot], index) => {
      const originX = chunk.x * CHUNK_SIZE;
      const originY = chunk.y * CHUNK_SIZE;
      instanceData.set([
        originX, originY, Math.min(CHUNK_SIZE, source.width - originX), Math.min(CHUNK_SIZE, source.height - originY),
        (slot % CHUNKS_PER_PAGE) | (framedSlots.has(slot) ? CELLS_INSTANCE_BIT : 0),
      ], index * INSTANCE_INTS);
    });
    gl.bindVertexArray(resources.instanceArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.instances);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData.subarray(0, sorted.length * INSTANCE_INTS), gl.STREAM_DRAW);
    const stride = INSTANCE_INTS * 4;
    let calls = 0;
    let start = 0;
    while (start < sorted.length) {
      const pageIndex = Math.floor((sorted[start]?.[1] ?? 0) / CHUNKS_PER_PAGE);
      let end = start + 1;
      while (end < sorted.length && Math.floor((sorted[end]?.[1] ?? 0) / CHUNKS_PER_PAGE) === pageIndex) end++;
      const page = pages[pageIndex];
      if (page !== undefined) {
        gl.activeTexture(gl.TEXTURE0 + UNIT_PLANES_16);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.planes16);
        gl.activeTexture(gl.TEXTURE0 + UNIT_PLANES_8);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.planes8);
        // No base instance in WebGL2: each page's instances start at an attribute offset.
        gl.vertexAttribIPointer(RECT_ATTRIBUTE, 4, gl.INT, stride, start * stride);
        gl.vertexAttribIPointer(LAYER_ATTRIBUTE, 1, gl.INT, stride, start * stride + 16);
        gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, end - start);
        calls++;
      }
      start = end;
    }
    gl.bindVertexArray(null);
    return calls;
  };

  /** Draws the chunks' overview texels with the build pass, then regenerates the overview mipmaps. */
  const buildOverview = (source: RenderableWorld, target: Overview, items: readonly (readonly [ChunkCoord, number])[]): void => {
    if (items.length === 0) return;
    const { build } = resources;
    gl.bindFramebuffer(gl.FRAMEBUFFER, resources.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
    gl.viewport(0, 0, target.width, target.height);
    gl.useProgram(build.program);
    setTileUniforms(build.uniforms);
    gl.uniform1i(build.uniforms.uFactor, target.factor);
    gl.uniform2f(build.uniforms.uTarget, target.width, target.height);
    drawInstances(source, items);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const chunksX = Math.ceil(source.width / CHUNK_SIZE);
    for (const [chunk] of items) {
      const key = chunk.y * chunksX + chunk.x;
      if (target.built[key] === 0) target.builtCount++;
      target.built[key] = 1;
    }
    target.filled = true;
    gl.activeTexture(gl.TEXTURE0 + UNIT_OVERVIEW);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
  };

  /** Draws the overview over the whole world on the canvas; returns the number of draw calls. */
  const drawOverview = (source: RenderableWorld, target: Overview): number => {
    const { overview: program } = resources;
    gl.useProgram(program.program);
    gl.uniform2f(program.uniforms.uCamera, camera.x, camera.y);
    gl.uniform1f(program.uniforms.uZoom, camera.zoom);
    gl.uniform2f(program.uniforms.uViewport, canvas.width, canvas.height);
    gl.uniform2f(program.uniforms.uWorld, source.width, source.height);
    gl.uniform2f(program.uniforms.uExtent, target.width * target.factor, target.height * target.factor);
    gl.uniform1i(program.uniforms.uOverview, UNIT_OVERVIEW);
    gl.activeTexture(gl.TEXTURE0 + UNIT_OVERVIEW);
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.bindVertexArray(resources.emptyArray);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
    return 1;
  };

  /**
   * The order in which overview texels are built: the visible chunks, then the rest of the overview's filter footprint
   * around the viewport, each by distance from the centre of the view. Building strictly in this order makes a
   * rebuild sweep out from the centre as one front.
   */
  const overviewFootprint = (source: RenderableWorld, visible: readonly ChunkCoord[], viewport: Size): readonly ChunkCoord[] => {
    if (sweep !== null && sweep.world === source && sweep.camera === camera
      && sweep.width === viewport.width && sweep.height === viewport.height) return sweep.order;
    const margin = Math.ceil(4 / camera.zoom);
    const around = visibleChunks(
      { x: camera.x - margin, y: camera.y - margin, zoom: camera.zoom },
      { width: viewport.width + 2 * margin * camera.zoom, height: viewport.height + 2 * margin * camera.zoom },
      source,
    );
    const chunksX = Math.ceil(source.width / CHUNK_SIZE);
    const inView = new Set(visible.map((chunk) => chunk.y * chunksX + chunk.x));
    const centreX = camera.x + viewport.width / (2 * camera.zoom);
    const centreY = camera.y + viewport.height / (2 * camera.zoom);
    const distance = (chunk: ChunkCoord): number =>
      Math.hypot((chunk.x + 0.5) * CHUNK_SIZE - centreX, (chunk.y + 0.5) * CHUNK_SIZE - centreY);
    // Array.prototype.sort is stable: equal distances keep visibleChunks' row-major order.
    const byDistance = (chunks: ChunkCoord[]): ChunkCoord[] => chunks.sort((first, second) => distance(first) - distance(second));
    const order = [...byDistance([...visible]), ...byDistance(around.filter((chunk) => !inView.has(chunk.y * chunksX + chunk.x)))];
    sweep = { world: source, camera, width: viewport.width, height: viewport.height, order };
    return order;
  };

  /** `uploadBudget` chunks at most, and none after `uploadMilliseconds` once one was uploaded. */
  const drawFrame = (uploadBudget: number, uploadMilliseconds: number): void => {
    if (disposed || gl.isContextLost()) return;
    const viewport = { width: canvas.width, height: canvas.height };
    drawCalls = 0;
    drawn = [];
    if (world === null) {
      gl.viewport(0, 0, viewport.width, viewport.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      return;
    }
    const source = world;

    uploadPalette(source.palette);
    uploadBackground(source);
    // Below one pixel per overview texel, the overview stands in for the chunks.
    const candidate = overviewOf(source);
    const target = candidate !== null && camera.zoom < 1 / candidate.factor ? candidate : null;

    const chunksX = Math.ceil(source.width / CHUNK_SIZE);
    const keyOf = (chunk: ChunkCoord): number => chunk.y * chunksX + chunk.x;
    const visible = visibleChunks(camera, viewport, source);
    const sprites = spriteMode && atlasTexture !== null && camera.zoom >= SPRITE_MIN_ZOOM;
    // Self-framed blocks draw their cells: a chunk is framed on its first upload at a sprite zoom, never below one.
    const framed = sprites && target === null && framing !== null;
    // Set when a wanted chunk did not fit the upload budget.
    const loading = { pending: false };
    const deadline = Number.isFinite(uploadMilliseconds) ? performance.now() + uploadMilliseconds : Infinity;
    let uploads = 0;
    /** Whether this frame may upload one more chunk: within the count, and within the time once one was uploaded. */
    const mayUpload = (): boolean =>
      uploads < uploadBudget && (uploads === 0 || deadline === Infinity || performance.now() < deadline);
    /** Evicts least recently used chunks outside `keep` until `count` uploads fit the cache. */
    const makeRoom = (count: number, keep: ReadonlySet<number>): void => {
      for (const [key, slot] of chunks) {
        if (chunks.size + count <= cacheCapacity) break;
        if (keep.has(key)) continue;
        chunks.delete(key);
        freeSlots.push(slot);
        evictedChunks++;
        dirtyChunks.delete(key);
        cellCache?.drop({ x: key % chunksX, y: Math.floor(key / chunksX) });
      }
    };
    /**
     * Uploads `chunk` into a free slot. When the cache is full it evicts the least recently used chunk outside
     * `spare` if there is one, else outside `keep`.
     */
    const upload = (chunk: ChunkCoord, keep: ReadonlySet<number>, spare: ReadonlySet<number> = keep): number => {
      makeRoom(1, spare);
      makeRoom(1, keep);
      uploads++;
      const slot = allocateSlot();
      uploadChunk(source, chunk, slot);
      dirtyChunks.delete(keyOf(chunk));
      return slot;
    };
    /**
     * Uploads the planes of a resident chunk whose planes changed (invalidateTiles) again, into its own slot. False
     * when the frame's budget is spent: the chunk keeps drawing what it held.
     */
    const refresh = (chunk: ChunkCoord, slot: number): boolean => {
      const key = keyOf(chunk);
      if (!dirtyChunks.has(key)) return true;
      if (!mayUpload()) {
        loading.pending = true;
        return false;
      }
      uploads++;
      uploadChunk(source, chunk, slot);
      dirtyChunks.delete(key);
      return true;
    };
    /** Makes `wanted` resident (uploads within the frame budget), appending the resident ones to `out`. */
    const acquire = (wanted: readonly ChunkCoord[], out: (readonly [ChunkCoord, number])[]): void => {
      const keep = new Set(wanted.map(keyOf));
      for (const chunk of wanted) {
        const key = keyOf(chunk);
        let slot = chunks.get(key);
        let uploaded: boolean;
        if (slot === undefined) {
          if (!mayUpload()) {
            loading.pending = true;
            continue;
          }
          // Evict only for actual uploads, so reversing a pending pan keeps terrain not yet replaced.
          slot = upload(chunk, keep);
          uploaded = true;
        } else {
          chunks.delete(key);
          uploaded = dirtyChunks.has(key) && refresh(chunk, slot);
        }
        chunks.set(key, slot);
        if (framed && !framedSlots.has(slot)) {
          // Framed with its upload; a resident chunk's cells are one more upload. Without its cells (the budget is
          // spent) the chunk still draws, its self-framed blocks in map colours (its instance lacks CELLS_INSTANCE_BIT).
          if (uploaded || mayUpload()) {
            if (!uploaded) uploads++;
            uploadCells(source, chunk, slot);
          } else {
            loading.pending = true;
          }
        }
        out.push([chunk, slot]);
      }
    };

    const ready: (readonly [ChunkCoord, number])[] = [];
    if (target === null) {
      // At 1 / factor pixels per tile and above the visible set is bounded by the viewport, so the cache grows to
      // hold it; visible residents survive while the remaining chunks load.
      cacheCapacity = Math.max(cacheCapacity, visible.length);
      acquire(visible, ready);
    } else {
      // A chunk is needed only until its overview texels are built, so the cache does not grow: unbuilt chunks of
      // the filter footprint are built strictly in sweep order, in batches that fit it. The sweep stops at the first
      // chunk that does not fit the frame's budget, so no chunk (resident or not) is built ahead of the front.
      const needed = overviewFootprint(source, visible, viewport).filter((chunk) => target.built[keyOf(chunk)] === 0);
      const neededKeys = new Set(needed.map(keyOf));
      let batch: (readonly [ChunkCoord, number])[] = [];
      const batchKeys = new Set<number>();
      for (const chunk of needed) {
        const key = keyOf(chunk);
        let slot = chunks.get(key);
        if (slot === undefined) {
          if (!mayUpload()) {
            loading.pending = true;
            break;
          }
          // Evict chunks the sweep no longer needs first, then any but this batch's.
          slot = upload(chunk, batchKeys, neededKeys);
        } else {
          chunks.delete(key);
          if (!refresh(chunk, slot)) {
            chunks.set(key, slot);
            break;
          }
        }
        chunks.set(key, slot);
        batch.push([chunk, slot]);
        batchKeys.add(key);
        if (batch.length >= cacheCapacity) {
          buildOverview(source, target, batch);
          batch = [];
          batchKeys.clear();
        }
      }
      buildOverview(source, target, batch);
    }

    gl.viewport(0, 0, viewport.width, viewport.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (target === null) {
      // Chunks still loading show the overview (built when the area was seen zoomed out, possibly with other layers)
      // instead of a hole; drawn chunks overwrite it completely, so a complete frame stays exact.
      if (loading.pending && candidate?.filled === true) drawCalls += drawOverview(source, candidate);
      const { chunk: program } = resources;
      gl.useProgram(program.program);
      // Sprites are a uniform switch: crossing the threshold or toggling the mode uploads no planes and no atlas (only a
      // resident chunk's cells, once, on its first draw at a sprite zoom with a framing).
      setTileUniforms(program.uniforms, sprites, framed);
      gl.uniform2f(program.uniforms.uCamera, camera.x, camera.y);
      gl.uniform1f(program.uniforms.uZoom, camera.zoom);
      gl.uniform2f(program.uniforms.uViewport, viewport.width, viewport.height);
      // Below one pixel per tile a pixel averages the tiles under it (filterTiles) instead of point-sampling one.
      gl.uniform1i(program.uniforms.uFilter, camera.zoom < 1 ? 1 : 0);
      gl.uniform1f(program.uniforms.uStep, filterTilesPerPixel(camera.zoom));
      gl.uniform2i(program.uniforms.uWorldSize, source.width, source.height);
      gl.activeTexture(gl.TEXTURE0 + UNIT_PALETTE);
      gl.bindTexture(gl.TEXTURE_2D, resources.palette);
      gl.activeTexture(gl.TEXTURE0 + UNIT_BACKGROUND);
      gl.bindTexture(gl.TEXTURE_2D, background?.texture ?? null);
      gl.activeTexture(gl.TEXTURE0 + UNIT_RULES);
      gl.bindTexture(gl.TEXTURE_2D, resources.rules);
      gl.activeTexture(gl.TEXTURE0 + UNIT_ATLAS);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlasTexture);
      gl.activeTexture(gl.TEXTURE0 + UNIT_SPRITE_SHEETS);
      gl.bindTexture(gl.TEXTURE_2D, resources.spriteSheets);
      drawCalls += drawInstances(source, ready);
      const drawnKeys = new Set(ready.map(([chunk]) => keyOf(chunk)));
      drawn = visible.filter((chunk) => drawnKeys.has(keyOf(chunk)));
    } else {
      drawCalls = drawOverview(source, target);
      drawn = visible.filter((chunk) => target.built[keyOf(chunk)] === 1);
    }
    if (loading.pending) schedule();
  };

  const schedule = (): void => {
    if (frame !== 0 || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      drawFrame(maxChunkUploadsPerFrame, maxUploadMillisecondsPerFrame);
    });
  };

  const onContextLost = (event: Event): void => {
    // Without this the browser never restores the context.
    event.preventDefault();
    // A loss forced through WEBGL_lose_context is only restored by an explicit call made after this event: Chromium
    // ignores one made earlier. For a real GPU loss the call is a harmless INVALID_OPERATION, the browser restores it.
    setTimeout(() => {
      if (!disposed) loseContext?.restoreContext();
    }, 0);
  };
  const onContextRestored = (): void => {
    // Every GL object died with the context: rebuild them and let chunks upload again on demand.
    pages.length = 0;
    chunks.clear();
    freeSlots.length = 0;
    nextSlot = 0;
    paletteUploaded = 0;
    // A new context starts with the default unpack state.
    unpackWorld = null;
    background = null;
    overview = null;
    resources = createResources(gl, rules);
    // The atlas died with the context too: upload it again (its sheets follow the palette's next upload).
    atlasTexture = null;
    if (atlas !== null) applyAtlas(atlas);
    // So did the cell layers: chunks are framed again as they are uploaded.
    dirtyChunks.clear();
    releaseCells();
    schedule();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  return {
    setWorld: (next) => {
      if (next !== world) {
        clearChunks();
        cacheCapacity = maxCachedChunks;
        releaseBackground();
        releaseOverview();
        paletteUploaded = 0;
        planeSources = null;
        // Also drops the reference that would keep the previous world's planes alive.
        if (gl.isContextLost()) unpackWorld = null;
        else resetUnpack();
        world = next;
      }
      schedule();
    },
    setCamera: (next) => {
      camera = next;
      schedule();
    },
    setAtlas: (next) => {
      if (next === atlas) return;
      atlas = next;
      if (!gl.isContextLost()) applyAtlas(next);
      schedule();
    },
    setSpriteMode: (enabled) => {
      spriteMode = enabled;
      schedule();
    },
    setFraming: (next) => {
      if (next === framing) return;
      releaseCells();
      framing = next;
      schedule();
    },
    invalidateTiles: (tiles) => {
      if (world === null || tiles.length === 0) return;
      const source = world;
      const regions = cellCache?.world === source ? cellCache.invalidate(tiles) : [];
      const chunksX = Math.ceil(source.width / CHUNK_SIZE);
      const touched = new Set<number>();
      const touch = (left: number, top: number, right: number, bottom: number): void => {
        const lastX = Math.floor(Math.min(source.width - 1, right) / CHUNK_SIZE);
        const lastY = Math.floor(Math.min(source.height - 1, bottom) / CHUNK_SIZE);
        for (let x = Math.floor(Math.max(0, left) / CHUNK_SIZE); x <= lastX; x++) {
          for (let y = Math.floor(Math.max(0, top) / CHUNK_SIZE); y <= lastY; y++) touched.add(y * chunksX + x);
        }
      };
      // A changed tile's planes lie in its chunk and, through the page apron, in its neighbours'; the cells of its
      // recomputed area in the chunks the area covers.
      for (const { x, y } of tiles) touch(x - PAGE_APRON, y - PAGE_APRON, x + PAGE_APRON, y + PAGE_APRON);
      for (const area of regions) touch(area.left, area.top, area.left + area.width - 1, area.top + area.height - 1);
      for (const key of touched) {
        if (chunks.has(key)) dirtyChunks.add(key);
        if (overview?.world === source && overview.built[key] === 1) {
          overview.built[key] = 0;
          overview.builtCount--;
        }
      }
      schedule();
    },
    setLayers: (next) => {
      const bits = layerBits(next);
      if (bits !== layers && !gl.isContextLost()) invalidateOverview();
      layers = bits;
      schedule();
    },
    tileAt: (screenX, screenY) => {
      if (world === null || screenX < 0 || screenY < 0 || screenX >= canvas.width || screenY >= canvas.height) return null;
      const x = Math.floor(camera.x + screenX / camera.zoom);
      const y = Math.floor(camera.y + screenY / camera.zoom);
      return x < 0 || y < 0 || x >= world.width || y >= world.height ? null : { x, y };
    },
    render: () => { drawFrame(Infinity, Infinity); },
    stats: () => ({
      textureUploads, drawCalls, visibleChunks: drawn, residentChunks: chunks.size, evictedChunks, atlasUploads,
      framedTiles: framedBefore + (cellCache?.framedTiles ?? 0),
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (!gl.isContextLost()) {
        // The context outlives this renderer: leave it with the default unpack state.
        resetUnpack();
        clearChunks();
        releaseOverview();
        for (const program of [resources.chunk, resources.build, resources.overview]) gl.deleteProgram(program.program);
        gl.deleteTexture(resources.palette);
        gl.deleteTexture(resources.rules);
        gl.deleteTexture(resources.spriteSheets);
        releaseAtlas();
        gl.deleteBuffer(resources.instances);
        gl.deleteVertexArray(resources.instanceArray);
        gl.deleteVertexArray(resources.emptyArray);
        gl.deleteFramebuffer(resources.framebuffer);
      }
      releaseBackground();
      unpackWorld = null;
    },
  };
}
