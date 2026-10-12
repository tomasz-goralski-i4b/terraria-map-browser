// The WebGL2 backend draws into a DOM canvas; the DOM types are declared here, where they are used, so the rest of
// the package keeps the DOM-free lib of the base config.
/// <reference lib="dom" />

import type { ContentRef } from "@studio/world-model";
import { CHUNK_SIZE, visibleChunks } from "../camera/camera.js";
import type { Camera, ChunkCoord, Size } from "../camera/camera.js";
import { filterTilesPerPixel } from "../chunk/box-filter.js";
import { WIRE_ALPHA, WIRE_COLORS, WIRE_LAYER, type ChunkLayers } from "../chunk/render.js";
import { NO_CELL } from "../framing/cells.js";
import { createChunkCellCache } from "../framing/chunk-cells.js";
import { SPRITE_FRAME_WRAPS } from "./frame-wrap.js";
import { TRACK_TILE } from "../objects/tracks.js";
import { collectWireRuns, type WireRuns } from "../objects/wires.js";
import type { ChunkCellCache } from "../framing/chunk-cells.js";
import { createChunkWallCellCache } from "../framing/chunk-wall-cells.js";
import type { ChunkWallCellCache } from "../framing/chunk-wall-cells.js";
import type { BlockFraming } from "../framing/frame-block.js";
import { backgroundColor, contentColor, liquidColors } from "../palette/map-palette.js";
import type { MapPalette } from "../palette/map-palette.js";
import {
  CELLS_INSTANCE_BIT, WALLS_INSTANCE_BIT, LAYER_ATTRIBUTE, PAGE_APRON, PLANES_16, PLANES_8, PLANE_COUNT_16, PLANE_COUNT_8, PRESENT, RECT_ATTRIBUTE,
  RULE_HEADER_ROWS, RULE_ROW, SPRITE_MIN_ZOOM, SPRITE_SHEET_ROW, SPRITE_SHEET_TEXELS, spriteSampling, SPRITE_STATE, chunkFragmentSource, chunkSpriteFragmentSource, chunkVertexSource, overviewBuildFragmentSource,
  halfAtlasFragmentSource, halfAtlasVertexSource, overviewBuildVertexSource, overviewFragmentSource, overviewVertexSource,
  OBJECT_DEST_ATTRIBUTE, OBJECT_SOURCE_ATTRIBUTE, objectFragmentSource, objectVertexSource, wireFragmentSource,
  WIRE_RUN_ATTRIBUTE, wireVertexSource,
} from "./shaders.js";
import { OBJECT_TILES, objectSprites, type ObjectSprite, type TreeSettings } from "../objects/object-sprites.js";

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
  /** The world header's tree-style zones and tree top variations (docs/assets.md, "Trees"); without them all are 0. */
  readonly trees?: TreeSettings;
}

/** One sheet of a sprite atlas: where it lies on its page and the size of its frame cells (docs/assets.md, "Atlas"). */
export interface SpriteSheetEntry {
  readonly kind: "tile" | "wall" | "treeTop" | "treeBranch" | "shroomTop" | "wire" | "actuator" | "item" | "liquid" | "liquidSlope";
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
   * Baseline chunk texture cache capacity (LRU). Default 512 (about 160 MiB of chunk pages).
   * Grows to fit the largest set drawn chunk by chunk (at half a pixel per tile and above, so bounded by the
   * viewport) for the current world; resets when the world changes. Zoomed-out views come from the overview and do
   * not grow it.
   */
  readonly maxCachedChunks?: number;
  /**
   * Chunks around the viewport, per side, uploaded ahead while the browser is idle (and framed at a sprite zoom), so a
   * pan finds them resident. Default 1; 0 turns it off. They never evict a chunk the last frame drew.
   */
  readonly prefetchChunks?: number;
  /** Map colours (content, paint, background by depth), as in `renderChunk`; without one, placeholders are drawn. */
  readonly mapPalette?: MapPalette;
  /**
   * Called with true when the renderer starts preparing its sprite program in the background (KHR_parallel_shader_compile:
   * seconds on some drivers with a cold shader cache; sprites show map colours meanwhile) and with false when it is
   * ready, or the preparation ends otherwise: the link failed (sprites keep map colours and `render` throws the
   * driver's log), the context was lost, or the renderer was disposed. Without the extension the program is linked at
   * once and this is never called.
   */
  readonly onSpritesPreparing?: (preparing: boolean) => void;
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
  /**
   * Wall cells framed since creation: every tile of a chunk and its apron inside the world once on its first upload at
   * a sprite zoom, and the cached cells of the 3 × 3 areas `invalidateTiles` recomputes.
   */
  readonly framedWalls: number;
  /** Whether the sprite program is being prepared in the background (MapRendererOptions.onSpritesPreparing). */
  readonly spritesPreparing: boolean;
  /**
   * Scheduled frames since creation that reused the previous frame shifted by whole pixels, drawing only the strips
   * a pan revealed (only the camera changed since, by whole screen pixels at the same zoom).
   */
  readonly reusedFrames: number;
}

/** An offscreen colour target the size of the canvas: scheduled frames are drawn into one and copied to the canvas. */
interface FrameTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
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
   * self-framed blocks and walls their framed cells). A uniform switch: turning it on or off, or crossing the zoom threshold,
   * uploads no chunk planes and no atlas. The one exception is a resident chunk's first draw at a sprite zoom with a
   * framing, which frames it and uploads its cells once (`setFraming`).
   */
  readonly setSpriteMode: (enabled: boolean) => void;
  /**
   * The block framing (`createBlockFraming`): with it, sprite mode also draws self-framed blocks (dirt, stone, ores,
   * grass, …) with the cell their neighbours give them, half blocks and slopes cut by their shape, and (through its
   * `walls`) walls with theirs: a 32 × 32 cell centred on the tile, overhanging 8 pixels, below the blocks. A chunk is
   * framed on its first upload at a sprite zoom and keeps its cells while it stays resident; null draws them in map
   * colours.
   */
  readonly setFraming: (framing: BlockFraming | null) => void;
  /**
   * After the world's planes changed at `tiles`: recomputes the framed cells around them (docs/assets.md, "Inputs
   * beyond 3 × 3": up to d + 1 tiles away, d the deepest framing depth there; walls within 3 × 3) and uploads the
   * touched chunks again.
   */
  readonly invalidateTiles: (tiles: readonly { readonly x: number; readonly y: number }[]) => void;
  /** Integer tile under a canvas pixel, or null outside the world. */
  readonly tileAt: (screenX: number, screenY: number) => { readonly x: number; readonly y: number } | null;
  /** Uploads and draws all visible chunks synchronously. Setters schedule frames with bounded chunk uploads. */
  readonly render: () => void;
  /**
   * Draws the frame the setters scheduled now, with the same bounded uploads, instead of in the next animation frame.
   * Called from the caller's own animation frame callback after it moved the camera, the map shows the move in that
   * frame rather than one frame later. Does nothing when no frame is scheduled.
   */
  readonly flushFrame: () => void;
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
const DEFAULT_PREFETCH_CHUNKS = 1;
/** An idle prefetch step stops uploading once less than this much of its idle period is left (milliseconds). */
const PREFETCH_IDLE_RESERVE = 3;
const DEFAULT_MAX_CHUNK_UPLOADS_PER_FRAME = 256;
const DEFAULT_MAX_UPLOAD_MILLISECONDS_PER_FRAME = 8;
/**
 * Chunks per page. A page holds one layer per plane and chunk: 32 × 7 = 224 layers of the 16-bit texture and
 * 32 × 5 = 160 of the 8-bit one, within the 256 array layers WebGL2 guarantees, with room for one more 16-bit
 * plane (32 × 8 = 256). A page of both textures is about 9.8 MiB.
 */
const CHUNKS_PER_PAGE = 32;
/** Texels per side of a page layer: the chunk and its apron of neighbouring tiles on every side. */
const PAGE_SIZE = CHUNK_SIZE + 2 * PAGE_APRON;
/** Ints per instance: the chunk rectangle (origin x, origin y, columns, rows) and its page layer. */
const INSTANCE_INTS = 5;
/** How often a sprite program linked in the background is asked whether it is done. */
const LINK_POLL_MILLISECONDS = 50;
/** The smallest overview factor: one overview texel per 2 × 2 tiles, used below half a pixel per tile. */
const MIN_OVERVIEW_FACTOR = 2;

// Texture units: 0–1 the chunk page; 2 palette; 3 background and paint colours; 4 map option rules; 5 overview;
// 6 sprite atlas pages; 7 sprite sheet lookup; 8 the atlas pages at half resolution. WebGL2 guarantees 16.
const UNIT_PLANES_16 = 0;
const UNIT_PLANES_8 = 1;
const UNIT_PALETTE = 2;
const UNIT_BACKGROUND = 3;
const UNIT_RULES = 4;
const UNIT_OVERVIEW = 5;
const UNIT_ATLAS = 6;
const UNIT_SPRITE_SHEETS = 7;
const UNIT_ATLAS_HALF = 8;
const TEXTURE_UNITS = 9;
/** Texels per row of the sprite sheet lookup: five per palette index (SPRITE_SHEET_ROW in shaders.ts). */
const SPRITE_SHEET_WIDTH = SPRITE_SHEET_ROW * SPRITE_SHEET_TEXELS;

const TILE_UNIFORMS = [
  "uPlanes16", "uPlanes8", "uPresent", "uPalette", "uBackground", "uRules", "uPaintRow", "uPaintCount", "uPaletteLength",
  "uLayers", "uLiquids",
] as const;
/** The wire overlay's uniforms: the map program and the overview build pass draw it, in sprite mode the wire pass does. */
const OVERLAY_UNIFORMS = ["uWireColors", "uWireBits", "uWireAlpha"] as const;
const CHUNK_PASS_UNIFORMS = [...TILE_UNIFORMS, "uCamera", "uZoom", "uViewport", "uFilter", "uStep", "uWorldSize"] as const;
const CHUNK_UNIFORMS = [...CHUNK_PASS_UNIFORMS, ...OVERLAY_UNIFORMS] as const;
/** The sprite program's own uniforms (chunkSpriteFragmentSource), besides CHUNK_UNIFORMS. */
const SPRITE_UNIFORMS = [
  "uAtlas", "uAtlasHalf", "uSpriteSheets", "uSpriteSamples", "uSpriteStep", "uSpriteLevel", "uSpriteWeight",
] as const;
const HALF_ATLAS_UNIFORMS = ["uAtlas", "uPage"] as const;
const SPRITE_CHUNK_UNIFORMS = [...CHUNK_PASS_UNIFORMS, ...SPRITE_UNIFORMS] as const;
/** The object pass's uniforms (objectFragmentSource): the camera and the sprite sampling. */
const OBJECT_UNIFORMS = [
  "uCamera", "uZoom", "uViewport", "uAtlas", "uAtlasHalf", "uSpriteSamples", "uSpriteStep", "uSpriteLevel", "uSpriteWeight",
] as const;
/** The wire pass's uniforms (wireFragmentSource). */
const WIRE_UNIFORMS = [
  ...OBJECT_UNIFORMS, "uPlanes16", "uPresent", "uLayers", "uWireColors", "uWireBits", "uWireAlpha", "uWorldSize", "uWireSheet",
  "uActuatorSheet",
] as const;
/** Ints per object pass instance: its rectangle in world sprite pixels, then (atlas page, x, y, 0) of its source. */
const OBJECT_INTS = 8;
/** Ints per wire pass instance: its chunk's rectangle and page layer (as the chunk pass), then its run (x, y, w, h). */
const WIRE_INTS = 9;


const BUILD_UNIFORMS = [...TILE_UNIFORMS, ...OVERLAY_UNIFORMS, "uFactor", "uTarget"] as const;
const OVERVIEW_UNIFORMS = ["uCamera", "uZoom", "uViewport", "uWorld", "uExtent", "uOverview"] as const;

interface Program<Name extends string> {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<Name, WebGLUniformLocation>>;
}

/** A rectangle of world tiles; right and bottom exclusive. */
interface Area {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** The smallest area holding `first` (if any) and `second`. */
function union(first: Area | undefined, second: Area): Area {
  if (first === undefined) return second;
  return {
    left: Math.min(first.left, second.left), top: Math.min(first.top, second.top),
    right: Math.max(first.right, second.right), bottom: Math.max(first.bottom, second.bottom),
  };
}

/** One array texture per plane format, holding up to CHUNKS_PER_PAGE chunks with their aprons, a layer per plane. */
interface Page {
  /** R16UI, PLANES_16 per chunk: block, wall, flags, frameX, frameY, framed block cell, framed wall cell. */
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
  /** The chunk pass in map colours. Sprite frames use the sprite program, linked on first use (spriteProgramOf). */
  readonly chunk: Program<(typeof CHUNK_UNIFORMS)[number]>;
  readonly build: Program<(typeof BUILD_UNIFORMS)[number]>;
  readonly overview: Program<(typeof OVERVIEW_UNIFORMS)[number]>;
  /** Instance attributes of the chunk passes. */
  readonly instances: WebGLBuffer;
  readonly instanceArray: WebGLVertexArrayObject;
  /** Instance attributes of the wire pass (WIRE_INTS per run of wire tiles). */
  readonly wireInstances: WebGLBuffer;
  readonly wireArray: WebGLVertexArrayObject;
  /** Instance attributes of the object pass (OBJECT_INTS per object sprite). */
  readonly objectInstances: WebGLBuffer;
  readonly objectArray: WebGLVertexArrayObject;
  /** No attributes: the overview quad comes from gl_VertexID. */
  readonly emptyArray: WebGLVertexArrayObject;
  readonly framebuffer: WebGLFramebuffer;
  readonly palette: WebGLTexture;
  /** Map option rules: headers by palette index, then the ranges (see RULE_ROW in shaders.ts). */
  readonly rules: WebGLTexture;
  /** The tile and wall sheets of each palette index (SPRITE_SHEET_ROW in shaders.ts); all zero without an atlas. */
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

/** A program whose compiling and linking was started (startLink) and is checked by finishLink. */
interface Linking {
  readonly program: WebGLProgram;
  readonly shaders: readonly WebGLShader[];
}

/**
 * Starts compiling and linking a program without asking for the result: with KHR_parallel_shader_compile the driver
 * works on it in the background until finishLink (or a COMPLETION_STATUS_KHR query says it is done).
 */
function startLink(gl: WebGL2RenderingContext, vertex: string, fragment: string): Linking {
  const program = requireValue(gl.createProgram(), "a program");
  const shaders = [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const;
  const compiled = shaders.map(([type, source]) => {
    const shader = requireValue(gl.createShader(type), "a shader");
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    return shader;
  });
  gl.linkProgram(program);
  return { program, shaders: compiled };
}

/**
 * Waits for a started link and looks up the program's uniforms; throws with the driver's log if it failed (the program
 * is deleted then). The shaders are deleted either way: a linked program keeps what it needs.
 */
function finishLink<Name extends string>(gl: WebGL2RenderingContext, linking: Linking, names: readonly Name[]): Program<Name> {
  const { program } = linking;
  const linked = gl.getProgramParameter(program, gl.LINK_STATUS) as boolean;
  let failure: string | null = null;
  if (!linked) {
    const broken = linking.shaders.find((shader) => !(gl.getShaderParameter(shader, gl.COMPILE_STATUS) as boolean));
    failure = broken === undefined
      ? `Shader link failed: ${gl.getProgramInfoLog(program) ?? "unknown error"}`
      : `Shader compilation failed: ${gl.getShaderInfoLog(broken) ?? "unknown error"}`;
  }
  for (const shader of linking.shaders) {
    gl.detachShader(program, shader);
    gl.deleteShader(shader);
  }
  if (failure !== null) {
    gl.deleteProgram(program);
    throw new Error(failure);
  }
  const uniforms = Object.fromEntries(
    names.map((name) => [name, requireValue(gl.getUniformLocation(program, name), `uniform ${name}`)]),
  ) as Record<Name, WebGLUniformLocation>;
  return { program, uniforms };
}

function link<Name extends string>(
  gl: WebGL2RenderingContext, vertex: string, fragment: string, names: readonly Name[],
): Program<Name> {
  return finishLink(gl, startLink(gl, vertex, fragment), names);
}

/** KHR_parallel_shader_compile, when the browser offers it. */
interface ParallelShaderCompile {
  readonly COMPLETION_STATUS_KHR: number;
}

function parallelShaderCompile(gl: WebGL2RenderingContext): ParallelShaderCompile | null {
  const extension: ParallelShaderCompile | null = gl.getExtension("KHR_parallel_shader_compile");
  return extension;
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

/** The wire pass's vertex array: the chunk pass's attributes and the run (WIRE_INTS per instance); pointers set per draw. */
function wireArray(gl: WebGL2RenderingContext, buffer: WebGLBuffer): WebGLVertexArrayObject {
  const array = requireValue(gl.createVertexArray(), "a vertex array");
  gl.bindVertexArray(array);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const location of [RECT_ATTRIBUTE, LAYER_ATTRIBUTE, WIRE_RUN_ATTRIBUTE]) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.bindVertexArray(null);
  return array;
}

/** The object pass's vertex array: two ivec4 per instance (OBJECT_INTS), read from `buffer`. */
function objectArray(gl: WebGL2RenderingContext, buffer: WebGLBuffer): WebGLVertexArrayObject {
  const array = requireValue(gl.createVertexArray(), "a vertex array");
  gl.bindVertexArray(array);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  for (const [location, offset] of [[OBJECT_DEST_ATTRIBUTE, 0], [OBJECT_SOURCE_ATTRIBUTE, 16]] as const) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribIPointer(location, 4, gl.INT, OBJECT_INTS * 4, offset);
    gl.vertexAttribDivisor(location, 1);
  }
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
  const objectInstances = requireValue(gl.createBuffer(), "a buffer");
  const wireInstances = requireValue(gl.createBuffer(), "a buffer");
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
    objectInstances,
    objectArray: objectArray(gl, objectInstances),
    wireInstances,
    wireArray: wireArray(gl, wireInstances),
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
  const prefetchChunks = Math.max(0, Math.floor(options?.prefetchChunks ?? DEFAULT_PREFETCH_CHUNKS));
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
  let spriteProgram: Program<(typeof SPRITE_CHUNK_UNIFORMS)[number]> | null = null;
  // The sprite program while the driver links it in the background (KHR_parallel_shader_compile, where offered).
  let spriteLinking: Linking | null = null;
  // The object and wire passes of sprite mode: small programs, linked at once on their first use (a frame with an
  // object sprite, or with wires shown), so a renderer that never draws one never compiles it.
  let objectProgram: Program<(typeof OBJECT_UNIFORMS)[number]> | null = null;
  let wireProgram: Program<(typeof WIRE_UNIFORMS)[number]> | null = null;
  let parallelCompile = parallelShaderCompile(gl);
  // The timer that asks whether the background link is done; 0 when none is pending.
  let linkPoll = 0;
  // Why the sprite program failed to link, for this context.
  let spriteLinkError: Error | null = null;
  let world: RenderableWorld | null = null;
  let cacheCapacity = maxCachedChunks;
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  // The camera the current frame draws with. Scheduled frames from one pixel per tile up snap it to whole screen
  // pixels, so the frames of a pan differ by whole pixels and the previous frame can be reused shifted.
  let view: Camera = camera;
  // The two offscreen targets scheduled frames alternate between; frameTargets[frameCurrent] holds the last one.
  let frameTargets: (FrameTarget | undefined)[] = [];
  let frameCurrent = 0;
  // The last scheduled frame, if it is complete and can be reused: its snapped camera in screen pixels and what else
  // it depends on. Any other change (frameVersion), an upload in the frame, or another zoom or size draws it in full.
  let lastFrame: {
    readonly pixelX: number; readonly pixelY: number; readonly zoom: number; readonly sprites: boolean;
    readonly version: number; readonly width: number; readonly height: number;
  } | null = null;
  // Bumped by every change but the camera's.
  let frameVersion = 0;
  let reusedFrames = 0;
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
  // The atlas pages at half resolution (halfAtlasFragmentSource), read by sprite samples from 8 pixels per tile down.
  let atlasHalfTexture: WebGLTexture | null = null;
  let halfAtlasProgram: Program<(typeof HALF_ATLAS_UNIFORMS)[number]> | null = null;
  let tileSheets = new Map<number, SpriteSheetEntry>();
  let wallSheets = new Map<number, SpriteSheetEntry>();
  // Every sheet of the atlas by kind and id (`${kind}:${id}`), for the object pass and the wire pass.
  let sheetsByKey = new Map<string, SpriteSheetEntry>();
  // The wire pieces and the actuator (docs/assets.md, "Wires"): (page, x, y, 1), or zeros without the sheet.
  let wireSheet: Int32Array = new Int32Array(4);
  let actuatorSheet: Int32Array = new Int32Array(4);
  // The object pass's instances by chunk key, for the current world and atlas: computed on the CPU from the world's
  // planes on first draw, dropped by invalidateTiles around changed tiles.
  const objectCache = new Map<number, Int32Array>();
  let objectData = new Int32Array(OBJECT_INTS * 256);
  // The chunk keys whose instances the object buffer holds, in order, and their instance count: a frame showing the
  // same chunks with none of their lists collected again draws the buffer as it is, without uploading it again.
  let objectUploaded: { readonly keys: readonly number[]; readonly instances: number } | null = null;
  // Per chunk key, the wire and actuator bits (0–4) set anywhere in the chunk and its runs of tiles with any (WireRuns):
  // the wire pass draws only those runs, so a view without wires costs no pass at all. Dropped around changed tiles.
  const wireChunks = new Map<number, WireRuns>();
  let wireData = new Int32Array(WIRE_INTS * 256);
  const sheetMirror = new Int32Array(SPRITE_SHEET_WIDTH * PALETTE_HEIGHT * 4);
  let spriteMode = false;
  let atlasUploads = 0;
  // Self-framed blocks and walls: the framing, the framed cells of the current world's resident chunks, and the slots
  // whose cell layers hold their chunk's current cells. Tiles framed by caches already let go are kept in the
  // framed…Before counts.
  let framing: BlockFraming | null = null;
  let cellCache: ChunkCellCache | null = null;
  let wallCache: ChunkWallCellCache | null = null;
  let framedBefore = 0;
  let framedWallsBefore = 0;
  const framedSlots = new Set<number>();
  // The framed slots whose wall cell layer holds any wall cell (WALLS_INSTANCE_BIT).
  const wallSlots = new Set<number>();
  // Resident chunks whose planes changed (invalidateTiles), with the world tiles that changed in their layers (right and
  // bottom exclusive): uploaded again on their next draw, that rectangle only.
  const dirtyChunks = new Map<number, Area>();
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
    framedWallsBefore += wallCache?.framedTiles ?? 0;
    cellCache = null;
    wallCache = null;
    framedSlots.clear();
    wallSlots.clear();
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
   * Writes the sheets of palette indices `from` … `to` - 1 into the lookup (whole rows). With an atlas, an index whose
   * content has a tile sheet gets its place and frame size, deferred content (trees) the map colour, and any other
   * (newer than the install, mod, unknown) the missing-texture state; the shader only uses it for blocks with a
   * stored frame or a framed cell. Its wall sheet likewise, for walls with a framed cell. Without an atlas every index
   * has the map colour.
   */
  const uploadSheets = (palette: readonly ContentRef[], from: number, to: number): void => {
    if (to <= from) return;
    for (let index = from; index < to; index++) {
      const ref = palette[index];
      const vanilla = ref?.kind === "vanilla" ? ref.id : undefined;
      const sheet = vanilla === undefined ? undefined : tileSheets.get(vanilla);
      const at = (Math.floor(index / SPRITE_SHEET_ROW) * SPRITE_SHEET_WIDTH + (index % SPRITE_SHEET_ROW) * SPRITE_SHEET_TEXELS) * 4;
      if (sheet !== undefined) {
        // Tracks store piece indices, not sheet offsets (docs/assets.md, "Minecart tracks"); trees and the giant
        // mushroom are drawn by the object pass ("Trees").
        const state = vanilla === TRACK_TILE
          ? SPRITE_STATE.track
          : vanilla !== undefined && OBJECT_TILES.has(vanilla) ? SPRITE_STATE.object : SPRITE_STATE.sheet;
        sheetMirror.set([sheet.page, sheet.x, sheet.y, state, sheet.width, sheet.height, sheet.frameWidth, sheet.frameHeight], at);
      } else {
        sheetMirror.set([0, 0, 0, atlasTexture === null ? SPRITE_STATE.mapColor : SPRITE_STATE.missing, 0, 0, 0, 0], at);
      }
      const wallSheet = vanilla === undefined ? undefined : wallSheets.get(vanilla);
      if (wallSheet !== undefined) {
        sheetMirror.set([
          wallSheet.page, wallSheet.x, wallSheet.y, SPRITE_STATE.sheet, wallSheet.width, wallSheet.height,
          wallSheet.frameWidth, wallSheet.frameHeight,
        ], at + 8);
      } else {
        const state = atlasTexture === null ? SPRITE_STATE.mapColor : SPRITE_STATE.missing;
        sheetMirror.set([0, 0, 0, state, 0, 0, 0, 0], at + 8);
      }
      const wrap = vanilla === undefined ? undefined : SPRITE_FRAME_WRAPS.get(vanilla);
      sheetMirror.set(wrap === undefined ? [0, 0, 0, 0] : wrap.axis === "x"
        ? [wrap.period, wrap.shift, 0, 0]
        : [0, 0, wrap.period, wrap.shift], at + 16);
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
    atlasHalfTexture = halfAtlas(texture, pageSize, pageCount);
    atlasUploads++;
  };

  /** Draws the half-resolution copy of the atlas pages in `atlasPages` (one pass per page) into a new texture. */
  const halfAtlas = (atlasPages: WebGLTexture, pageSize: number, pageCount: number): WebGLTexture => {
    const size = Math.ceil(pageSize / 2);
    const texture = requireValue(gl.createTexture(), "a texture");
    gl.activeTexture(gl.TEXTURE0 + UNIT_ATLAS_HALF);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8UI, size, size, pageCount);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    halfAtlasProgram ??= link(gl, halfAtlasVertexSource, halfAtlasFragmentSource, HALF_ATLAS_UNIFORMS);
    gl.useProgram(halfAtlasProgram.program);
    gl.activeTexture(gl.TEXTURE0 + UNIT_ATLAS);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlasPages);
    gl.uniform1i(halfAtlasProgram.uniforms.uAtlas, UNIT_ATLAS);
    gl.bindFramebuffer(gl.FRAMEBUFFER, resources.framebuffer);
    gl.viewport(0, 0, size, size);
    gl.bindVertexArray(resources.emptyArray);
    for (let layer = 0; layer < pageCount; layer++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texture, 0, layer);
      gl.uniform1i(halfAtlasProgram.uniforms.uPage, layer);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindVertexArray(null);
    // Detached, or the shared framebuffer would keep the texture alive after the atlas is replaced.
    gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, null, 0, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return texture;
  };

  const releaseAtlas = (): void => {
    if (!gl.isContextLost()) {
      if (atlasTexture !== null) gl.deleteTexture(atlasTexture);
      if (atlasHalfTexture !== null) gl.deleteTexture(atlasHalfTexture);
    }
    atlasTexture = null;
    atlasHalfTexture = null;
  };

  /** Puts `source` on the GPU and rewrites the sheet of every palette index uploaded so far. */
  const applyAtlas = (source: SpriteAtlasSource | null): void => {
    releaseAtlas();
    tileSheets = new Map(source?.index.entries.filter((entry) => entry.kind === "tile").map((entry) => [entry.id, entry]));
    wallSheets = new Map(source?.index.entries.filter((entry) => entry.kind === "wall").map((entry) => [entry.id, entry]));
    sheetsByKey = new Map(source?.index.entries.map((entry) => [`${entry.kind}:${String(entry.id)}`, entry]));
    const placeOf = (kind: SpriteSheetEntry["kind"]): Int32Array => {
      const entry = sheetsByKey.get(`${kind}:0`);
      return new Int32Array(entry === undefined ? [0, 0, 0, 0] : [entry.page, entry.x, entry.y, 1]);
    };
    wireSheet = placeOf("wire");
    actuatorSheet = placeOf("actuator");
    objectCache.clear();
    objectUploaded = null;
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
   * (UNPACK_SKIP_PIXELS). No tile is touched in JavaScript. With `area` (world tiles, after an edit) only the part of
   * the layers inside it, and the slot's cell layers stay as they are (uploadCellArea updates them).
   */
  const uploadChunk = (source: RenderableWorld, chunk: ChunkCoord, slot: number, area?: Area): void => {
    const originX = chunk.x * CHUNK_SIZE;
    const originY = chunk.y * CHUNK_SIZE;
    // The apron, clipped to the world: texels past the world's edges keep stale values the shaders never read.
    let firstColumn = Math.max(-PAGE_APRON, -originX);
    let endColumn = Math.min(CHUNK_SIZE + PAGE_APRON, source.width - originX);
    let firstRow = Math.max(-PAGE_APRON, -originY);
    let endRow = Math.min(CHUNK_SIZE + PAGE_APRON, source.height - originY);
    if (area !== undefined) {
      firstColumn = Math.max(firstColumn, area.left - originX);
      endColumn = Math.min(endColumn, area.right - originX);
      firstRow = Math.max(firstRow, area.top - originY);
      endRow = Math.min(endRow, area.bottom - originY);
      if (endColumn <= firstColumn || endRow <= firstRow) return;
    }
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
    if (area === undefined) framedSlots.delete(slot);
  };

  /** The framed cells of `source`'s chunks, blocks and walls; null without a framing. */
  const cellsOf = (source: RenderableWorld): { blocks: ChunkCellCache; walls: ChunkWallCellCache } | null => {
    if (framing === null) return null;
    if (cellCache === null || wallCache === null || cellCache.world !== source) {
      releaseCells();
      cellCache = createChunkCellCache(source, framing);
      wallCache = createChunkWallCellCache(source, framing.walls, CHUNK_SIZE, PAGE_APRON);
    }
    return { blocks: cellCache, walls: wallCache };
  };

  /**
   * Uploads the framed cells of `chunk` (framing it on first use) into the cell layers of its slot: the chunk's block
   * cells without the apron, which the sprite pass never reads for blocks, and its wall cells with the apron, whose
   * overhang reaches into the chunk (the whole layer: NO_CELL past the world's edges). One texture upload.
   */
  const uploadCells = (source: RenderableWorld, chunk: ChunkCoord, slot: number): void => {
    const caches = cellsOf(source);
    const page = pages[Math.floor(slot / CHUNKS_PER_PAGE)];
    if (caches === null || page === undefined) return;
    const cells = caches.blocks.cells(chunk);
    const columns = Math.min(CHUNK_SIZE, source.width - chunk.x * CHUNK_SIZE);
    const rows = Math.min(CHUNK_SIZE, source.height - chunk.y * CHUNK_SIZE);
    const layer = (slot % CHUNKS_PER_PAGE) * PLANE_COUNT_16;
    resetUnpack();
    // Column-major cells are the transposed layer's rows: `rows` cells each, 2-byte aligned.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.activeTexture(gl.TEXTURE0 + UNIT_PLANES_16);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.planes16);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0, PAGE_APRON, PAGE_APRON, layer + PLANES_16.cell,
      rows, columns, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, cells,
    );
    const walls = caches.walls.cells(chunk);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer + PLANES_16.wallCell, PAGE_SIZE, PAGE_SIZE, 1, gl.RED_INTEGER,
      gl.UNSIGNED_SHORT, walls,
    );
    if (walls.some((cell) => cell !== NO_CELL)) wallSlots.add(slot);
    else wallSlots.delete(slot);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    textureUploads++;
    framedSlots.add(slot);
  };

  /**
   * Uploads the framed cells of `chunk` inside `area` (world tiles), recomputed after an edit, into its slot's cell
   * layers, which hold the rest of its current cells (framedSlots): the block cells inside the chunk and the wall
   * cells inside its layer, apron included. The unpack parameters select the rectangle of the column-major arrays.
   */
  const uploadCellArea = (source: RenderableWorld, chunk: ChunkCoord, slot: number, area: Area): void => {
    const caches = cellsOf(source);
    const page = pages[Math.floor(slot / CHUNKS_PER_PAGE)];
    if (caches === null || page === undefined) return;
    const originX = chunk.x * CHUNK_SIZE;
    const originY = chunk.y * CHUNK_SIZE;
    const layer = (slot % CHUNKS_PER_PAGE) * PLANE_COUNT_16;
    resetUnpack();
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 2);
    gl.activeTexture(gl.TEXTURE0 + UNIT_PLANES_16);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.planes16);
    /** Uploads columns [c0, c1) × rows [r0, r1) of a column-major array of `rows` rows, `offset` texels into the layer. */
    const part = (
      plane: number, cells: Uint16Array, rows: number, offset: number, c0: number, c1: number, r0: number, r1: number,
    ): boolean => {
      if (c1 <= c0 || r1 <= r0) return false;
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, rows);
      // A 3D upload must fit its skipped rows within the image height: the array's columns.
      gl.pixelStorei(gl.UNPACK_IMAGE_HEIGHT, cells.length / rows);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, r0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, c0);
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY, 0, offset + r0, offset + c0, layer + plane, r1 - r0, c1 - c0, 1, gl.RED_INTEGER,
        gl.UNSIGNED_SHORT, cells,
      );
      return true;
    };
    const columns = Math.min(CHUNK_SIZE, source.width - originX);
    const rows = Math.min(CHUNK_SIZE, source.height - originY);
    const blocks = part(
      PLANES_16.cell, caches.blocks.cells(chunk), rows, PAGE_APRON,
      Math.max(0, area.left - originX), Math.min(columns, area.right - originX),
      Math.max(0, area.top - originY), Math.min(rows, area.bottom - originY),
    );
    const walls = caches.walls.cells(chunk);
    const wallsUploaded = part(
      PLANES_16.wallCell, walls, PAGE_SIZE, 0,
      Math.max(0, area.left - originX + PAGE_APRON), Math.min(PAGE_SIZE, area.right - originX + PAGE_APRON),
      Math.max(0, area.top - originY + PAGE_APRON), Math.min(PAGE_SIZE, area.bottom - originY + PAGE_APRON),
    );
    defaultUnpack(gl);
    if (blocks || wallsUploaded) textureUploads++;
    // A wall cell may have appeared where the chunk had none.
    if (walls.some((cell) => cell !== NO_CELL)) wallSlots.add(slot);
    else wallSlots.delete(slot);
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

  /**
   * The chunk pass's sprite program, linked when an atlas is set or on the first sprite frame: map mode and the
   * overview never compile the sprite code (blocks' and walls' sprites), which would make every map-only renderer
   * compile about twice as long. Null while the driver still links it and `wait` is false: animation frames then draw
   * map colours and ask for another frame; `render` waits for it.
   */
  const spriteProgramOf = (wait: boolean): Program<(typeof SPRITE_CHUNK_UNIFORMS)[number]> | null => {
    if (spriteProgram !== null) return spriteProgram;
    // A program that failed to link: animation frames keep map colours, `render` reports why.
    if (spriteLinkError !== null) {
      if (wait) throw spriteLinkError;
      return null;
    }
    // Without KHR_parallel_shader_compile this links it at once (finishSpriteLink then returns it).
    startSpriteLink();
    return wait || spriteLinkDone() ? finishSpriteLink() : null;
  };

  /**
   * Starts linking the sprite program: with KHR_parallel_shader_compile in the background (it takes seconds on some
   * drivers, D3D11 with a cold shader cache), reported through onSpritesPreparing and polled until it is done; without
   * it at once.
   */
  const startSpriteLink = (): void => {
    if (spriteProgram !== null || spriteLinking !== null || spriteLinkError !== null) return;
    spriteLinking = startLink(gl, chunkVertexSource, chunkSpriteFragmentSource);
    if (parallelCompile === null) {
      finishSpriteLink();
      return;
    }
    options?.onSpritesPreparing?.(true);
    const poll = (): void => {
      linkPoll = 0;
      if (spriteLinking === null || disposed || gl.isContextLost()) return;
      if (!spriteLinkDone()) {
        linkPoll = window.setTimeout(poll, LINK_POLL_MILLISECONDS);
        return;
      }
      try {
        finishSpriteLink();
      } catch {
        // Kept in spriteLinkError: frames stay in map colours and `render` throws it.
      }
      schedule();
    };
    linkPoll = window.setTimeout(poll, LINK_POLL_MILLISECONDS);
  };

  const spriteLinkDone = (): boolean => spriteLinking === null || parallelCompile === null
    || (gl.getProgramParameter(spriteLinking.program, parallelCompile.COMPLETION_STATUS_KHR) as boolean);

  /**
   * Waits for the sprite program's link (if it is still running) and keeps the program; a failure is kept in
   * spriteLinkError and thrown. Either way the link has ended.
   */
  const finishSpriteLink = (): Program<(typeof SPRITE_CHUNK_UNIFORMS)[number]> => {
    if (spriteProgram !== null) return spriteProgram;
    if (spriteLinking === null) throw new Error("the sprite program is not being linked");
    const inBackground = parallelCompile !== null;
    try {
      spriteProgram = finishLink(gl, spriteLinking, SPRITE_CHUNK_UNIFORMS);
      return spriteProgram;
    } catch (error) {
      spriteLinkError = error instanceof Error ? error : new Error(String(error));
      throw spriteLinkError;
    } finally {
      endSpriteLink(inBackground);
    }
  };

  /** Forgets the pending link and its poll; reports the end of a background one. */
  const endSpriteLink = (background: boolean): void => {
    const pending = spriteLinking !== null;
    spriteLinking = null;
    window.clearTimeout(linkPoll);
    linkPoll = 0;
    if (pending && background) options?.onSpritesPreparing?.(false);
  };

  /** Uniforms of the tile colour function shared by both chunk passes; `sprites` those of the sprite program. */
  const setTileUniforms = (
    uniforms: Readonly<Record<(typeof TILE_UNIFORMS)[number], WebGLUniformLocation>
      & Partial<Record<(typeof OVERLAY_UNIFORMS)[number], WebGLUniformLocation>>>, cells = false,
    sprites: Readonly<Record<(typeof SPRITE_UNIFORMS)[number], WebGLUniformLocation>> | null = null,
  ): void => {
    gl.uniform1i(uniforms.uPlanes16, UNIT_PLANES_16);
    gl.uniform1i(uniforms.uPlanes8, UNIT_PLANES_8);
    gl.uniform1i(uniforms.uPresent, (planeSources?.present ?? 0) | (cells ? PRESENT.cells : 0));
    gl.uniform1i(uniforms.uPalette, UNIT_PALETTE);
    gl.uniform1i(uniforms.uBackground, UNIT_BACKGROUND);
    gl.uniform1i(uniforms.uRules, UNIT_RULES);
    gl.uniform1i(uniforms.uPaletteLength, paletteUploaded);
    gl.uniform1i(uniforms.uLayers, layers);
    // The sprite program has no wire overlay: the wire pass draws wires in sprite mode.
    if (uniforms.uWireColors !== undefined) gl.uniform3iv(uniforms.uWireColors, wireColorUniform);
    if (uniforms.uWireBits !== undefined) gl.uniform1iv(uniforms.uWireBits, wireBitUniform);
    if (uniforms.uWireAlpha !== undefined) gl.uniform1i(uniforms.uWireAlpha, WIRE_ALPHA);
    gl.uniform3iv(uniforms.uLiquids, liquidUniform);
    gl.uniform1i(uniforms.uPaintRow, background?.paintRow ?? 0);
    gl.uniform1i(uniforms.uPaintCount, paintCount);
    if (sprites === null) return;
    gl.uniform1i(sprites.uAtlas, UNIT_ATLAS);
    gl.uniform1i(sprites.uAtlasHalf, UNIT_ATLAS_HALF);
    gl.uniform1i(sprites.uSpriteSheets, UNIT_SPRITE_SHEETS);
    const sampling = spriteSampling(camera.zoom);
    gl.uniform1i(sprites.uSpriteSamples, sampling.samples);
    gl.uniform1f(sprites.uSpriteStep, sampling.step);
    gl.uniform1i(sprites.uSpriteLevel, sampling.level);
    gl.uniform1i(sprites.uSpriteWeight, sampling.weight);
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
        (slot % CHUNKS_PER_PAGE) | (framedSlots.has(slot)
          ? CELLS_INSTANCE_BIT | (wallSlots.has(slot) ? WALLS_INSTANCE_BIT : 0)
          : 0),
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

  /**
   * The object pass's instances of `chunk` (cached): its object sprites whose sheet is in the atlas, each as its
   * rectangle in world sprite pixels and the atlas place of its source rectangle. A rectangle past its sheet is dropped.
   */
  const objectsOf = (source: RenderableWorld, chunk: ChunkCoord, key: number): Int32Array => {
    const cached = objectCache.get(key);
    if (cached !== undefined) return cached;
    const area = {
      left: chunk.x * CHUNK_SIZE, top: chunk.y * CHUNK_SIZE, right: (chunk.x + 1) * CHUNK_SIZE, bottom: (chunk.y + 1) * CHUNK_SIZE,
    };
    const sprites: readonly ObjectSprite[] = objectSprites(source, area);
    const placed = new Int32Array(sprites.length * OBJECT_INTS);
    let at = 0;
    for (const sprite of sprites) {
      const sheet = sheetsByKey.get(`${sprite.kind}:${String(sprite.id)}`);
      if (sheet === undefined || sprite.sx < 0 || sprite.sy < 0) continue;
      if (sprite.sx + sprite.width > sheet.width || sprite.sy + sprite.height > sheet.height) continue;
      placed.set([sprite.dx, sprite.dy, sprite.width, sprite.height, sheet.page, sheet.x + sprite.sx, sheet.y + sprite.sy, 0], at);
      at += OBJECT_INTS;
    }
    const instances = placed.subarray(0, at);
    objectCache.set(key, instances);
    return instances;
  };

  /**
   * Draws the object sprites of the visible chunks and the chunks around them (an object may reach a few tiles past
   * its own chunk) over the chunk pass, blended by straight alpha. Returns the number of draw calls.
   */
  const drawObjects = (source: RenderableWorld, visible: readonly ChunkCoord[]): number => {
    const chunksX = Math.ceil(source.width / CHUNK_SIZE);
    const chunksY = Math.ceil(source.height / CHUNK_SIZE);
    const keys = new Set<number>();
    for (const chunk of visible) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = chunk.x + dx;
          const y = chunk.y + dy;
          if (x >= 0 && y >= 0 && x < chunksX && y < chunksY) keys.add(y * chunksX + x);
        }
      }
    }
    const sorted = [...keys].sort((a, b) => a - b);
    const previous = objectUploaded;
    // Unchanged when the same chunks are shown and none of their lists was dropped since the upload.
    const unchanged = previous !== null && previous.keys.length === sorted.length
      && sorted.every((key, index) => previous.keys[index] === key && objectCache.has(key));
    if (!unchanged) {
      const lists = sorted.map((key) => objectsOf(source, { x: key % chunksX, y: Math.floor(key / chunksX) }, key));
      const total = lists.reduce((sum, list) => sum + list.length, 0);
      if (objectData.length < total) objectData = new Int32Array(total * 2);
      let at = 0;
      for (const list of lists) {
        objectData.set(list, at);
        at += list.length;
      }
      if (total > 0) {
        gl.bindBuffer(gl.ARRAY_BUFFER, resources.objectInstances);
        gl.bufferData(gl.ARRAY_BUFFER, objectData.subarray(0, total), gl.DYNAMIC_DRAW);
      }
      objectUploaded = { keys: sorted, instances: total / OBJECT_INTS };
    }
    const instances = objectUploaded?.instances ?? 0;
    if (instances === 0) return 0;
    objectProgram ??= link(gl, objectVertexSource, objectFragmentSource, OBJECT_UNIFORMS);
    gl.useProgram(objectProgram.program);
    setSpritePassUniforms(objectProgram.uniforms);
    gl.bindVertexArray(resources.objectArray);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
    return 1;
  };

  /** The wire and actuator bits and runs of `chunk` (cached); none without a flags plane. */
  const wireRunsOf = (source: RenderableWorld, chunk: ChunkCoord, key: number): WireRuns => {
    const cached = wireChunks.get(key);
    if (cached !== undefined) return cached;
    const runs = source.planes.flags === undefined ? { bits: 0, runs: new Int32Array(0) } : collectWireRuns(source, chunk);
    wireChunks.set(key, runs);
    return runs;
  };

  /**
   * Draws the wires and actuators of the chunks of `ready` with any shown over everything else, premultiplied: one quad
   * per run of tiles with a wire or actuator (wireVertexSource), so the pass shades only those tiles.
   */
  const drawWires = (source: RenderableWorld, ready: readonly (readonly [ChunkCoord, number])[]): number => {
    const shown = (layers >> 4) & WIRE_LAYER.all;
    const chunksX = Math.ceil(source.width / CHUNK_SIZE);
    const items = ready
      .map(([chunk, slot]) => [chunk, slot, wireRunsOf(source, chunk, chunk.y * chunksX + chunk.x)] as const)
      .filter(([, , runs]) => (runs.bits & shown) !== 0)
      .sort((first, second) => first[1] - second[1]);
    if (items.length === 0) return 0;
    const total = items.reduce((sum, [, , runs]) => sum + runs.runs.length / 4, 0);
    if (wireData.length < total * WIRE_INTS) wireData = new Int32Array(total * WIRE_INTS * 2);
    // Per page (its instances contiguous), where its instances start.
    const pageStarts: (readonly [page: number, start: number])[] = [];
    let at = 0;
    for (const [chunk, slot, { runs }] of items) {
      const page = Math.floor(slot / CHUNKS_PER_PAGE);
      if (pageStarts.at(-1)?.[0] !== page) pageStarts.push([page, at / WIRE_INTS]);
      const originX = chunk.x * CHUNK_SIZE;
      const originY = chunk.y * CHUNK_SIZE;
      const width = Math.min(CHUNK_SIZE, source.width - originX);
      const height = Math.min(CHUNK_SIZE, source.height - originY);
      for (let k = 0; k < runs.length; k += 4) {
        wireData[at] = originX;
        wireData[at + 1] = originY;
        wireData[at + 2] = width;
        wireData[at + 3] = height;
        wireData[at + 4] = slot % CHUNKS_PER_PAGE;
        wireData.set(runs.subarray(k, k + 4), at + 5);
        at += WIRE_INTS;
      }
    }
    wireProgram ??= link(gl, wireVertexSource, wireFragmentSource, WIRE_UNIFORMS);
    const program = wireProgram;
    gl.useProgram(program.program);
    setSpritePassUniforms(program.uniforms);
    const { uniforms } = program;
    gl.uniform1i(uniforms.uPlanes16, UNIT_PLANES_16);
    gl.uniform1i(uniforms.uPresent, planeSources?.present ?? 0);
    gl.uniform1i(uniforms.uLayers, layers);
    gl.uniform3iv(uniforms.uWireColors, wireColorUniform);
    gl.uniform1iv(uniforms.uWireBits, wireBitUniform);
    gl.uniform1i(uniforms.uWireAlpha, WIRE_ALPHA);
    gl.uniform2i(uniforms.uWorldSize, source.width, source.height);
    gl.uniform4iv(uniforms.uWireSheet, wireSheet);
    gl.uniform4iv(uniforms.uActuatorSheet, actuatorSheet);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(resources.wireArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.wireInstances);
    gl.bufferData(gl.ARRAY_BUFFER, wireData.subarray(0, at), gl.STREAM_DRAW);
    const stride = WIRE_INTS * 4;
    let calls = 0;
    pageStarts.forEach(([pageIndex, start], index) => {
      const end = pageStarts[index + 1]?.[1] ?? at / WIRE_INTS;
      const page = pages[pageIndex];
      if (page === undefined) return;
      gl.activeTexture(gl.TEXTURE0 + UNIT_PLANES_16);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.planes16);
      // No base instance in WebGL2: each page's instances start at an attribute offset.
      gl.vertexAttribIPointer(RECT_ATTRIBUTE, 4, gl.INT, stride, start * stride);
      gl.vertexAttribIPointer(LAYER_ATTRIBUTE, 1, gl.INT, stride, start * stride + 16);
      gl.vertexAttribIPointer(WIRE_RUN_ATTRIBUTE, 4, gl.INT, stride, start * stride + 20);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, end - start);
      calls++;
    });
    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
    return calls;
  };

  /** The camera and sprite sampling uniforms the object and wire passes share. */
  const setSpritePassUniforms = (uniforms: Readonly<Record<(typeof OBJECT_UNIFORMS)[number], WebGLUniformLocation>>): void => {
    gl.uniform2f(uniforms.uCamera, view.x, view.y);
    gl.uniform1f(uniforms.uZoom, view.zoom);
    gl.uniform2f(uniforms.uViewport, canvas.width, canvas.height);
    gl.uniform1i(uniforms.uAtlas, UNIT_ATLAS);
    gl.uniform1i(uniforms.uAtlasHalf, UNIT_ATLAS_HALF);
    const sampling = spriteSampling(camera.zoom);
    gl.uniform1i(uniforms.uSpriteSamples, sampling.samples);
    gl.uniform1f(uniforms.uSpriteStep, sampling.step);
    gl.uniform1i(uniforms.uSpriteLevel, sampling.level);
    gl.uniform1i(uniforms.uSpriteWeight, sampling.weight);
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
    gl.uniform2f(program.uniforms.uCamera, view.x, view.y);
    gl.uniform1f(program.uniforms.uZoom, view.zoom);
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

  /** The offscreen target `index` at the canvas size, created or resized as needed. */
  const frameTarget = (index: number, width: number, height: number): FrameTarget => {
    const existing = frameTargets[index];
    if (existing?.width === width && existing.height === height) return existing;
    if (existing !== undefined) {
      gl.deleteTexture(existing.texture);
      gl.deleteFramebuffer(existing.framebuffer);
    }
    const texture = requireValue(gl.createTexture(), "a texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, height);
    const framebuffer = requireValue(gl.createFramebuffer(), "a framebuffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const created = { texture, framebuffer, width, height };
    frameTargets[index] = created;
    lastFrame = null;
    return created;
  };

  const releaseFrames = (): void => {
    if (!gl.isContextLost()) {
      // Sparse until both targets were used.
      for (const target of frameTargets.filter((entry): entry is FrameTarget => entry !== undefined)) {
        gl.deleteTexture(target.texture);
        gl.deleteFramebuffer(target.framebuffer);
      }
    }
    frameTargets = [];
    lastFrame = null;
  };

  /** `uploadBudget` chunks at most, and none after `uploadMilliseconds` once one was uploaded. */
  const drawFrame = (uploadBudget: number, uploadMilliseconds: number, wait: boolean): void => {
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
    // Synchronous frames (render()) draw the camera as given, straight to the canvas.
    const scheduled = !wait && camera.zoom >= 1;
    view = scheduled
      ? { x: Math.round(camera.x * camera.zoom) / camera.zoom, y: Math.round(camera.y * camera.zoom) / camera.zoom, zoom: camera.zoom }
      : camera;
    // Uploads within this frame change what resident chunks show (prefetched chunks lie outside the view).
    const uploadsAtStart = textureUploads + atlasUploads;

    uploadPalette(source.palette);
    uploadBackground(source);
    // Below one pixel per overview texel, the overview stands in for the chunks.
    const candidate = overviewOf(source);
    const target = candidate !== null && camera.zoom < 1 / candidate.factor ? candidate : null;

    const chunksX = Math.ceil(source.width / CHUNK_SIZE);
    const keyOf = (chunk: ChunkCoord): number => chunk.y * chunksX + chunk.x;
    const visible = visibleChunks(view, viewport, source);
    const spriteZoom = spriteMode && atlasTexture !== null && camera.zoom >= SPRITE_MIN_ZOOM;
    const spriteChunk = spriteZoom ? spriteProgramOf(wait) : null;
    // Until the sprite program is linked, frames are drawn in map colours.
    const sprites = spriteChunk !== null;
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
        wallCache?.drop({ x: key % chunksX, y: Math.floor(key / chunksX) });
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
     * Uploads the changed part of a resident chunk whose planes changed (invalidateTiles) again, into its own slot, and
     * of its cells if the slot holds them. False when the frame's budget is spent: the chunk keeps drawing what it held.
     */
    const refresh = (chunk: ChunkCoord, slot: number): boolean => {
      const key = keyOf(chunk);
      const area = dirtyChunks.get(key);
      if (area === undefined) return true;
      if (!mayUpload()) {
        loading.pending = true;
        return false;
      }
      uploads++;
      uploadChunk(source, chunk, slot, area);
      if (framedSlots.has(slot)) uploadCellArea(source, chunk, slot, area);
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

    /** The chunk pass, then in sprite mode the object and wire passes, into the bound target. */
    const drawChunks = (): void => {
      // Chunks still loading show the overview (built when the area was seen zoomed out, possibly with other layers)
      // instead of a hole; drawn chunks overwrite it completely, so a complete frame stays exact.
      if (loading.pending && candidate?.filled === true) drawCalls += drawOverview(source, candidate);
      // Sprites switch programs: crossing the threshold or toggling the mode uploads no planes and no atlas (only a
      // resident chunk's cells, once, on its first draw at a sprite zoom with a framing).
      const program = spriteChunk ?? resources.chunk;
      gl.useProgram(program.program);
      setTileUniforms(program.uniforms, framed, spriteChunk?.uniforms ?? null);
      gl.uniform2f(program.uniforms.uCamera, view.x, view.y);
      gl.uniform1f(program.uniforms.uZoom, view.zoom);
      gl.uniform2f(program.uniforms.uViewport, viewport.width, viewport.height);
      // Below one pixel per tile a pixel averages the tiles under it (filterTiles) instead of point-sampling one.
      gl.uniform1i(program.uniforms.uFilter, view.zoom < 1 ? 1 : 0);
      gl.uniform1f(program.uniforms.uStep, filterTilesPerPixel(view.zoom));
      gl.uniform2i(program.uniforms.uWorldSize, source.width, source.height);
      gl.activeTexture(gl.TEXTURE0 + UNIT_PALETTE);
      gl.bindTexture(gl.TEXTURE_2D, resources.palette);
      gl.activeTexture(gl.TEXTURE0 + UNIT_BACKGROUND);
      gl.bindTexture(gl.TEXTURE_2D, background?.texture ?? null);
      gl.activeTexture(gl.TEXTURE0 + UNIT_RULES);
      gl.bindTexture(gl.TEXTURE_2D, resources.rules);
      gl.activeTexture(gl.TEXTURE0 + UNIT_ATLAS);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlasTexture);
      gl.activeTexture(gl.TEXTURE0 + UNIT_ATLAS_HALF);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, atlasHalfTexture);
      gl.activeTexture(gl.TEXTURE0 + UNIT_SPRITE_SHEETS);
      gl.bindTexture(gl.TEXTURE_2D, resources.spriteSheets);
      drawCalls += drawInstances(source, ready);
      // Sprite mode draws the objects (trees, track extras) over the chunks, and the wires over everything.
      if (spriteChunk !== null) {
        if ((layers & 4) !== 0) drawCalls += drawObjects(source, visible);
        if (((layers >> 4) & WIRE_LAYER.all) !== 0 && ((planeSources?.present ?? 0) & PRESENT.flags) !== 0) {
          drawCalls += drawWires(source, ready);
        }
      }
    };

    const { width, height } = viewport;
    if (target === null && scheduled) {
      // The previous frame shifted by whole pixels, when only the camera moved since (by less than the canvas).
      const pixelX = Math.round(view.x * view.zoom);
      const pixelY = Math.round(view.y * view.zoom);
      const previous = lastFrame;
      const shift = previous !== null && !loading.pending && previous.version === frameVersion
        && textureUploads + atlasUploads === uploadsAtStart && previous.zoom === view.zoom && previous.sprites === (spriteChunk !== null)
        && previous.width === width && previous.height === height
        && Math.abs(pixelX - previous.pixelX) < width && Math.abs(pixelY - previous.pixelY) < height
        ? { x: pixelX - previous.pixelX, y: pixelY - previous.pixelY }
        : null;
      const last = frameTargets[frameCurrent];
      const output = frameTarget(1 - frameCurrent, width, height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, output.framebuffer);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      if (shift !== null && last !== undefined) {
        // Screen content moves left by shift.x and up by shift.y; framebuffer rows count from the bottom.
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, last.framebuffer);
        const fromX = Math.max(0, shift.x);
        const toX = Math.min(width, width + shift.x);
        const fromY = Math.max(0, -shift.y);
        const toY = Math.min(height, height - shift.y);
        gl.blitFramebuffer(fromX, fromY, toX, toY, fromX - shift.x, fromY + shift.y, toX - shift.x, toY + shift.y,
          gl.COLOR_BUFFER_BIT, gl.NEAREST);
        // The revealed strips (x, y, width, height in framebuffer pixels), drawn again.
        const strips: (readonly [number, number, number, number])[] = [];
        if (shift.x > 0) strips.push([width - shift.x, 0, shift.x, height]);
        else if (shift.x < 0) strips.push([0, 0, -shift.x, height]);
        if (shift.y > 0) strips.push([0, 0, width, shift.y]);
        else if (shift.y < 0) strips.push([0, height + shift.y, width, -shift.y]);
        gl.enable(gl.SCISSOR_TEST);
        for (const [x, y, w, h] of strips) {
          gl.scissor(x, y, w, h);
          gl.clear(gl.COLOR_BUFFER_BIT);
          drawChunks();
        }
        gl.disable(gl.SCISSOR_TEST);
        reusedFrames++;
      } else {
        gl.clear(gl.COLOR_BUFFER_BIT);
        drawChunks();
      }
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, output.framebuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
      gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      frameCurrent = 1 - frameCurrent;
      lastFrame = loading.pending ? null : {
        pixelX, pixelY, zoom: view.zoom, sprites: spriteChunk !== null, version: frameVersion, width, height,
      };
    } else {
      lastFrame = null;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (target === null) drawChunks();
      else drawCalls = drawOverview(source, target);
    }
    if (target === null) {
      const drawnKeys = new Set(ready.map(([chunk]) => keyOf(chunk)));
      drawn = visible.filter((chunk) => drawnKeys.has(keyOf(chunk)));
    } else {
      drawn = visible.filter((chunk) => target.built[keyOf(chunk)] === 1);
    }
    // While the sprite program links, the poll asks for the next frame once it is done (startSpriteLink).
    if (loading.pending) schedule();
    else if (target === null) schedulePrefetch();
  };

  // The pending idle prefetch step (requestIdleCallback, or a timeout where there is none); 0 when none is pending.
  let prefetchHandle = 0;
  const idle = typeof requestIdleCallback === "function";

  /** Asks for an idle prefetch step, unless one is pending or prefetching is off. */
  const schedulePrefetch = (): void => {
    if (prefetchChunks === 0 || prefetchHandle !== 0 || disposed) return;
    prefetchHandle = idle
      ? requestIdleCallback((deadline) => { prefetchHandle = 0; prefetchStep(deadline); }, { timeout: 500 })
      : globalThis.setTimeout(() => { prefetchHandle = 0; prefetchStep(null); }, 16);
  };

  const cancelPrefetch = (): void => {
    if (prefetchHandle === 0) return;
    if (idle) cancelIdleCallback(prefetchHandle);
    else clearTimeout(prefetchHandle);
    prefetchHandle = 0;
  };

  /**
   * Uploads (and frames, at a sprite zoom) the nearest chunks of the ring of `prefetchChunks` chunks around the
   * viewport that are not resident yet, while the idle period lasts; at least one per step. Evicts only chunks outside
   * the view and the ring. A scheduled frame goes first: the step then waits for the next idle period.
   */
  const prefetchStep = (deadline: IdleDeadline | null): void => {
    if (disposed || gl.isContextLost() || world === null) return;
    if (frame !== 0) {
      schedulePrefetch();
      return;
    }
    const source = world;
    const viewport = { width: canvas.width, height: canvas.height };
    const overview = overviewOf(source);
    if (overview !== null && camera.zoom < 1 / overview.factor) return;
    const framed = spriteMode && atlasTexture !== null && camera.zoom >= SPRITE_MIN_ZOOM && spriteProgram !== null
      && framing !== null;
    const chunksX = Math.ceil(source.width / CHUNK_SIZE);
    const keyOf = (chunk: ChunkCoord): number => chunk.y * chunksX + chunk.x;
    const margin = prefetchChunks * CHUNK_SIZE;
    const around = visibleChunks(
      { x: camera.x - margin, y: camera.y - margin, zoom: camera.zoom },
      { width: viewport.width + 2 * margin * camera.zoom, height: viewport.height + 2 * margin * camera.zoom },
      source,
    );
    const keep = new Set(around.map(keyOf));
    // The view's chunks are the frames' to load: a prefetch never changes what the last frame shows.
    const inView = new Set(visibleChunks(camera, viewport, source).map(keyOf));
    const centreX = camera.x + viewport.width / (2 * camera.zoom);
    const centreY = camera.y + viewport.height / (2 * camera.zoom);
    const distance = (chunk: ChunkCoord): number =>
      Math.hypot((chunk.x + 0.5) * CHUNK_SIZE - centreX, (chunk.y + 0.5) * CHUNK_SIZE - centreY);
    const wanted = around.filter((chunk) => {
      if (inView.has(keyOf(chunk))) return false;
      const slot = chunks.get(keyOf(chunk));
      if (slot === undefined) return true;
      return framed && !framedSlots.has(slot) && !dirtyChunks.has(keyOf(chunk));
    }).sort((first, second) => distance(first) - distance(second));
    let done = 0;
    for (const chunk of wanted) {
      if (done > 0 && (deadline === null || deadline.timeRemaining() < PREFETCH_IDLE_RESERVE)) break;
      const key = keyOf(chunk);
      let slot = chunks.get(key);
      if (slot === undefined) {
        if (chunks.size >= cacheCapacity) {
          // The least recently used chunk outside the view and the ring; none: the cache holds only those.
          let evicted = false;
          for (const [other, otherSlot] of chunks) {
            if (keep.has(other)) continue;
            chunks.delete(other);
            freeSlots.push(otherSlot);
            evictedChunks++;
            dirtyChunks.delete(other);
            cellCache?.drop({ x: other % chunksX, y: Math.floor(other / chunksX) });
            wallCache?.drop({ x: other % chunksX, y: Math.floor(other / chunksX) });
            evicted = true;
            break;
          }
          if (!evicted) return;
        }
        slot = allocateSlot();
        uploadChunk(source, chunk, slot);
        chunks.set(key, slot);
      }
      if (framed) uploadCells(source, chunk, slot);
      done++;
    }
    if (done > 0 && done < wanted.length) schedulePrefetch();
  };

  const schedule = (): void => {
    if (frame !== 0 || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      drawFrame(maxChunkUploadsPerFrame, maxUploadMillisecondsPerFrame, false);
    });
  };

  const onContextLost = (event: Event): void => {
    // Without this the browser never restores the context.
    event.preventDefault();
    // A background link dies with the context (no GL call needed to forget it).
    endSpriteLink(parallelCompile !== null);
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
    // The offscreen frames died with the context.
    frameTargets = [];
    lastFrame = null;
    spriteProgram = null;
    objectProgram = null;
    wireProgram = null;
    objectUploaded = null;
    // A background link died with the context; the next sprite frame (or atlas) starts another.
    endSpriteLink(parallelCompile !== null);
    spriteLinkError = null;
    parallelCompile = parallelShaderCompile(gl);
    halfAtlasProgram = null;
    // The atlas died with the context too: upload it again (its sheets follow the palette's next upload).
    atlasTexture = null;
    atlasHalfTexture = null;
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
      frameVersion++;
      if (next !== world) {
        clearChunks();
        cacheCapacity = maxCachedChunks;
        releaseBackground();
        releaseOverview();
        paletteUploaded = 0;
        planeSources = null;
        objectCache.clear();
        objectUploaded = null;
        wireChunks.clear();
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
      frameVersion++;
      if (!gl.isContextLost()) {
        applyAtlas(next);
        // Linking starts now, while the assets arrive, rather than on the first sprite frame.
        if (next !== null) startSpriteLink();
      }
      schedule();
    },
    setSpriteMode: (enabled) => {
      spriteMode = enabled;
      frameVersion++;
      schedule();
    },
    setFraming: (next) => {
      if (next === framing) return;
      releaseCells();
      framing = next;
      frameVersion++;
      schedule();
    },
    invalidateTiles: (tiles) => {
      if (world === null || tiles.length === 0) return;
      frameVersion++;
      const source = world;
      const regions = cellCache?.world === source ? cellCache.invalidate(tiles) : [];
      const wallRegions = wallCache?.world === source ? wallCache.invalidate(tiles) : [];
      const chunksX = Math.ceil(source.width / CHUNK_SIZE);
      // Per touched chunk, the union of the changed tiles (right and bottom exclusive).
      const touched = new Map<number, Area>();
      const touch = (left: number, top: number, right: number, bottom: number): void => {
        const lastX = Math.floor(Math.min(source.width - 1, right) / CHUNK_SIZE);
        const lastY = Math.floor(Math.min(source.height - 1, bottom) / CHUNK_SIZE);
        for (let x = Math.floor(Math.max(0, left) / CHUNK_SIZE); x <= lastX; x++) {
          for (let y = Math.floor(Math.max(0, top) / CHUNK_SIZE); y <= lastY; y++) {
            const key = y * chunksX + x;
            touched.set(key, union(touched.get(key), { left, top, right: right + 1, bottom: bottom + 1 }));
          }
        }
      };
      // A changed tile's planes lie in its chunk and, through the page apron, in its neighbours'; the cells of its
      // recomputed area in the chunks the area covers.
      for (const { x, y } of tiles) touch(x - PAGE_APRON, y - PAGE_APRON, x + PAGE_APRON, y + PAGE_APRON);
      for (const area of regions) touch(area.left, area.top, area.left + area.width - 1, area.top + area.height - 1);
      // Wall cells are uploaded with the apron: a recomputed wall cell lies in the layers of the chunks around it too.
      for (const area of wallRegions) {
        const right = area.left + area.width - 1;
        const bottom = area.top + area.height - 1;
        touch(area.left - PAGE_APRON, area.top - PAGE_APRON, right + PAGE_APRON, bottom + PAGE_APRON);
      }
      // An object's look can depend on tiles far from it (a tree's on the ground under its trunk): the object lists of
      // every chunk within one chunk of a changed tile are collected again.
      for (const { x, y } of tiles) {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkY = Math.floor(y / CHUNK_SIZE);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) objectCache.delete((chunkY + dy) * chunksX + chunkX + dx);
        wireChunks.delete(chunkY * chunksX + chunkX);
      }
      for (const [key, area] of touched) {
        if (chunks.has(key)) dirtyChunks.set(key, union(dirtyChunks.get(key), area));
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
      frameVersion++;
      schedule();
    },
    tileAt: (screenX, screenY) => {
      if (world === null || screenX < 0 || screenY < 0 || screenX >= canvas.width || screenY >= canvas.height) return null;
      const x = Math.floor(camera.x + screenX / camera.zoom);
      const y = Math.floor(camera.y + screenY / camera.zoom);
      return x < 0 || y < 0 || x >= world.width || y >= world.height ? null : { x, y };
    },
    render: () => { drawFrame(Infinity, Infinity, true); },
    flushFrame: () => {
      if (frame === 0) return;
      cancelAnimationFrame(frame);
      frame = 0;
      drawFrame(maxChunkUploadsPerFrame, maxUploadMillisecondsPerFrame, false);
    },
    stats: () => ({
      textureUploads, drawCalls, visibleChunks: drawn, residentChunks: chunks.size, evictedChunks, atlasUploads,
      framedTiles: framedBefore + (cellCache?.framedTiles ?? 0),
      framedWalls: framedWallsBefore + (wallCache?.framedTiles ?? 0),
      spritesPreparing: spriteLinking !== null,
      reusedFrames,
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      cancelPrefetch();
      releaseFrames();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (!gl.isContextLost()) {
        // The context outlives this renderer: leave it with the default unpack state.
        resetUnpack();
        clearChunks();
        releaseOverview();
        for (const program of [resources.chunk, resources.build, resources.overview]) gl.deleteProgram(program.program);
        if (spriteProgram !== null) gl.deleteProgram(spriteProgram.program);
        if (spriteLinking !== null) gl.deleteProgram(spriteLinking.program);
        if (objectProgram !== null) gl.deleteProgram(objectProgram.program);
        if (wireProgram !== null) gl.deleteProgram(wireProgram.program);
        if (halfAtlasProgram !== null) gl.deleteProgram(halfAtlasProgram.program);
        gl.deleteTexture(resources.palette);
        gl.deleteTexture(resources.rules);
        gl.deleteTexture(resources.spriteSheets);
        releaseAtlas();
        gl.deleteBuffer(resources.instances);
        gl.deleteVertexArray(resources.instanceArray);
        gl.deleteBuffer(resources.wireInstances);
        gl.deleteVertexArray(resources.wireArray);
        gl.deleteBuffer(resources.objectInstances);
        gl.deleteVertexArray(resources.objectArray);
        gl.deleteVertexArray(resources.emptyArray);
        gl.deleteFramebuffer(resources.framebuffer);
      }
      endSpriteLink(parallelCompile !== null);
      releaseBackground();
      unpackWorld = null;
    },
  };
}
