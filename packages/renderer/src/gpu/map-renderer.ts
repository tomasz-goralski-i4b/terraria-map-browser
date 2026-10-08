// The WebGL2 backend draws into a DOM canvas; the DOM types are declared here, where they are used, so the rest of
// the package keeps the DOM-free lib of the base config.
/// <reference lib="dom" />

import type { ContentRef } from "@studio/world-model";
import { CHUNK_SIZE, visibleChunks } from "../camera/camera.js";
import type { Camera, ChunkCoord } from "../camera/camera.js";
import type { ChunkLayers } from "../chunk/render.js";
import { backgroundColor, contentColor, liquidColors } from "../palette/map-palette.js";
import type { MapPalette } from "../palette/map-palette.js";
import { fragmentSource, vertexSource } from "./shaders.js";

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
   * Baseline chunk texture cache capacity (LRU). Default 1536, enough for a whole Large world.
   * Each frame grows the capacity to fit its visible chunks and releases excess offscreen chunks when it shrinks.
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
  /** Draw calls issued by the last synchronous or scheduled frame. */
  readonly drawCalls: number;
  /** Chunks drawn by the last synchronous or scheduled frame. */
  readonly visibleChunks: readonly ChunkCoord[];
  /** Chunk textures currently held by the cache. */
  readonly residentChunks: number;
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
const DEFAULT_MAX_CACHED_CHUNKS = 1536;
const DEFAULT_MAX_CHUNK_UPLOADS_PER_FRAME = 32;
const UNIFORM_NAMES = [
  "uBlock", "uWall", "uLiquid", "uAmount", "uPaint", "uWallPaint", "uPalette", "uBackground", "uCamera", "uZoom",
  "uViewport", "uOrigin", "uSize", "uPaletteLength", "uLayers", "uLiquids", "uPaintRow", "uPaintCount",
] as const;
type UniformName = (typeof UNIFORM_NAMES)[number];

interface ChunkTextures {
  readonly block: WebGLTexture;
  readonly wall: WebGLTexture;
  readonly liquid: WebGLTexture;
  readonly amount: WebGLTexture;
  readonly paint: WebGLTexture;
  readonly wallPaint: WebGLTexture;
}

/** Everything owned by one GL context; rebuilt after a context loss. */
interface GpuResources {
  readonly program: WebGLProgram;
  readonly uniforms: Readonly<Record<UniformName, WebGLUniformLocation>>;
  readonly palette: WebGLTexture;
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

function integerTexture(gl: WebGL2RenderingContext, format: number, width: number, height: number): WebGLTexture {
  const texture = requireValue(gl.createTexture(), "a texture");
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texStorage2D(gl.TEXTURE_2D, 1, format, width, height);
  // Integer textures are incomplete unless they use NEAREST filtering.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  return texture;
}

function createResources(gl: WebGL2RenderingContext): GpuResources {
  const program = requireValue(gl.createProgram(), "a program");
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!(gl.getProgramParameter(program, gl.LINK_STATUS) as boolean)) {
    throw new Error(`Shader link failed: ${gl.getProgramInfoLog(program) ?? "unknown error"}`);
  }
  const uniforms = Object.fromEntries(
    UNIFORM_NAMES.map((name) => [name, requireValue(gl.getUniformLocation(program, name), `uniform ${name}`)]),
  ) as Record<UniformName, WebGLUniformLocation>;
  return { program, uniforms, palette: integerTexture(gl, gl.RGBA8UI, PALETTE_WIDTH, PALETTE_HEIGHT) };
}

function layerBits(layers: ChunkLayers): number {
  return (layers.background ? 1 : 0) | (layers.walls ? 2 : 0) | (layers.blocks ? 4 : 0) | (layers.liquids ? 8 : 0);
}

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

  // Looked up once: getExtension returns null while the context is lost. Used only to restore a forced loss.
  const loseContext = gl.getExtension("WEBGL_lose_context");
  let resources = createResources(gl);
  let world: RenderableWorld | null = null;
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let layers = 15;
  // LRU: Map iteration order is insertion order, and a hit re-inserts its key at the end.
  const chunks = new Map<number, ChunkTextures>();
  const paletteMirror = new Uint8Array(PALETTE_WIDTH * PALETTE_HEIGHT * 4);
  let paletteUploaded = 0;
  // Per-row background colours plus the paint row, for the world they were computed for.
  let background: { readonly texture: WebGLTexture; readonly world: RenderableWorld; readonly paintRow: number } | null = null;
  const paintCount = mapPalette === undefined ? 0 : Math.min(PALETTE_ROW, mapPalette.paints.length);
  let textureUploads = 0;
  let drawCalls = 0;
  let drawn: readonly ChunkCoord[] = [];
  let frame = 0;
  let disposed = false;

  const deleteChunk = (textures: ChunkTextures): void => {
    gl.deleteTexture(textures.block);
    gl.deleteTexture(textures.wall);
    gl.deleteTexture(textures.liquid);
    gl.deleteTexture(textures.amount);
    gl.deleteTexture(textures.paint);
    gl.deleteTexture(textures.wallPaint);
  };

  const clearChunks = (): void => {
    for (const textures of chunks.values()) deleteChunk(textures);
    chunks.clear();
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
    gl.activeTexture(gl.TEXTURE6);
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
    paletteUploaded = total;
  };

  /** Uploads one chunk straight from the column-major planes: a plane row is one world column. */
  const uploadChunk = (source: RenderableWorld, chunk: ChunkCoord): ChunkTextures => {
    const originX = chunk.x * CHUNK_SIZE;
    const originY = chunk.y * CHUNK_SIZE;
    const columns = Math.min(CHUNK_SIZE, source.width - originX);
    const rows = Math.min(CHUNK_SIZE, source.height - originY);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, source.height);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, originY);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, originX);
    gl.activeTexture(gl.TEXTURE0);
    const plane = (format: number, type: number, data: Uint8Array | Uint16Array): WebGLTexture => {
      const texture = integerTexture(gl, format, rows, columns);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, rows, columns, gl.RED_INTEGER, type, data);
      return texture;
    };
    const textures: ChunkTextures = {
      block: plane(gl.R16UI, gl.UNSIGNED_SHORT, source.planes.block),
      wall: plane(gl.R16UI, gl.UNSIGNED_SHORT, source.planes.wall),
      liquid: plane(gl.R8UI, gl.UNSIGNED_BYTE, source.planes.liquid),
      amount: plane(gl.R8UI, gl.UNSIGNED_BYTE, source.planes.liquidAmount),
      paint: plane(gl.R8UI, gl.UNSIGNED_BYTE, source.planes.paint),
      wallPaint: plane(gl.R8UI, gl.UNSIGNED_BYTE, source.planes.wallPaint),
    };
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    textureUploads++;
    return textures;
  };

  /**
   * Background colour of every world row, resolved on the CPU by the same `backgroundColor` as `renderChunk` (so the
   * GPU output is exact), 256 rows per texture row; the last texture row holds the paint colours by paint ID.
   */
  /** Drops the background of the previous world: its texture and the reference that would keep its planes alive. */
  const releaseBackground = (): void => {
    if (background !== null && !gl.isContextLost()) gl.deleteTexture(background.texture);
    background = null;
  };

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
    const texture = integerTexture(gl, gl.RGBA8UI, PALETTE_ROW, paintRow + 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PALETTE_ROW, paintRow + 1, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, texels);
    textureUploads++;
    background = { texture, world: source, paintRow };
  };

  const chunkTextures = (source: RenderableWorld, chunk: ChunkCoord, chunksX: number): ChunkTextures => {
    const key = chunk.y * chunksX + chunk.x;
    let textures = chunks.get(key);
    if (textures !== undefined) {
      chunks.delete(key);
    } else {
      textures = uploadChunk(source, chunk);
    }
    chunks.set(key, textures);
    return textures;
  };

  const drawFrame = (uploadBudget: number): void => {
    if (disposed || gl.isContextLost()) return;
    const viewport = { width: canvas.width, height: canvas.height };
    gl.viewport(0, 0, viewport.width, viewport.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    drawCalls = 0;
    drawn = [];
    if (world === null) return;

    uploadPalette(world.palette);
    gl.activeTexture(gl.TEXTURE7);
    uploadBackground(world);
    const { uniforms } = resources;
    gl.useProgram(resources.program);
    // Units 0–5: the chunk planes; 6: palette; 7: background and paint colours.
    gl.uniform1i(uniforms.uBlock, 0);
    gl.uniform1i(uniforms.uWall, 1);
    gl.uniform1i(uniforms.uLiquid, 2);
    gl.uniform1i(uniforms.uAmount, 3);
    gl.uniform1i(uniforms.uPaint, 4);
    gl.uniform1i(uniforms.uWallPaint, 5);
    gl.uniform1i(uniforms.uPalette, 6);
    gl.uniform1i(uniforms.uBackground, 7);
    gl.uniform2f(uniforms.uCamera, camera.x, camera.y);
    gl.uniform1f(uniforms.uZoom, camera.zoom);
    gl.uniform2f(uniforms.uViewport, viewport.width, viewport.height);
    gl.uniform1i(uniforms.uPaletteLength, paletteUploaded);
    gl.uniform1i(uniforms.uLayers, layers);
    gl.uniform3iv(uniforms.uLiquids, liquidUniform);
    gl.uniform1i(uniforms.uPaintRow, background?.paintRow ?? 0);
    gl.uniform1i(uniforms.uPaintCount, paintCount);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, resources.palette);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, background?.texture ?? null);

    const chunksX = Math.ceil(world.width / CHUNK_SIZE);
    const visible = visibleChunks(camera, viewport, world);
    const visibleKeys = new Set(visible.map((chunk) => chunk.y * chunksX + chunk.x));
    const capacity = Math.max(maxCachedChunks, visible.length);
    let missing = 0;
    for (const key of visibleKeys) if (!chunks.has(key)) missing++;
    // Reserve room for the entire view before uploading. Evict only offscreen LRU entries so panning cannot
    // discard visible chunks that later frames need, even when the view fills the adaptive capacity.
    for (const [key, textures] of chunks) {
      if (chunks.size + missing <= capacity) break;
      if (visibleKeys.has(key)) continue;
      deleteChunk(textures);
      chunks.delete(key);
    }
    const drawnChunks: ChunkCoord[] = [];
    let uploads = 0;
    let pending = false;
    for (const chunk of visible) {
      if (!chunks.has(chunk.y * chunksX + chunk.x)) {
        if (uploads >= uploadBudget) {
          pending = true;
          continue;
        }
        uploads++;
      }
      const textures = chunkTextures(world, chunk, chunksX);
      [textures.block, textures.wall, textures.liquid, textures.amount, textures.paint, textures.wallPaint].forEach((texture, unit) => {
        gl.activeTexture(gl.TEXTURE0 + unit);
        gl.bindTexture(gl.TEXTURE_2D, texture);
      });
      const originX = chunk.x * CHUNK_SIZE;
      const originY = chunk.y * CHUNK_SIZE;
      gl.uniform2i(uniforms.uOrigin, originX, originY);
      gl.uniform2i(uniforms.uSize, Math.min(CHUNK_SIZE, world.width - originX), Math.min(CHUNK_SIZE, world.height - originY));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      drawCalls++;
      drawnChunks.push(chunk);
    }
    drawn = drawnChunks;
    if (pending) schedule();
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
    chunks.clear();
    paletteUploaded = 0;
    background = null;
    resources = createResources(gl);
    schedule();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  return {
    setWorld: (next) => {
      if (next !== world) {
        clearChunks();
        releaseBackground();
        paletteUploaded = 0;
        world = next;
      }
      schedule();
    },
    setCamera: (next) => {
      camera = next;
      schedule();
    },
    setLayers: (next) => {
      layers = layerBits(next);
      schedule();
    },
    tileAt: (screenX, screenY) => {
      if (world === null || screenX < 0 || screenY < 0 || screenX >= canvas.width || screenY >= canvas.height) return null;
      const x = Math.floor(camera.x + screenX / camera.zoom);
      const y = Math.floor(camera.y + screenY / camera.zoom);
      return x < 0 || y < 0 || x >= world.width || y >= world.height ? null : { x, y };
    },
    render: () => { drawFrame(Infinity); },
    stats: () => ({ textureUploads, drawCalls, visibleChunks: drawn, residentChunks: chunks.size }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      if (!gl.isContextLost()) {
        clearChunks();
        gl.deleteTexture(resources.palette);
        gl.deleteProgram(resources.program);
      }
      releaseBackground();
    },
  };
}
