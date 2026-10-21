// The content highlight: an overlay over the presented frame that outlines (or tints) the tiles holding the
// highlighted contents and dims the rest. From one pixel per tile up it reads the resident chunks' planes through a
// lookup of the highlighted palette indices; zoomed out it draws a match mask built from the planes in idle slices.
/// <reference lib="dom" />

import {
  HIGHLIGHT_OUTLINE_PIXELS, HIGHLIGHT_OUTLINE_ZOOM, HIGHLIGHT_TINT_ALPHA, createHighlightMask, highlightColors, highlightLiquids,
  highlightLookup, type HighlightMask, type HighlightOptions, type MapHighlight, type MaskRect,
} from "../chunk/highlight.js";
import type { ChunkStore, Resident } from "./chunk-store.js";
import { UNIT, bindTexture, defaultUnpack, integerTexture, requireValue, type GpuPart, type ProgramCache, type ProgramSource, type UnpackState } from "./gl.js";
import { highlightChunkFragmentSource, highlightMaskFragmentSource } from "./highlight-shaders.js";
import { createIdleTask } from "./idle-task.js";
import { PALETTE_CAPACITY } from "./map-colors.js";
import { OVERVIEW_UNIFORMS, setOverviewUniforms } from "./overview.js";
import { chunkVertexSource, overviewVertexSource } from "./shaders.js";
import type { FrameView, RenderableWorld } from "./types.js";

/** Texels per row of the highlight lookup (R8UI, 256 × 256: one per 16-bit palette index). */
const LOOKUP_ROW = 256;
/** Time an idle slice of the mask build may spend, in milliseconds (less when the idle period is shorter). */
const MASK_SLICE_MILLISECONDS = 6;

const CHUNK_PROGRAM: ProgramSource<
  "uPlanes16" | "uPlanes8" | "uHighlight" | "uLiquids" | "uPaletteLength" | "uCamera" | "uZoom" | "uViewport" | "uWorldSize"
  | "uColor" | "uDimAlpha" | "uTintAlpha" | "uOutline"
> = {
  vertex: chunkVertexSource, fragment: highlightChunkFragmentSource,
  uniforms: [
    "uPlanes16", "uPlanes8", "uHighlight", "uLiquids", "uPaletteLength", "uCamera", "uZoom", "uViewport", "uWorldSize",
    "uColor", "uDimAlpha", "uTintAlpha", "uOutline",
  ],
};
const MASK_PROGRAM: ProgramSource<(typeof OVERVIEW_UNIFORMS)[number] | "uMask" | "uColor" | "uDimAlpha"> = {
  vertex: overviewVertexSource, fragment: highlightMaskFragmentSource, uniforms: [...OVERVIEW_UNIFORMS, "uMask", "uColor", "uDimAlpha"],
};

export interface HighlightPass extends GpuPart {
  readonly active: () => boolean;
  /** Validates and sets the highlight; false when it is the same as before (nothing to draw again). */
  readonly set: (next: MapHighlight | null) => boolean;
  /** The world changed: the mask is built again for it. */
  readonly setWorld: (world: RenderableWorld | null) => void;
  /** After the world's planes changed at `tiles`: patches the mask. */
  readonly patch: (tiles: readonly { readonly x: number; readonly y: number }[]) => void;
  /**
   * Draws the highlight over the bound target, blended by straight alpha: from one pixel per tile up (the chunk pass's
   * range, `chunks` true) over the resident chunks drawn (`ready`), below it the mask. Returns the number of draw calls.
   */
  readonly draw: (view: FrameView, chunks: boolean, ready: readonly Resident[]) => number;
  /** Lookup and mask uploads since creation (MapRendererStats.highlightUploads). */
  readonly uploads: () => number;
  /** Whether the mask is still being built. */
  readonly building: () => boolean;
}

export function createHighlightPass(
  gl: WebGL2RenderingContext, programs: ProgramCache, unpack: UnpackState, store: ChunkStore, options: HighlightOptions | undefined,
  /** The overview factor of a world (the mask has the overview's resolution). */
  factorOf: (world: RenderableWorld) => number | null,
  /** Asks for a frame once a mask slice is built while the mask is drawn (below one pixel per tile). */
  onSlice: () => void,
): HighlightPass {
  const style = highlightColors(options);
  const colorUniform = new Float32Array(style.color.map((channel) => channel / 255));
  // The highlight as set (null: no pass), its content sets as a CPU lookup (key: the sorted sets, to recognize the same
  // contents), the lookup texture (stale until uploaded for the next draw), and the mask with its texture (created by
  // the first upload).
  let highlight: MapHighlight | null = null;
  let key = "";
  let bytes: Uint8Array | null = null;
  let liquidBits = 0;
  let lookupTexture: WebGLTexture | null = null;
  let lookupStale = false;
  let mask: { readonly mask: HighlightMask; texture: WebGLTexture | null } | null = null;
  let world: RenderableWorld | null = null;
  let uploads = 0;

  /** Uploads the lookup of the current highlight's blocks and walls when it changed (one 64 KiB upload). */
  const uploadLookup = (): void => {
    if (!lookupStale || bytes === null) return;
    unpack.reset();
    gl.activeTexture(gl.TEXTURE0 + UNIT.highlight);
    if (lookupTexture === null) lookupTexture = integerTexture(gl, gl.R8UI, LOOKUP_ROW, LOOKUP_ROW);
    else gl.bindTexture(gl.TEXTURE_2D, lookupTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, LOOKUP_ROW, LOOKUP_ROW, gl.RED_INTEGER, gl.UNSIGNED_BYTE, bytes);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    lookupStale = false;
    uploads++;
  };

  /**
   * Uploads changed rectangles of the mask, one texSubImage2D per mip level, read in place from its levels; creates
   * its texture (R8, every level, sampled nearest: the levels hold maxima) on the first one.
   */
  const uploadMaskRects = (state: NonNullable<typeof mask>, rects: readonly MaskRect[]): void => {
    if (rects.length === 0 || gl.isContextLost()) return;
    const levels = state.mask;
    unpack.reset();
    gl.activeTexture(gl.TEXTURE0 + UNIT.highlight);
    if (state.texture === null) {
      const texture = requireValue(gl.createTexture(), "a texture");
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texStorage2D(gl.TEXTURE_2D, levels.levels.length, gl.R8, levels.width, levels.height);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      state.texture = texture;
    } else {
      gl.bindTexture(gl.TEXTURE_2D, state.texture);
    }
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    for (const rect of rects) {
      const level = levels.levels[rect.level];
      if (level === undefined || rect.width <= 0 || rect.height <= 0) continue;
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, Math.max(1, levels.width >> rect.level));
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, rect.x);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, rect.y);
      gl.texSubImage2D(gl.TEXTURE_2D, rect.level, rect.x, rect.y, rect.width, rect.height, gl.RED, gl.UNSIGNED_BYTE, level);
    }
    defaultUnpack(gl);
    uploads++;
  };

  const releaseMask = (): void => {
    if (mask?.texture != null && !gl.isContextLost()) gl.deleteTexture(mask.texture);
    mask = null;
  };

  /**
   * One idle slice of the mask build: columns of the mask until MASK_SLICE_MILLISECONDS (or the idle period) is spent,
   * at least one, uploaded with the levels above them. Reads the planes on the CPU; never uploads chunk planes.
   */
  const maskBuild = createIdleTask((deadline) => {
    const state = mask;
    // After a context loss the restore starts the build again.
    if (state === null || gl.isContextLost()) return;
    // A slice that ran because its timeout passed (the page is busy, e.g. animating) still takes a full slice: one
    // column per timeout would take minutes on a large world, and a slice is far from a long task either way.
    const budget = deadline === null || deadline.didTimeout
      ? MASK_SLICE_MILLISECONDS
      : Math.min(MASK_SLICE_MILLISECONDS, Math.max(1, deadline.timeRemaining() - 1));
    const end = performance.now() + budget;
    uploadMaskRects(state, state.mask.step(() => performance.now() >= end));
    if (!state.mask.done) maskBuild.schedule();
    onSlice();
  }, 50, 0);

  /** Starts building the mask of the current highlight and world from scratch, dropping the previous one. */
  const startMask = (): void => {
    maskBuild.cancel();
    releaseMask();
    if (highlight === null || bytes === null || world === null || gl.isContextLost()) return;
    const factor = factorOf(world);
    if (factor === null) return;
    mask = { mask: createHighlightMask(world, bytes, liquidBits, factor), texture: null };
    maskBuild.schedule();
  };

  return {
    active: () => highlight !== null,
    set: (next) => {
      // Validates before anything changes.
      const lookup = next === null ? null : highlightLookup(next);
      const liquids = next === null ? 0 : highlightLiquids(next);
      const sorted = (values: readonly number[]): number[] => [...new Set(values)].sort((a, b) => a - b);
      const nextKey = next === null ? "" : JSON.stringify([sorted(next.blocks), sorted(next.walls), sorted(next.liquids)]);
      if (nextKey === key && highlight?.dim === next?.dim) return false;
      highlight = next === null ? null : { blocks: [...next.blocks], walls: [...next.walls], liquids: [...next.liquids], dim: next.dim };
      if (nextKey !== key) {
        key = nextKey;
        bytes = lookup;
        liquidBits = liquids;
        lookupStale = lookup !== null;
        startMask();
      }
      return true;
    },
    setWorld: (next) => {
      world = next;
      startMask();
    },
    patch: (tiles) => {
      if (mask !== null && mask.mask.world === world) uploadMaskRects(mask, mask.mask.patch(tiles));
    },
    draw: (view, chunks, ready) => {
      if (highlight === null) return 0;
      const { source } = view;
      const dimAlpha = highlight.dim ? style.dim / 255 : 0;
      let calls = 0;
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      if (chunks) {
        uploadLookup();
        const { program, uniforms } = programs.get(CHUNK_PROGRAM);
        gl.useProgram(program);
        gl.uniform1i(uniforms.uPlanes16, UNIT.planes16);
        gl.uniform1i(uniforms.uPlanes8, UNIT.planes8);
        gl.uniform1i(uniforms.uHighlight, UNIT.highlight);
        gl.uniform1i(uniforms.uLiquids, liquidBits);
        gl.uniform1i(uniforms.uPaletteLength, Math.min(source.palette.length, PALETTE_CAPACITY));
        gl.uniform2f(uniforms.uCamera, view.x, view.y);
        gl.uniform1f(uniforms.uZoom, view.zoom);
        gl.uniform2f(uniforms.uViewport, view.width, view.height);
        gl.uniform2i(uniforms.uWorldSize, source.width, source.height);
        gl.uniform3fv(uniforms.uColor, colorUniform);
        gl.uniform1f(uniforms.uDimAlpha, dimAlpha);
        gl.uniform1f(uniforms.uTintAlpha, HIGHLIGHT_TINT_ALPHA / 255);
        gl.uniform1f(uniforms.uOutline, view.zoom >= HIGHLIGHT_OUTLINE_ZOOM ? HIGHLIGHT_OUTLINE_PIXELS : 0);
        bindTexture(gl, UNIT.highlight, gl.TEXTURE_2D, lookupTexture);
        calls += store.draw(ready);
      } else if (mask !== null && mask.texture !== null && mask.mask.world === source) {
        const { mask: levels, texture } = mask;
        const { program, uniforms } = programs.get(MASK_PROGRAM);
        gl.useProgram(program);
        setOverviewUniforms(gl, uniforms, view, levels.width * levels.factor, levels.height * levels.factor);
        gl.uniform1i(uniforms.uMask, UNIT.highlight);
        gl.uniform3fv(uniforms.uColor, colorUniform);
        gl.uniform1f(uniforms.uDimAlpha, dimAlpha);
        bindTexture(gl, UNIT.highlight, gl.TEXTURE_2D, texture);
        gl.bindVertexArray(null);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        calls++;
      }
      gl.disable(gl.BLEND);
      return calls;
    },
    uploads: () => uploads,
    building: () => mask !== null && !mask.mask.done,
    lost: () => {
      // The lookup is uploaded again and the mask built again.
      lookupTexture = null;
      lookupStale = bytes !== null;
      if (mask !== null) mask.texture = null;
      startMask();
    },
    release: () => {
      maskBuild.cancel();
      if (lookupTexture !== null) gl.deleteTexture(lookupTexture);
      lookupTexture = null;
      releaseMask();
    },
  };
}
