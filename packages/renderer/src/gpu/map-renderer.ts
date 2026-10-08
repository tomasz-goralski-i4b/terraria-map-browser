// The WebGL2 backend draws into a DOM canvas; the DOM types are declared here, where they are used, so the rest of
// the package keeps the DOM-free lib of the base config.
/// <reference lib="dom" />

import type { ContentRef } from "@studio/world-model";
import { CHUNK_SIZE, visibleChunks } from "../camera/camera.js";
import type { Camera, ChunkCoord, Size } from "../camera/camera.js";
import { WIRE_ALPHA, WIRE_COLORS, WIRE_LAYER, type ChunkLayers } from "../chunk/render.js";
import {
  backgroundColor, contentColor, liquidColors, mapOption, optionColor, optionColors, optionRule,
} from "../palette/map-palette.js";
import type { MapOptionRule, MapPalette, Rgba } from "../palette/map-palette.js";
import {
  LAYER_ATTRIBUTE, RECT_ATTRIBUTE, chunkFragmentSource, chunkVertexSource, overviewBuildFragmentSource,
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
    /** Frame planes pick the map option of multi-option content; absent planes mean frame 0 everywhere. */
    readonly frameX?: Int16Array;
    readonly frameY?: Int16Array;
    /** CWM flags; only the wire and actuator bits (0–4) are read, for the wire overlay. Absent means none. */
    readonly flags?: Uint16Array;
  };
  /** Append-only palette. */
  readonly palette: readonly ContentRef[];
}

export interface MapRendererOptions {
  /**
   * Upper bound of uncached visible chunks uploaded per scheduled animation frame. Default 32.
   * Finite values are floored and clamped to at least 1; non-finite values use the default.
   */
  readonly maxChunkUploadsPerFrame?: number;
  /**
   * Baseline chunk texture cache capacity (LRU). Default 512 (about 100 MiB of chunk pages).
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
   * Texture upload calls since creation: one per chunk upload (all planes), one per palette append and one per
   * background (once per world).
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
}

export interface MapRenderer {
  readonly setWorld: (world: RenderableWorld | null) => void;
  /** The viewport is the canvas backing store (`canvas.width` × `canvas.height`). */
  readonly setCamera: (camera: Camera) => void;
  readonly setLayers: (layers: ChunkLayers) => void;
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
const VARIANT_CAPACITY = 0xffff;
const ABSENT = 0xffff;
const DEFAULT_MAX_CACHED_CHUNKS = 512;
const DEFAULT_MAX_CHUNK_UPLOADS_PER_FRAME = 32;
/** Chunks per page (array texture layers); a page of both textures is 12 MiB. */
const PAGE_LAYERS = 64;
/** Ints per instance: the chunk rectangle (origin x, origin y, columns, rows) and its page layer. */
const INSTANCE_INTS = 5;
/** The smallest overview factor: one overview texel per 2 × 2 tiles, used below half a pixel per tile. */
const MIN_OVERVIEW_FACTOR = 2;

// Texture units: 0–1 the chunk page; 2 palette; 3 background and paint colours; 4 variant colours; 5 overview.
const UNIT_WIDE = 0;
const UNIT_NARROW = 1;
const UNIT_PALETTE = 2;
const UNIT_BACKGROUND = 3;
const UNIT_VARIANTS = 4;
const UNIT_OVERVIEW = 5;

const TILE_UNIFORMS = [
  "uWide", "uNarrow", "uPalette", "uBackground", "uVariantColors", "uPaintRow", "uPaintCount", "uPaletteLength",
  "uLayers", "uLiquids", "uWireColors", "uWireBits", "uWireAlpha",
] as const;
const CHUNK_UNIFORMS = [...TILE_UNIFORMS, "uCamera", "uZoom", "uViewport"] as const;
const BUILD_UNIFORMS = [...TILE_UNIFORMS, "uFactor", "uTarget"] as const;
const OVERVIEW_UNIFORMS = ["uCamera", "uZoom", "uViewport", "uWorld", "uExtent", "uOverview"] as const;

interface Program<Name extends string> {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<Name, WebGLUniformLocation>>;
}

/** One array texture pair holding up to PAGE_LAYERS chunks. */
interface Page {
  /** RGBA16UI: block, wall, variant, reserved. */
  readonly wide: WebGLTexture;
  /** RGBA8UI: liquid kind, liquid amount, block paint, wall paint. */
  readonly narrow: WebGLTexture;
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
  /** Colours of frame-selected options, 256 per row. */
  readonly variantColors: WebGLTexture;
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

function pageTexture(gl: WebGL2RenderingContext, format: number): WebGLTexture {
  const texture = requireValue(gl.createTexture(), "a texture");
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, texture);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, format, CHUNK_SIZE, CHUNK_SIZE, PAGE_LAYERS);
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

function createResources(gl: WebGL2RenderingContext): GpuResources {
  const instances = requireValue(gl.createBuffer(), "a buffer");
  return {
    chunk: link(gl, chunkVertexSource, chunkFragmentSource, CHUNK_UNIFORMS),
    build: link(gl, overviewBuildVertexSource, overviewBuildFragmentSource, BUILD_UNIFORMS),
    overview: link(gl, overviewVertexSource, overviewFragmentSource, OVERVIEW_UNIFORMS),
    instances,
    instanceArray: instanceArray(gl, instances),
    emptyArray: requireValue(gl.createVertexArray(), "a vertex array"),
    framebuffer: requireValue(gl.createFramebuffer(), "a framebuffer"),
    palette: integerTexture(gl, gl.RGBA8UI, PALETTE_WIDTH, PALETTE_HEIGHT),
    variantColors: integerTexture(gl, gl.RGBA8UI, PALETTE_ROW, PALETTE_ROW),
  };
}

function layerBits(layers: ChunkLayers): number {
  return (layers.background ? 1 : 0) | (layers.walls ? 2 : 0) | (layers.blocks ? 4 : 0) | (layers.liquids ? 8 : 0)
    | (((layers.wires ?? 0) & WIRE_LAYER.all) << 4);
}

const wireColorUniform = new Int32Array(WIRE_COLORS.flatMap(([, color]) => [...color]));
const wireBitUniform = new Int32Array(WIRE_COLORS.map(([bit]) => bit));

export function createMapRenderer(canvas: HTMLCanvasElement, options?: MapRendererOptions): MapRenderer {
  // Straight (non-premultiplied) alpha: the shader writes the same RGBA that `renderChunk` produces.
  const context = canvas.getContext("webgl2", { premultipliedAlpha: false });
  if (context === null) throw new WebGl2UnavailableError();
  const gl: WebGL2RenderingContext = context;
  const maxCachedChunks = Math.max(1, options?.maxCachedChunks ?? DEFAULT_MAX_CACHED_CHUNKS);
  const requestedUploadBudget = options?.maxChunkUploadsPerFrame ?? DEFAULT_MAX_CHUNK_UPLOADS_PER_FRAME;
  const maxChunkUploadsPerFrame = Number.isFinite(requestedUploadBudget)
    ? Math.max(1, Math.floor(requestedUploadBudget))
    : DEFAULT_MAX_CHUNK_UPLOADS_PER_FRAME;
  const mapPalette = options?.mapPalette;
  // The four liquid kinds (CWM kinds 1–4) as the shader's ivec3 array.
  const liquidUniform = new Int32Array(liquidColors(mapPalette).slice(1).flatMap(([red, green, blue]) => [red, green, blue]));
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

  // Looked up once: getExtension returns null while the context is lost. Used only to restore a forced loss.
  const loseContext = gl.getExtension("WEBGL_lose_context");
  let resources = createResources(gl);
  let world: RenderableWorld | null = null;
  let cacheCapacity = maxCachedChunks;
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let layers = 15;
  // LRU of chunk key → page slot (page * PAGE_LAYERS + layer): Map iteration order is insertion order, and a hit
  // re-inserts its key at the end.
  const chunks = new Map<number, number>();
  const pages: Page[] = [];
  const freeSlots: number[] = [];
  let nextSlot = 0;
  // Interleaved planes of one chunk, in the page layout (transposed, CHUNK_SIZE texels per chunk column).
  const wideStaging = new Uint16Array(CHUNK_SIZE * CHUNK_SIZE * 4);
  const narrowStaging = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE * 4);
  let instanceData = new Int32Array(INSTANCE_INTS * 256);
  const paletteMirror = new Uint8Array(PALETTE_WIDTH * PALETTE_HEIGHT * 4);
  let paletteUploaded = 0;
  // Frame-selected colours, appended as chunks upload: variant ids (1-based) by palette index and option.
  const variantMirror = new Uint8Array(PALETTE_ROW * PALETTE_ROW * 4);
  const variantIds = new Map<number, number>();
  const optionsByPalette = new Map<number, { readonly rule: MapOptionRule; readonly colors: readonly Rgba[]; readonly paletteOption: number } | null>();
  let variantCount = 0;
  // Per-row background colours plus the paint row, for the world they were computed for.
  let background: { readonly texture: WebGLTexture; readonly world: RenderableWorld; readonly paintRow: number } | null = null;
  let overview: Overview | null = null;
  const paintCount = mapPalette === undefined ? 0 : Math.min(PALETTE_ROW, mapPalette.paints.length);
  let textureUploads = 0;
  let evictedChunks = 0;
  let drawCalls = 0;
  let drawn: readonly ChunkCoord[] = [];
  let frame = 0;
  let disposed = false;

  const resetVariants = (): void => {
    variantIds.clear();
    optionsByPalette.clear();
    variantCount = 0;
  };

  const clearChunks = (): void => {
    for (const page of pages) {
      gl.deleteTexture(page.wide);
      gl.deleteTexture(page.narrow);
    }
    pages.length = 0;
    chunks.clear();
    freeSlots.length = 0;
    nextSlot = 0;
  };

  const releaseOverview = (): void => {
    if (overview !== null && !gl.isContextLost()) gl.deleteTexture(overview.texture);
    overview = null;
  };

  /** Forgets every overview texel (their chunks draw them again on demand) and clears the texture. */
  const invalidateOverview = (): void => {
    if (overview === null) return;
    overview.built.fill(0);
    overview.builtCount = 0;
    gl.bindFramebuffer(gl.FRAMEBUFFER, resources.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, overview.texture, 0);
    gl.viewport(0, 0, overview.width, overview.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0 + UNIT_OVERVIEW);
    gl.bindTexture(gl.TEXTURE_2D, overview.texture);
    gl.generateMipmap(gl.TEXTURE_2D);
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
    }
    const firstRow = Math.floor(paletteUploaded / PALETTE_ROW);
    const lastRow = Math.floor((total - 1) / PALETTE_ROW);
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
    textureUploads++;
    // Content colours the overview already holds may have been absent (out of range) before this append.
    invalidateOverview();
    paletteUploaded = total;
  };

  /**
   * The variant id of a block: its frame-selected option colour, or 0 when the palette colour applies. The palette
   * colour is `contentColor` at frame (0, 0), which is not option 0 when the rule maps frame (0, 0) elsewhere (a
   * sunflower's flower): "no variant" therefore means "the option of frame (0, 0)".
   */
  const variantOf = (paletteIndex: number, frameX: number, frameY: number, palette: readonly ContentRef[]): number => {
    let choices = optionsByPalette.get(paletteIndex);
    if (choices === undefined) {
      const ref = palette[paletteIndex];
      const rule = ref === undefined ? undefined : optionRule(ref, "block", mapPalette);
      const colors = ref === undefined ? undefined : optionColors(ref, "block", mapPalette);
      choices = rule === undefined || colors === undefined ? null : { rule, colors, paletteOption: mapOption(rule, 0, 0) };
      optionsByPalette.set(paletteIndex, choices);
    }
    if (choices === null) return 0;
    const option = mapOption(choices.rule, frameX, frameY);
    if (option === choices.paletteOption) return 0;
    const key = paletteIndex * 256 + option;
    let id = variantIds.get(key);
    if (id === undefined) {
      const color = optionColor(choices.colors, option);
      if (color === undefined || variantCount >= VARIANT_CAPACITY) return 0;
      variantMirror.set(color, variantCount * 4);
      id = ++variantCount;
      variantIds.set(key, id);
    }
    return id;
  };

  const allocateSlot = (): number => {
    const free = freeSlots.pop();
    if (free !== undefined) return free;
    const slot = nextSlot++;
    if (slot >= pages.length * PAGE_LAYERS) {
      pages.push({ wide: pageTexture(gl, gl.RGBA16UI), narrow: pageTexture(gl, gl.RGBA8UI) });
    }
    return slot;
  };

  /**
   * Interleaves one chunk's planes into its page layer with two uploads. Each block's frame-selected option is
   * resolved on the CPU (as `renderChunk` does, so the GPU output is exact); new variant colours are uploaded too.
   */
  const uploadChunk = (source: RenderableWorld, chunk: ChunkCoord, slot: number): void => {
    const originX = chunk.x * CHUNK_SIZE;
    const originY = chunk.y * CHUNK_SIZE;
    const columns = Math.min(CHUNK_SIZE, source.width - originX);
    const rows = Math.min(CHUNK_SIZE, source.height - originY);
    const { block, wall, liquid, liquidAmount, paint, wallPaint, frameX, frameY, flags } = source.planes;
    const framed = mapPalette?.tileOptions !== undefined && (frameX !== undefined || frameY !== undefined);
    const paletteLength = source.palette.length;
    const firstNewVariant = variantCount;
    for (let column = 0; column < columns; column++) {
      const from = (originX + column) * source.height + originY;
      const to = column * CHUNK_SIZE * 4;
      for (let row = 0; row < rows; row++) {
        const index = from + row;
        const texel = to + row * 4;
        const blockId = block[index] ?? ABSENT;
        wideStaging[texel] = blockId;
        wideStaging[texel + 1] = wall[index] ?? ABSENT;
        wideStaging[texel + 2] = framed && blockId < paletteLength
          ? variantOf(blockId, frameX?.[index] ?? 0, frameY?.[index] ?? 0, source.palette)
          : 0;
        wideStaging[texel + 3] = (flags?.[index] ?? 0) & WIRE_LAYER.all;
        narrowStaging[texel] = liquid[index] ?? 0;
        narrowStaging[texel + 1] = liquidAmount[index] ?? 0;
        narrowStaging[texel + 2] = paint[index] ?? 0;
        narrowStaging[texel + 3] = wallPaint[index] ?? 0;
      }
    }
    if (variantCount > firstNewVariant) {
      const firstRow = Math.floor(firstNewVariant / PALETTE_ROW);
      const lastRow = Math.floor((variantCount - 1) / PALETTE_ROW);
      gl.activeTexture(gl.TEXTURE0 + UNIT_VARIANTS);
      gl.bindTexture(gl.TEXTURE_2D, resources.variantColors);
      gl.texSubImage2D(
        gl.TEXTURE_2D, 0, 0, firstRow, PALETTE_ROW, lastRow - firstRow + 1, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE,
        variantMirror.subarray(firstRow * PALETTE_ROW * 4),
      );
    }
    const page = pages[Math.floor(slot / PAGE_LAYERS)];
    if (page === undefined) throw new Error(`chunk slot ${String(slot)} has no page`);
    const layer = slot % PAGE_LAYERS;
    // Texture width is the chunk's rows (y), height its columns (x); rows past the edge keep stale texels the
    // shaders never read.
    gl.activeTexture(gl.TEXTURE0 + UNIT_WIDE);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.wide);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, CHUNK_SIZE, columns, 1, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, wideStaging,
    );
    gl.activeTexture(gl.TEXTURE0 + UNIT_NARROW);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.narrow);
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, CHUNK_SIZE, columns, 1, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, narrowStaging,
    );
    textureUploads++;
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
    overview = { world: source, texture, factor, width, height, built: new Uint8Array(chunksX * chunksY), builtCount: 0 };
    // Storage starts zeroed but its mip chain is incomplete until generated.
    gl.generateMipmap(gl.TEXTURE_2D);
    return overview;
  };

  /** Uniforms of the tile colour function shared by both chunk passes. */
  const setTileUniforms = (uniforms: Readonly<Record<(typeof TILE_UNIFORMS)[number], WebGLUniformLocation>>): void => {
    gl.uniform1i(uniforms.uWide, UNIT_WIDE);
    gl.uniform1i(uniforms.uNarrow, UNIT_NARROW);
    gl.uniform1i(uniforms.uPalette, UNIT_PALETTE);
    gl.uniform1i(uniforms.uBackground, UNIT_BACKGROUND);
    gl.uniform1i(uniforms.uVariantColors, UNIT_VARIANTS);
    gl.uniform1i(uniforms.uPaletteLength, paletteUploaded);
    gl.uniform1i(uniforms.uLayers, layers);
    gl.uniform3iv(uniforms.uWireColors, wireColorUniform);
    gl.uniform1iv(uniforms.uWireBits, wireBitUniform);
    gl.uniform1i(uniforms.uWireAlpha, WIRE_ALPHA);
    gl.uniform3iv(uniforms.uLiquids, liquidUniform);
    gl.uniform1i(uniforms.uPaintRow, background?.paintRow ?? 0);
    gl.uniform1i(uniforms.uPaintCount, paintCount);
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
        slot % PAGE_LAYERS,
      ], index * INSTANCE_INTS);
    });
    gl.bindVertexArray(resources.instanceArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, resources.instances);
    gl.bufferData(gl.ARRAY_BUFFER, instanceData.subarray(0, sorted.length * INSTANCE_INTS), gl.STREAM_DRAW);
    const stride = INSTANCE_INTS * 4;
    let calls = 0;
    let start = 0;
    while (start < sorted.length) {
      const pageIndex = Math.floor((sorted[start]?.[1] ?? 0) / PAGE_LAYERS);
      let end = start + 1;
      while (end < sorted.length && Math.floor((sorted[end]?.[1] ?? 0) / PAGE_LAYERS) === pageIndex) end++;
      const page = pages[pageIndex];
      if (page !== undefined) {
        gl.activeTexture(gl.TEXTURE0 + UNIT_WIDE);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.wide);
        gl.activeTexture(gl.TEXTURE0 + UNIT_NARROW);
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, page.narrow);
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

  /** The visible chunks followed by those within the overview's filter footprint around the viewport. */
  const overviewFootprint = (source: RenderableWorld, visible: readonly ChunkCoord[], viewport: Size): ChunkCoord[] => {
    const margin = Math.ceil(4 / camera.zoom);
    const around = visibleChunks(
      { x: camera.x - margin, y: camera.y - margin, zoom: camera.zoom },
      { width: viewport.width + 2 * margin * camera.zoom, height: viewport.height + 2 * margin * camera.zoom },
      source,
    );
    const chunksX = Math.ceil(source.width / CHUNK_SIZE);
    const inView = new Set(visible.map((chunk) => chunk.y * chunksX + chunk.x));
    return [...visible, ...around.filter((chunk) => !inView.has(chunk.y * chunksX + chunk.x))];
  };

  const drawFrame = (uploadBudget: number): void => {
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
    // Set by acquire() when a wanted chunk did not fit the upload budget.
    const loading = { pending: false };
    /** Evicts least recently used chunks outside `keep` until `count` uploads fit the cache. */
    const makeRoom = (count: number, keep: ReadonlySet<number>): void => {
      for (const [key, slot] of chunks) {
        if (chunks.size + count <= cacheCapacity) break;
        if (keep.has(key)) continue;
        chunks.delete(key);
        freeSlots.push(slot);
        evictedChunks++;
      }
    };
    /** Makes `wanted` resident (uploads within `budget`), appending the resident ones to `out`; returns the budget left. */
    const acquire = (wanted: readonly ChunkCoord[], budget: number, out: (readonly [ChunkCoord, number])[]): number => {
      let missing = 0;
      for (const chunk of wanted) if (!chunks.has(keyOf(chunk))) missing++;
      // Reserve only for this call's uploads, so reversing a pending pan keeps terrain not yet replaced.
      makeRoom(Math.min(missing, budget), new Set(wanted.map(keyOf)));
      let left = budget;
      for (const chunk of wanted) {
        const key = keyOf(chunk);
        let slot = chunks.get(key);
        if (slot === undefined) {
          if (left <= 0) {
            loading.pending = true;
            continue;
          }
          left--;
          slot = allocateSlot();
          uploadChunk(source, chunk, slot);
        } else {
          chunks.delete(key);
        }
        chunks.set(key, slot);
        out.push([chunk, slot]);
      }
      return left;
    };

    const ready: (readonly [ChunkCoord, number])[] = [];
    if (target === null) {
      // At 1 / factor pixels per tile and above the visible set is bounded by the viewport, so the cache grows to
      // hold it; visible residents survive while the remaining chunks load.
      cacheCapacity = Math.max(cacheCapacity, visible.length);
      acquire(visible, uploadBudget, ready);
    } else {
      // A chunk is needed only until its overview texels are built, so the cache does not grow: unbuilt chunks of
      // the filter footprint (visible ones first) are built in batches that fit it.
      const needed = overviewFootprint(source, visible, viewport).filter((chunk) => target.built[keyOf(chunk)] === 0);
      let budget = uploadBudget;
      for (let start = 0; start < needed.length; start += cacheCapacity) {
        const batch: (readonly [ChunkCoord, number])[] = [];
        budget = acquire(needed.slice(start, start + cacheCapacity), budget, batch);
        buildOverview(source, target, batch);
      }
    }

    gl.viewport(0, 0, viewport.width, viewport.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (target === null) {
      // Chunks still loading show the overview (built when the area was seen zoomed out) instead of a hole; drawn
      // chunks overwrite it completely, so a complete frame stays exact.
      if (loading.pending && candidate !== null && candidate.builtCount > 0) drawCalls += drawOverview(source, candidate);
      const { chunk: program } = resources;
      gl.useProgram(program.program);
      setTileUniforms(program.uniforms);
      gl.uniform2f(program.uniforms.uCamera, camera.x, camera.y);
      gl.uniform1f(program.uniforms.uZoom, camera.zoom);
      gl.uniform2f(program.uniforms.uViewport, viewport.width, viewport.height);
      gl.activeTexture(gl.TEXTURE0 + UNIT_PALETTE);
      gl.bindTexture(gl.TEXTURE_2D, resources.palette);
      gl.activeTexture(gl.TEXTURE0 + UNIT_BACKGROUND);
      gl.bindTexture(gl.TEXTURE_2D, background?.texture ?? null);
      gl.activeTexture(gl.TEXTURE0 + UNIT_VARIANTS);
      gl.bindTexture(gl.TEXTURE_2D, resources.variantColors);
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
      drawFrame(maxChunkUploadsPerFrame);
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
    resetVariants();
    background = null;
    overview = null;
    resources = createResources(gl);
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
        resetVariants();
        world = next;
      }
      schedule();
    },
    setCamera: (next) => {
      camera = next;
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
    render: () => { drawFrame(Infinity); },
    stats: () => ({ textureUploads, drawCalls, visibleChunks: drawn, residentChunks: chunks.size, evictedChunks }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (!gl.isContextLost()) {
        clearChunks();
        releaseOverview();
        for (const program of [resources.chunk, resources.build, resources.overview]) gl.deleteProgram(program.program);
        gl.deleteTexture(resources.palette);
        gl.deleteTexture(resources.variantColors);
        gl.deleteBuffer(resources.instances);
        gl.deleteVertexArray(resources.instanceArray);
        gl.deleteVertexArray(resources.emptyArray);
        gl.deleteFramebuffer(resources.framebuffer);
      }
      releaseBackground();
    },
  };
}
