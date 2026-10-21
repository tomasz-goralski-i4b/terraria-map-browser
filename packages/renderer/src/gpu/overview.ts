// The zoomed-out overview: one mipmapped texel per factor × factor tiles, built from resident chunks in sweep order
// and drawn in their place below one pixel per texel (and as the stand-in for chunks still loading).
/// <reference lib="dom" />

import { CHUNK_SIZE, visibleChunks } from "../camera/camera.js";
import type { Camera, ChunkCoord, Size } from "../camera/camera.js";
import type { ChunkStore, Resident } from "./chunk-store.js";
import { UNIT, bindTexture, byDistance, requireValue, type GpuPart, type ProgramCache, type ProgramSource } from "./gl.js";
import { OVERLAY_UNIFORMS, TILE_UNIFORMS, setWireUniforms, type MapColors } from "./map-colors.js";
import { overviewBuildFragmentSource, overviewBuildVertexSource, overviewFragmentSource, overviewVertexSource } from "./shaders.js";
import type { FrameView, RenderableWorld } from "./types.js";

/** The smallest overview factor: one overview texel per 2 × 2 tiles, used below half a pixel per tile. */
const MIN_OVERVIEW_FACTOR = 2;

export const BUILD_PROGRAM: ProgramSource<(typeof TILE_UNIFORMS)[number] | (typeof OVERLAY_UNIFORMS)[number] | "uFactor" | "uTarget"> = {
  vertex: overviewBuildVertexSource, fragment: overviewBuildFragmentSource,
  uniforms: [...TILE_UNIFORMS, ...OVERLAY_UNIFORMS, "uFactor", "uTarget"],
};
/** The overview's draw program; also the vertex stage of the highlight mask. */
export const OVERVIEW_UNIFORMS = ["uCamera", "uZoom", "uViewport", "uWorld", "uExtent"] as const;
export const DRAW_PROGRAM: ProgramSource<(typeof OVERVIEW_UNIFORMS)[number] | "uOverview"> = {
  vertex: overviewVertexSource, fragment: overviewFragmentSource, uniforms: [...OVERVIEW_UNIFORMS, "uOverview"],
};

/** Sets the uniforms of overviewVertexSource: a quad over the world, `extent` tiles of texture. */
export function setOverviewUniforms(
  gl: WebGL2RenderingContext, uniforms: Readonly<Record<(typeof OVERVIEW_UNIFORMS)[number], WebGLUniformLocation>>,
  view: FrameView, extentX: number, extentY: number,
): void {
  gl.uniform2f(uniforms.uCamera, view.x, view.y);
  gl.uniform1f(uniforms.uZoom, view.zoom);
  gl.uniform2f(uniforms.uViewport, view.width, view.height);
  gl.uniform2f(uniforms.uWorld, view.source.width, view.source.height);
  gl.uniform2f(uniforms.uExtent, extentX, extentY);
}

/** Tiles per overview texel and axis for `source`; null when even the largest factor cannot fit it. */
export function overviewFactor(source: RenderableWorld, maxTextureSize: number): number | null {
  let factor = MIN_OVERVIEW_FACTOR;
  while (factor < CHUNK_SIZE && Math.ceil(Math.max(source.width, source.height) / factor) > maxTextureSize) factor *= 2;
  const width = Math.ceil(source.width / factor);
  const height = Math.ceil(source.height / factor);
  return width === 0 || height === 0 || Math.max(width, height) > maxTextureSize ? null : factor;
}

/** The overview of one world: a mipmapped RGBA8 texture, one texel per factor × factor tiles, premultiplied. */
export interface Overview {
  readonly world: RenderableWorld;
  readonly factor: number;
  /** Per chunk (y * chunksX + x): 1 once its texels hold the current layers. */
  readonly built: Uint8Array;
  /** Whether any texel was ever built: invalidation keeps the old texels until the rebuild overwrites them. */
  readonly filled: () => boolean;
  /**
   * The order in which overview texels are built: the visible chunks, then the rest of the overview's filter footprint
   * around the viewport, each by distance from the centre of the view. Building strictly in this order makes a
   * rebuild sweep out from the centre as one front.
   */
  readonly footprint: (camera: Camera, visible: readonly ChunkCoord[], viewport: Size) => readonly ChunkCoord[];
  /** Draws the chunks' overview texels with the build pass, then regenerates the overview mipmaps. */
  readonly build: (items: readonly Resident[], layers: number, present: number) => void;
  /** Draws the overview over the whole world into the bound target; returns the number of draw calls. */
  readonly draw: (view: FrameView) => number;
  /** Marks the texels of chunk `key` stale. */
  readonly invalidate: (key: number) => void;
  /**
   * Marks every texel stale: their chunks draw them again on demand. The texture is not cleared, so the old texels
   * stay visible until the rebuild overwrites them and the map never blanks.
   */
  readonly invalidateAll: () => void;
}

export interface OverviewPart extends GpuPart {
  /** The overview of `source`, created (empty) on first use; null when even the largest factor cannot fit it. */
  readonly of: (source: RenderableWorld) => Overview | null;
  /** The overview, if one exists for `source`, without creating it. */
  readonly existing: (source: RenderableWorld) => Overview | null;
}

export function createOverviewPart(
  gl: WebGL2RenderingContext, programs: ProgramCache, colors: MapColors, store: ChunkStore,
): OverviewPart {
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  let current: (Overview & { readonly texture: WebGLTexture }) | null = null;
  let framebuffer: WebGLFramebuffer | null = null;

  const create = (source: RenderableWorld, factor: number): Overview & { readonly texture: WebGLTexture } => {
    const width = Math.ceil(source.width / factor);
    const height = Math.ceil(source.height / factor);
    const texture = requireValue(gl.createTexture(), "a texture");
    bindTexture(gl, UNIT.overview, gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(width, height))) + 1, gl.RGBA8, width, height);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    // Magnified only as the stand-in for chunks still loading: smooth rather than blocky.
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    // Storage starts zeroed but its mip chain is incomplete until generated.
    gl.generateMipmap(gl.TEXTURE_2D);
    const chunksX = Math.ceil(source.width / CHUNK_SIZE);
    const chunksY = Math.ceil(source.height / CHUNK_SIZE);
    const built = new Uint8Array(chunksX * chunksY);
    let filled = false;
    // The build order of the last frame's camera and viewport (footprint).
    let sweep: { readonly camera: Camera; readonly width: number; readonly height: number; readonly order: readonly ChunkCoord[] } | null = null;
    return {
      world: source, texture, factor, built,
      filled: () => filled,
      footprint: (camera, visible, viewport) => {
        if (sweep !== null && sweep.camera === camera && sweep.width === viewport.width && sweep.height === viewport.height) {
          return sweep.order;
        }
        const margin = Math.ceil(4 / camera.zoom);
        const around = visibleChunks(
          { x: camera.x - margin, y: camera.y - margin, zoom: camera.zoom },
          { width: viewport.width + 2 * margin * camera.zoom, height: viewport.height + 2 * margin * camera.zoom },
          source,
        );
        const inView = new Set(visible.map((chunk) => chunk.y * chunksX + chunk.x));
        const centreX = camera.x + viewport.width / (2 * camera.zoom);
        const centreY = camera.y + viewport.height / (2 * camera.zoom);
        // Equal distances keep visibleChunks' row-major order.
        const order = [
          ...byDistance([...visible], CHUNK_SIZE, centreX, centreY),
          ...byDistance(around.filter((chunk) => !inView.has(chunk.y * chunksX + chunk.x)), CHUNK_SIZE, centreX, centreY),
        ];
        sweep = { camera, width: viewport.width, height: viewport.height, order };
        return order;
      },
      build: (items, layers, present) => {
        if (items.length === 0) return;
        const program = programs.get(BUILD_PROGRAM);
        framebuffer ??= requireValue(gl.createFramebuffer(), "a framebuffer");
        gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.viewport(0, 0, width, height);
        gl.useProgram(program.program);
        colors.setTileUniforms(program.uniforms, layers, present);
        setWireUniforms(gl, program.uniforms);
        gl.uniform1i(program.uniforms.uFactor, factor);
        gl.uniform2f(program.uniforms.uTarget, width, height);
        store.draw(items);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        for (const [chunk] of items) built[chunk.y * chunksX + chunk.x] = 1;
        filled = true;
        bindTexture(gl, UNIT.overview, gl.TEXTURE_2D, texture);
        gl.generateMipmap(gl.TEXTURE_2D);
      },
      draw: (view) => {
        const program = programs.get(DRAW_PROGRAM);
        gl.useProgram(program.program);
        setOverviewUniforms(gl, program.uniforms, view, width * factor, height * factor);
        gl.uniform1i(program.uniforms.uOverview, UNIT.overview);
        bindTexture(gl, UNIT.overview, gl.TEXTURE_2D, texture);
        gl.bindVertexArray(null);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return 1;
      },
      invalidate: (key) => { built[key] = 0; },
      invalidateAll: () => { built.fill(0); },
    };
  };

  const releaseCurrent = (): void => {
    if (current !== null && !gl.isContextLost()) gl.deleteTexture(current.texture);
    // Also drops the cached sweep order, which references the previous world.
    current = null;
  };

  return {
    of: (source) => {
      if (current?.world === source) return current;
      releaseCurrent();
      const factor = overviewFactor(source, maxTextureSize);
      if (factor === null) return null;
      current = create(source, factor);
      return current;
    },
    existing: (source) => (current?.world === source ? current : null),
    lost: () => {
      current = null;
      framebuffer = null;
    },
    release: () => {
      releaseCurrent();
      if (framebuffer !== null && !gl.isContextLost()) gl.deleteFramebuffer(framebuffer);
      framebuffer = null;
    },
  };
}
