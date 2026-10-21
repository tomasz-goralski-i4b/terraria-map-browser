// The WebGL2 backend: the frame policy (what to upload when, within which budget; which passes draw; reusing the last
// frame) over the parts that own the GL objects. Every part follows GpuPart: `lost` after a context loss, `release` on
// dispose. The DOM types are declared here, where they are used, so the rest of the package keeps the DOM-free lib of
// the base config.
/// <reference lib="dom" />

import { CHUNK_SIZE, visibleChunks } from "../camera/camera.js";
import type { Camera, ChunkCoord } from "../camera/camera.js";
import { filterTilesPerPixel } from "../chunk/box-filter.js";
import type { MapHighlight } from "../chunk/highlight.js";
import { WIRE_LAYER, type ChunkLayers } from "../chunk/render.js";
import type { BlockFraming } from "../framing/frame-block.js";
import type { MapPalette } from "../palette/map-palette.js";
import { createBackgroundProgram } from "./background-program.js";
import { createChunkStore, CHUNKS_PER_PAGE, type Resident } from "./chunk-store.js";
import { createFrameTargets } from "./frame-targets.js";
import {
  TEXTURE_UNITS, UNIT, createProgramCache, createUnpackState, type Counters, type GpuPart, type ProgramSource,
} from "./gl.js";
import { byDistance, chunkGrid, chunksAround, union, type Area } from "./chunk-grid.js";
import { createHighlightPass } from "./highlight-pass.js";
import { createIdleTask } from "./idle-task.js";
import { OVERLAY_UNIFORMS, TILE_UNIFORMS, createMapColors, setWireUniforms } from "./map-colors.js";
import { LIQUIDS_LAYER, OBJECT_LAYERS, createObjectPass } from "./object-pass.js";
import { BUILD_PROGRAM, DRAW_PROGRAM, createOverviewPart, overviewFactor } from "./overview.js";
import { createAnnotationPass, createGridPass } from "./overlay-passes.js";
import {
  PAGE_APRON, PAINT_LAYER_BIT, PLANE_COUNT_16, PLANE_COUNT_8, PRESENT, SPRITE_MIN_ZOOM, chunkFragmentSource,
  chunkSpriteFragmentSource, chunkVertexSource,
} from "./shaders.js";
import { PAINT_GROUP_UNIFORMS, SAMPLING_UNIFORMS, createSpriteAtlas, setPaintGroups } from "./sprite-atlas.js";
import type { FrameView, MapAnnotations, MapGrid, RenderableWorld, SpriteAtlasSource } from "./types.js";
import { createWirePass } from "./wire-pass.js";

export type { MapAnnotations, MapGrid, RenderableWorld, SpriteAtlasSource, SpriteSheetEntry } from "./types.js";

export interface MapRendererOptions {
  /** Observes completed draws without scheduling extra work; mode is the path actually drawn. */
  readonly onFrame?: (frame: MapFrameObservation) => void;
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
  /**
   * Colour of the content highlight's outlines and tints (`setHighlight`), RGB 0–255. Default `DEFAULT_HIGHLIGHT_COLOR`
   * ([255, 214, 64], a warm yellow that reads over sky, dirt, stone and dark caves). Throws a RangeError when invalid.
   */
  readonly highlightColor?: readonly [number, number, number];
  /**
   * Opacity (0–1) of the black layer the highlight lays over tiles that do not match, when dimming. Default
   * `DEFAULT_HIGHLIGHT_DIM` (0.6). Throws a RangeError when invalid.
   */
  readonly highlightDim?: number;
}

export interface MapFrameObservation {
  readonly mode: "overview" | "chunks" | "sprites";
  readonly zoom: number;
  readonly uploads: number;
  readonly residentChunks: number;
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
  /**
   * Uploads of the content highlight since creation: one per lookup of a new highlight (64 KiB), one per batch of its
   * overview mask (an idle slice, or an edit's patch). They never count as `textureUploads`.
   */
  readonly highlightUploads: number;
  /**
   * Uploads of the object pass's instances since creation: one when a frame draws other chunks than the last upload,
   * or one of their object lists was collected again. Drawing the same chunks again uploads nothing.
   */
  readonly objectUploads: number;
  /** Chunk object lists the object pass collected since creation: once per chunk, again after an edit within one chunk of it. */
  readonly objectChunksCollected: number;
  /** Whether the highlight's overview mask is still being built in idle slices. */
  readonly highlightBuilding: boolean;
}

export interface MapRenderer {
  readonly setWorld: (world: RenderableWorld | null) => void;
  /** The viewport is the canvas backing store (`canvas.width` × `canvas.height`). */
  readonly setCamera: (camera: Camera) => void;
  readonly setLayers: (layers: ChunkLayers) => void;
  /**
   * GPU overlay composed while presenting the existing frame cache; null disables it. Dashed block lines from 6 CSS
   * pixels per tile, solid interval lines while they are 8 CSS pixels apart; none over the zoomed-out overview.
   */
  readonly setGrid: (grid: MapGrid | null) => void;
  /**
   * Highlights the tiles holding any of the given blocks, walls or liquids (`MapHighlight`); null removes the pass.
   * From one pixel per tile up an overlay pass over the presented frame outlines the matches (tints them below
   * HIGHLIGHT_OUTLINE_ZOOM) and dims the rest; zoomed out it draws a match mask built from the planes in idle slices.
   * Never uploads chunk textures and never invalidates the frame cache; the same contents again are a no-op. Throws a
   * RangeError for an index outside 0–65534 or a liquid kind outside 1–4.
   */
  readonly setHighlight: (highlight: MapHighlight | null) => void;
  /** Vector notes drawn after cached terrain; null disables the pass. */
  readonly setAnnotations: (annotations: MapAnnotations | null) => void;
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

const DEFAULT_MAX_CACHED_CHUNKS = 512;
const DEFAULT_PREFETCH_CHUNKS = 1;
/** An idle prefetch step stops uploading once less than this much of its idle period is left (milliseconds). */
const PREFETCH_IDLE_RESERVE = 3;
const DEFAULT_MAX_CHUNK_UPLOADS_PER_FRAME = 256;
const DEFAULT_MAX_UPLOAD_MILLISECONDS_PER_FRAME = 8;

const CHUNK_PASS_UNIFORMS = [...TILE_UNIFORMS, "uCamera", "uZoom", "uViewport", "uFilter", "uStep", "uWorldSize"] as const;
/** The chunk pass in map colours, with the wire overlay. */
const CHUNK_PROGRAM: ProgramSource<(typeof CHUNK_PASS_UNIFORMS)[number] | (typeof OVERLAY_UNIFORMS)[number]> = {
  vertex: chunkVertexSource, fragment: chunkFragmentSource, uniforms: [...CHUNK_PASS_UNIFORMS, ...OVERLAY_UNIFORMS],
};
/** The chunk pass in sprite mode (chunkSpriteFragmentSource): sprites and framed cells; the wire pass draws wires. */
const SPRITE_CHUNK_PROGRAM: ProgramSource<
  (typeof CHUNK_PASS_UNIFORMS)[number] | (typeof SAMPLING_UNIFORMS)[number] | (typeof PAINT_GROUP_UNIFORMS)[number]
  | "uSpriteSheets" | "uLiquidSheets" | "uLiquidOverlay" | "uSurfaceY" | "uWallGlow"
> = {
  vertex: chunkVertexSource, fragment: chunkSpriteFragmentSource,
  uniforms: [
    ...CHUNK_PASS_UNIFORMS, ...SAMPLING_UNIFORMS, ...PAINT_GROUP_UNIFORMS, "uSpriteSheets", "uLiquidSheets", "uLiquidOverlay", "uSurfaceY",
    "uWallGlow",
  ],
};

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

function layerBits(layers: ChunkLayers): number {
  return (layers.background ? 1 : 0) | (layers.walls ? 2 : 0) | (layers.blocks ? 4 : 0) | (layers.liquids ? 8 : 0)
    | (((layers.wires ?? 0) & WIRE_LAYER.all) << 4) | (layers.paint === false ? 0 : PAINT_LAYER_BIT);
}

export function createMapRenderer(canvas: HTMLCanvasElement, options?: MapRendererOptions): MapRenderer {
  // Straight (non-premultiplied) alpha: the shader writes the same RGBA that `renderChunk` produces. No multisampling:
  // it would blend a pixel the edge of a chunk quad crosses (the world's edge at a sub-tile camera) by coverage.
  // A stencil bit marks the object pass's pixels for the liquid overlay pass (sprite mode).
  const context = canvas.getContext("webgl2", { premultipliedAlpha: false, antialias: false, stencil: true });
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
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  checkLimits(gl);
  // Looked up once: getExtension returns null while the context is lost. Used only to restore a forced loss.
  const loseContext = gl.getExtension("WEBGL_lose_context");

  let world: RenderableWorld | null = null;
  let camera: Camera = { x: 0, y: 0, zoom: 1 };
  let layers = 15;
  let atlasSource: SpriteAtlasSource | null = null;
  let spriteMode = false;
  let framing: BlockFraming | null = null;
  let disposed = false;
  // The pending animation frame; 0 when none is pending.
  let frame = 0;

  const schedule = (): void => {
    if (frame !== 0 || disposed) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      drawFrame(maxChunkUploadsPerFrame, maxUploadMillisecondsPerFrame, false);
    });
  };

  const counters: Counters = { textureUploads: 0 };
  const unpack = createUnpackState(gl);
  const programs = createProgramCache(gl);
  const store = createChunkStore(gl, unpack, counters, maxCachedChunks);
  const colors = createMapColors(gl, unpack, counters, options?.mapPalette);
  const atlas = createSpriteAtlas(gl, unpack, programs);
  const overviews = createOverviewPart(gl, programs, colors, store);
  // Linked when an atlas is set or on the first sprite frame: map mode and the overview never compile the sprite code,
  // which would make every map-only renderer compile about twice as long. While it links, frames show map colours.
  const spriteProgram = createBackgroundProgram(gl, SPRITE_CHUNK_PROGRAM, options?.onSpritesPreparing, () => {
    if (!disposed) schedule();
  });
  const objects = createObjectPass(gl, programs, atlas);
  const wires = createWirePass(gl, programs, atlas, store);
  const highlight = createHighlightPass(
    gl, programs, unpack, store, options, (source) => overviewFactor(source, maxTextureSize),
    // The mask is drawn below one pixel per tile: show the columns built so far.
    () => { if (!disposed && camera.zoom < 1) schedule(); },
  );
  const grid = createGridPass(gl, programs);
  const annotations = createAnnotationPass(gl, programs);
  const frames = createFrameTargets(gl);
  const parts: readonly GpuPart[] = [unpack, programs, store, colors, atlas, overviews, spriteProgram, objects, wires, highlight, annotations, frames];
  /** Links the map programs every renderer draws with at once, so a broken one fails here rather than in a frame. */
  const linkMapPrograms = (): void => {
    for (const source of [CHUNK_PROGRAM, BUILD_PROGRAM, DRAW_PROGRAM]) programs.get(source);
  };
  linkMapPrograms();

  // The last scheduled frame, if it is complete and can be reused: its snapped camera in screen pixels and what else
  // it depends on. Any other change (frameVersion), an upload in the frame, or another zoom or size draws it in full.
  let lastFrame: {
    readonly pixelX: number; readonly pixelY: number; readonly zoom: number; readonly sprites: boolean;
    readonly version: number; readonly width: number; readonly height: number;
  } | null = null;
  // Bumped by every change but the camera's.
  let frameVersion = 0;
  let reusedFrames = 0;
  let drawCalls = 0;
  let drawn: readonly ChunkCoord[] = [];

  /** Uploads the palette entries appended since the last frame, with their sprite sheets. */
  const uploadPalette = (source: RenderableWorld): void => {
    const [from, to] = colors.upload(source.palette);
    if (to <= from) return;
    if (atlasSource !== null) atlas.uploadSheets(source.palette, from, to);
    // Content colours the overview already holds may have been absent (out of range) before this append.
    overviews.existing(source)?.invalidateAll();
  };

  /** Puts `source` on the GPU and rewrites the sheet of every palette index uploaded so far. */
  const applyAtlas = (source: SpriteAtlasSource | null): void => {
    atlas.apply(source, world?.palette ?? [], world === null ? 0 : colors.uploaded());
    objects.clear();
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
    // The camera this frame draws with. Scheduled frames from one pixel per tile up snap it to whole screen pixels, so
    // the frames of a pan differ by whole pixels and the previous frame can be reused shifted.
    const view: Camera = scheduled
      ? { x: Math.round(camera.x * camera.zoom) / camera.zoom, y: Math.round(camera.y * camera.zoom) / camera.zoom, zoom: camera.zoom }
      : camera;
    const frameView: FrameView = { source, x: view.x, y: view.y, zoom: view.zoom, ...viewport, layers };
    // Uploads within this frame change what resident chunks show (prefetched chunks lie outside the view).
    const uploadsAtStart = counters.textureUploads + atlas.uploads();

    uploadPalette(source);
    colors.uploadBackground(source);
    // Below one pixel per overview texel, the overview stands in for the chunks.
    const candidate = overviews.of(source);
    const target = candidate !== null && camera.zoom < 1 / candidate.factor ? candidate : null;

    const { keyOf } = chunkGrid(source);
    const visible = visibleChunks(view, viewport, source);
    const spriteZoom = spriteMode && atlas.ready() && camera.zoom >= SPRITE_MIN_ZOOM;
    // Until the sprite program is linked, frames are drawn in map colours.
    const spriteChunk = spriteZoom ? spriteProgram.get(wait) : null;
    const sprites = spriteChunk !== null;
    // Self-framed blocks draw their cells: a chunk is framed on its first upload at a sprite zoom, never below one.
    const framed = sprites && target === null && framing !== null;
    // Set when a wanted chunk did not fit the upload budget.
    let pending = false;
    const deadline = Number.isFinite(uploadMilliseconds) ? performance.now() + uploadMilliseconds : Infinity;
    let uploads = 0;
    /** Whether this frame may upload one more chunk: within the count, and within the time once one was uploaded. */
    const mayUpload = (): boolean =>
      uploads < uploadBudget && (uploads === 0 || deadline === Infinity || performance.now() < deadline);
    /**
     * Uploads `chunk` into a free slot. When the cache is full it evicts the least recently used chunk outside
     * `spare` if there is one, else outside `keep`.
     */
    const upload = (chunk: ChunkCoord, keep: ReadonlySet<number>, spare: ReadonlySet<number> = keep): number => {
      store.makeRoom(1, spare);
      store.makeRoom(1, keep);
      uploads++;
      return store.insert(chunk, keyOf(chunk));
    };
    /**
     * Uploads the changed part of a resident chunk whose planes changed (invalidateTiles) again, into its own slot, and
     * of its cells if the slot holds them. False when the frame's budget is spent: the chunk keeps drawing what it held.
     */
    const refresh = (chunk: ChunkCoord, slot: number): boolean => {
      const key = keyOf(chunk);
      if (!store.isDirty(key)) return true;
      if (!mayUpload()) {
        pending = true;
        return false;
      }
      uploads++;
      store.refresh(chunk, key, slot);
      return true;
    };

    const ready: Resident[] = [];
    if (target === null) {
      // At 1 / factor pixels per tile and above the visible set is bounded by the viewport, so the cache grows to
      // hold it; visible residents survive while the remaining chunks load.
      store.grow(visible.length);
      const keep = new Set(visible.map(keyOf));
      for (const chunk of visible) {
        const key = keyOf(chunk);
        let slot = store.slotOf(key);
        let uploaded: boolean;
        if (slot === undefined) {
          if (!mayUpload()) {
            pending = true;
            continue;
          }
          // Evict only for actual uploads, so reversing a pending pan keeps terrain not yet replaced.
          slot = upload(chunk, keep);
          uploaded = true;
        } else {
          store.use(key, slot);
          uploaded = store.isDirty(key) && refresh(chunk, slot);
        }
        if (framed && !store.isFramed(slot)) {
          // Framed with its upload; a resident chunk's cells are one more upload. Without its cells (the budget is
          // spent) the chunk still draws, its self-framed blocks in map colours (its instance lacks CELLS_INSTANCE_BIT).
          if (uploaded || mayUpload()) {
            if (!uploaded) uploads++;
            store.frame(chunk, slot);
          } else {
            pending = true;
          }
        }
        ready.push([chunk, slot]);
      }
    } else {
      // A chunk is needed only until its overview texels are built, so the cache does not grow: unbuilt chunks of
      // the filter footprint are built strictly in sweep order, in batches that fit it. The sweep stops at the first
      // chunk that does not fit the frame's budget, so no chunk (resident or not) is built ahead of the front.
      const needed = target.footprint(camera, visible, viewport).filter((chunk) => target.built[keyOf(chunk)] === 0);
      const neededKeys = new Set(needed.map(keyOf));
      const present = store.present();
      let batch: Resident[] = [];
      const batchKeys = new Set<number>();
      for (const chunk of needed) {
        const key = keyOf(chunk);
        let slot = store.slotOf(key);
        if (slot === undefined) {
          if (!mayUpload()) {
            pending = true;
            break;
          }
          // Evict chunks the sweep no longer needs first, then any but this batch's.
          slot = upload(chunk, batchKeys, neededKeys);
        } else {
          store.use(key, slot);
          if (!refresh(chunk, slot)) break;
        }
        batch.push([chunk, slot]);
        batchKeys.add(key);
        if (batch.length >= store.capacity()) {
          target.build(batch, layers, present);
          batch = [];
          batchKeys.clear();
        }
      }
      target.build(batch, layers, present);
    }

    /** The chunk pass, then in sprite mode the object, liquid overlay and wire passes, into the bound target. */
    // The liquid overlay pass's chunks, collected once per frame (by the first strip's object pass).
    let covered: Resident[] | null = null;
    const drawChunks = (): void => {
      // Chunks still loading show the overview (built when the area was seen zoomed out, possibly with other layers)
      // instead of a hole; drawn chunks overwrite it completely, so a complete frame stays exact.
      if (pending && candidate?.filled() === true) drawCalls += candidate.draw(frameView);
      // Sprites switch programs: crossing the threshold or toggling the mode uploads no planes and no atlas (only a
      // resident chunk's cells, once, on its first draw at a sprite zoom with a framing).
      const present = store.present();
      const setPassUniforms = (
        { program, uniforms }: { readonly program: WebGLProgram; readonly uniforms: Readonly<Record<(typeof CHUNK_PASS_UNIFORMS)[number], WebGLUniformLocation>> },
      ): void => {
        gl.useProgram(program);
        colors.setTileUniforms(uniforms, layers, present | (framed ? PRESENT.cells : 0));
        gl.uniform2f(uniforms.uCamera, view.x, view.y);
        gl.uniform1f(uniforms.uZoom, view.zoom);
        gl.uniform2f(uniforms.uViewport, viewport.width, viewport.height);
        // Below one pixel per tile a pixel averages the tiles under it (filterTiles) instead of point-sampling one.
        gl.uniform1i(uniforms.uFilter, view.zoom < 1 ? 1 : 0);
        gl.uniform1f(uniforms.uStep, filterTilesPerPixel(view.zoom));
        gl.uniform2i(uniforms.uWorldSize, source.width, source.height);
      };
      if (spriteChunk === null) {
        const map = programs.get(CHUNK_PROGRAM);
        setPassUniforms(map);
        setWireUniforms(gl, map.uniforms);
        drawCalls += store.draw(ready);
        return;
      }
      setPassUniforms(spriteChunk);
      const sprite = spriteChunk.uniforms;
      atlas.setSampling(sprite, camera.zoom);
      atlas.bindSheets();
      gl.uniform1i(sprite.uSpriteSheets, UNIT.spriteSheets);
      gl.uniform4iv(sprite.uLiquidSheets, atlas.liquidSheets());
      gl.uniform4iv(sprite.uWallGlow, atlas.place("wallGlow"));
      gl.uniform1i(sprite.uSurfaceY, source.surfaceY);
      setPaintGroups(gl, sprite);
      // In sprite mode the chunk pass writes the depth of the game's order (blockDepth in the shader) for the sprites
      // behind the blocks, and clears the stencil bit.
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.ALWAYS);
      gl.depthMask(true);
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.ALWAYS, 0, 1);
      gl.stencilOp(gl.REPLACE, gl.REPLACE, gl.REPLACE);
      drawCalls += store.draw(ready);
      // The objects (trees, track extras, waterfalls) over the chunks in that order, setting the stencil bit where they
      // draw; there the liquid overlay pass draws the liquids' front layer again (the game draws its liquids after every
      // tile); the wires over everything.
      gl.depthFunc(gl.LEQUAL);
      gl.stencilFunc(gl.ALWAYS, 1, 1);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      drawCalls += (layers & OBJECT_LAYERS) !== 0 ? objects.draw(frameView, visible) : 0;
      gl.disable(gl.DEPTH_TEST);
      covered ??= (layers & LIQUIDS_LAYER) !== 0 ? store.liquidItems(ready) : [];
      if (covered.length > 0) {
        gl.useProgram(spriteChunk.program);
        gl.uniform1i(sprite.uLiquidOverlay, 1);
        gl.stencilFunc(gl.EQUAL, 1, 1);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        gl.enable(gl.BLEND);
        gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
        drawCalls += store.draw(covered);
        gl.disable(gl.BLEND);
        gl.uniform1i(sprite.uLiquidOverlay, 0);
      }
      gl.disable(gl.STENCIL_TEST);
      drawCalls += wires.draw(frameView, ready, present);
    };

    const { width, height } = viewport;
    const gridShown = grid.visibility(view.zoom);
    if (target === null && (scheduled || gridShown.visible)) {
      // The previous frame shifted by whole pixels, when only the camera moved since (by less than the canvas).
      const pixelX = Math.round(view.x * view.zoom);
      const pixelY = Math.round(view.y * view.zoom);
      const previous = lastFrame;
      const shift = scheduled && previous !== null && !pending && previous.version === frameVersion
        && counters.textureUploads + atlas.uploads() === uploadsAtStart && previous.zoom === view.zoom && previous.sprites === sprites
        && previous.width === width && previous.height === height
        && Math.abs(pixelX - previous.pixelX) < width && Math.abs(pixelY - previous.pixelY) < height
        ? { x: pixelX - previous.pixelX, y: pixelY - previous.pixelY }
        : null;
      const last = frames.last();
      const output = frames.next(width, height);
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
          gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
          drawChunks();
        }
        gl.disable(gl.SCISSOR_TEST);
        reusedFrames++;
      } else {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        drawChunks();
      }
      if (gridShown.visible) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        drawCalls += grid.present(frameView, output.texture, gridShown.minor);
      } else {
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, output.framebuffer);
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
        // A post-blit vector draw must not trigger the browser's lazy default-buffer clear after presentation.
        // Clear the destination first so the terrain blit and annotation draw share the same live backbuffer.
        if (annotations.active() || highlight.active()) gl.clear(gl.COLOR_BUFFER_BIT);
        gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      }
      frames.swap();
      lastFrame = pending || !scheduled ? null : { pixelX, pixelY, zoom: view.zoom, sprites, version: frameVersion, width, height };
    } else {
      lastFrame = null;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (target === null) drawChunks();
      else drawCalls = target.draw(frameView);
    }
    // From one pixel per tile up (the chunk pass's range) the highlight reads the drawn chunks, below it its mask.
    drawCalls += highlight.draw(frameView, target === null && view.zoom >= 1, ready);
    drawCalls += annotations.draw(frameView);
    if (target === null) {
      const drawnKeys = new Set(ready.map(([chunk]) => keyOf(chunk)));
      drawn = visible.filter((chunk) => drawnKeys.has(keyOf(chunk)));
    } else {
      drawn = visible.filter((chunk) => target.built[keyOf(chunk)] === 1);
    }
    // While the sprite program links, its poll asks for the next frame once it is done.
    if (pending) schedule();
    else if (target === null && prefetchChunks > 0) prefetch.schedule();
    options?.onFrame?.({ mode: target !== null ? "overview" : sprites ? "sprites" : "chunks", zoom: view.zoom, uploads, residentChunks: store.size() });
  };

  /**
   * Uploads (and frames, at a sprite zoom) the nearest chunks of the ring of `prefetchChunks` chunks around the
   * viewport that are not resident yet, while the idle period lasts; at least one per step. Evicts only chunks outside
   * the view and the ring. A scheduled frame goes first: the step then waits for the next idle period.
   */
  const prefetch = createIdleTask((deadline) => {
    if (disposed || gl.isContextLost() || world === null) return;
    if (frame !== 0) {
      prefetch.schedule();
      return;
    }
    const source = world;
    const viewport = { width: canvas.width, height: canvas.height };
    const overview = overviews.of(source);
    if (overview !== null && camera.zoom < 1 / overview.factor) return;
    const framed = spriteMode && atlas.ready() && camera.zoom >= SPRITE_MIN_ZOOM && spriteProgram.linked() && framing !== null;
    const { keyOf } = chunkGrid(source);
    const around = chunksAround(camera, viewport, source, prefetchChunks * CHUNK_SIZE);
    const keep = new Set(around.map(keyOf));
    // The view's chunks are the frames' to load: a prefetch never changes what the last frame shows.
    const inView = new Set(visibleChunks(camera, viewport, source).map(keyOf));
    const wanted = byDistance(around.filter((chunk) => {
      const key = keyOf(chunk);
      if (inView.has(key)) return false;
      const slot = store.slotOf(key);
      if (slot === undefined) return true;
      return framed && !store.isFramed(slot) && !store.isDirty(key);
    }), camera, viewport);
    let done = 0;
    for (const chunk of wanted) {
      if (done > 0 && (deadline === null || deadline.timeRemaining() < PREFETCH_IDLE_RESERVE)) break;
      const key = keyOf(chunk);
      let slot = store.slotOf(key);
      if (slot === undefined) {
        // The least recently used chunk outside the view and the ring; none: the cache holds only those.
        if (store.size() >= store.capacity() && !store.evictOne(keep)) return;
        slot = store.insert(chunk, key);
      }
      if (framed) store.frame(chunk, slot);
      done++;
    }
    if (done > 0 && done < wanted.length) prefetch.schedule();
  }, 500, 16);

  const onContextLost = (event: Event): void => {
    // Without this the browser never restores the context.
    event.preventDefault();
    spriteProgram.abort();
    // A loss forced through WEBGL_lose_context is only restored by an explicit call made after this event: Chromium
    // ignores one made earlier. For a real GPU loss the call is a harmless INVALID_OPERATION, the browser restores it.
    setTimeout(() => {
      if (!disposed) loseContext?.restoreContext();
    }, 0);
  };
  const onContextRestored = (): void => {
    // Every GL object died with the context: the parts create theirs again on demand, chunks upload again (and are
    // framed again) as they are drawn, the highlight's lookup and mask are uploaded again.
    for (const part of parts) part.lost();
    linkMapPrograms();
    lastFrame = null;
    if (atlasSource !== null) applyAtlas(atlasSource);
    schedule();
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);

  return {
    setWorld: (next) => {
      frameVersion++;
      if (next !== world) {
        store.setWorld(next);
        colors.setWorld();
        overviews.release();
        objects.clear();
        wires.clear();
        // Also drops the reference that would keep the previous world's planes alive.
        unpack.release();
        world = next;
        highlight.setWorld(next);
      }
      schedule();
    },
    setCamera: (next) => {
      camera = next;
      schedule();
    },
    setAtlas: (next) => {
      if (next === atlasSource) return;
      atlasSource = next;
      frameVersion++;
      if (!gl.isContextLost()) {
        applyAtlas(next);
        // Linking starts now, while the assets arrive, rather than on the first sprite frame.
        if (next !== null) spriteProgram.start();
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
      store.setFraming(next);
      framing = next;
      frameVersion++;
      schedule();
    },
    invalidateTiles: (tiles) => {
      if (world === null || tiles.length === 0) return;
      frameVersion++;
      const source = world;
      const regions = store.invalidateCells(tiles);
      const grid = chunkGrid(source);
      // Per touched chunk, the union of the changed tiles (right and bottom exclusive).
      const touched = new Map<number, Area>();
      const touch = (left: number, top: number, right: number, bottom: number): void => {
        const lastX = Math.floor(Math.min(source.width - 1, right) / CHUNK_SIZE);
        const lastY = Math.floor(Math.min(source.height - 1, bottom) / CHUNK_SIZE);
        for (let x = Math.floor(Math.max(0, left) / CHUNK_SIZE); x <= lastX; x++) {
          for (let y = Math.floor(Math.max(0, top) / CHUNK_SIZE); y <= lastY; y++) {
            const key = grid.keyOf({ x, y });
            touched.set(key, union(touched.get(key), { left, top, right: right + 1, bottom: bottom + 1 }));
          }
        }
      };
      // A changed tile's planes lie in its chunk and, through the page apron, in its neighbours'; the cells of its
      // recomputed area in the chunks the area covers.
      for (const { x, y } of tiles) touch(x - PAGE_APRON, y - PAGE_APRON, x + PAGE_APRON, y + PAGE_APRON);
      for (const area of regions.blocks) touch(area.left, area.top, area.left + area.width - 1, area.top + area.height - 1);
      // Wall cells are uploaded with the apron: a recomputed wall cell lies in the layers of the chunks around it too.
      for (const area of regions.walls) {
        const right = area.left + area.width - 1;
        const bottom = area.top + area.height - 1;
        touch(area.left - PAGE_APRON, area.top - PAGE_APRON, right + PAGE_APRON, bottom + PAGE_APRON);
      }
      objects.invalidate(source, tiles);
      wires.invalidate(source, tiles);
      highlight.patch(tiles);
      const overview = overviews.existing(source);
      for (const [key, area] of touched) {
        store.markDirty(key, area);
        overview?.invalidate(key);
      }
      schedule();
    },
    setHighlight: (next) => {
      // A pass over the presented frame: the frame cache stays valid (frameVersion is not bumped).
      if (highlight.set(next)) schedule();
    },
    setAnnotations: (next) => {
      if (annotations.set(next)) schedule();
    },
    setGrid: (next) => {
      if (grid.set(next)) schedule();
    },
    setLayers: (next) => {
      const bits = layerBits(next);
      if (bits !== layers && !gl.isContextLost() && world !== null) overviews.existing(world)?.invalidateAll();
      // The object lists hold the waterfalls only while liquids are shown, the other objects while blocks are.
      if (((bits ^ layers) & OBJECT_LAYERS) !== 0) objects.clear();
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
      textureUploads: counters.textureUploads, drawCalls, visibleChunks: drawn, residentChunks: store.size(),
      evictedChunks: store.evicted(), atlasUploads: atlas.uploads(), framedTiles: store.framedTiles(),
      framedWalls: store.framedWalls(), spritesPreparing: spriteProgram.preparing(), reusedFrames,
      highlightUploads: highlight.uploads(), highlightBuilding: highlight.building(), objectUploads: objects.uploads(),
      objectChunksCollected: objects.collected(),
    }),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      prefetch.cancel();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      // GL calls on a lost context do nothing; the parts still cancel their timers and drop their references.
      for (const part of parts) part.release();
      world = null;
    },
  };
}
