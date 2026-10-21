// Overlays composed while presenting a frame: the view grid (which presents the frame itself) and the vector
// annotations drawn over it. Neither ever invalidates the frame cache.
/// <reference lib="dom" />

import { annotationFragmentSource, annotationVertexSource } from "./annotation-shaders.js";
import { UNIT, bindTexture, requireValue, type GpuPart, type ProgramCache, type ProgramSource } from "./gl.js";
import { gridFragmentSource, gridVertexSource } from "./grid-shaders.js";
import type { FrameView, MapAnnotations, MapGrid } from "./types.js";

/** CSS pixels per tile from which the grid's dashed block lines are drawn; below it they would merge into a tint. */
const GRID_MIN_BLOCK_PIXELS = 6;
/** CSS pixels between the grid's solid interval lines from which they are drawn. */
const GRID_MIN_INTERVAL_PIXELS = 8;
/** Floats per annotation primitive (MapAnnotations.data). */
const ANNOTATION_FLOATS = 9;

const GRID_PROGRAM: ProgramSource<"uCamera" | "uViewport" | "uWorld" | "uZoom" | "uSpacing" | "uOpacity" | "uDensity" | "uMinor" | "uScene"> = {
  vertex: gridVertexSource, fragment: gridFragmentSource,
  uniforms: ["uCamera", "uViewport", "uWorld", "uZoom", "uSpacing", "uOpacity", "uDensity", "uMinor", "uScene"],
};
const ANNOTATION_PROGRAM: ProgramSource<"uCamera" | "uViewport" | "uZoom" | "uDensity"> = {
  vertex: annotationVertexSource, fragment: annotationFragmentSource, uniforms: ["uCamera", "uViewport", "uZoom", "uDensity"],
};

export interface GridPass {
  /** Validates and sets the grid; false when it is the same as before. Throws a RangeError when invalid. */
  readonly set: (next: MapGrid | null) => boolean;
  /** Whether the grid shows at `zoom` (backing pixels per tile), and whether with its dashed block lines. */
  readonly visibility: (zoom: number) => { readonly visible: boolean; readonly minor: boolean };
  /** Presents `scene` (the frame's colour texture) with the grid over it on the bound target; returns the draw calls. */
  readonly present: (view: FrameView, scene: WebGLTexture, minor: boolean) => number;
}

export function createGridPass(gl: WebGL2RenderingContext, programs: ProgramCache): GridPass {
  let grid: MapGrid | null = null;
  return {
    set: (next) => {
      if (next !== null && (!Number.isInteger(next.spacing) || next.spacing < 2
        || !Number.isFinite(next.opacity) || next.opacity < 0 || next.opacity > 1
        || !Number.isFinite(next.density) || next.density <= 0)) throw new RangeError("Invalid map grid settings");
      if (grid?.spacing === next?.spacing && grid?.opacity === next?.opacity && grid?.density === next?.density) return false;
      grid = next === null ? null : { ...next };
      return true;
    },
    visibility: (zoom) => {
      if (grid === null) return { visible: false, minor: false };
      // Block lines need room between them; interval lines stay while they are apart, so the grid helps zoomed out too.
      const tile = zoom / grid.density;
      const minor = tile >= GRID_MIN_BLOCK_PIXELS;
      return { visible: grid.opacity > 0 && (minor || tile * grid.spacing >= GRID_MIN_INTERVAL_PIXELS), minor };
    },
    present: (view, scene, minor) => {
      if (grid === null) return 0;
      const { program, uniforms } = programs.get(GRID_PROGRAM);
      gl.useProgram(program);
      gl.uniform2f(uniforms.uCamera, view.x, view.y);
      gl.uniform2f(uniforms.uViewport, view.width, view.height);
      gl.uniform2f(uniforms.uWorld, view.source.width, view.source.height);
      gl.uniform1f(uniforms.uZoom, view.zoom);
      gl.uniform1f(uniforms.uSpacing, grid.spacing);
      gl.uniform1f(uniforms.uOpacity, grid.opacity);
      gl.uniform1f(uniforms.uDensity, grid.density);
      gl.uniform1f(uniforms.uMinor, minor ? 1 : 0);
      bindTexture(gl, UNIT.overview, gl.TEXTURE_2D, scene);
      gl.uniform1i(uniforms.uScene, UNIT.overview);
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      return 1;
    },
  };
}

export interface AnnotationPass extends GpuPart {
  /** Validates and sets the annotations; false when they are the same as before. Throws a RangeError when invalid. */
  readonly set: (next: MapAnnotations | null) => boolean;
  readonly active: () => boolean;
  /** Draws the annotations on the bound target; returns the draw calls. */
  readonly draw: (view: FrameView) => number;
}

export function createAnnotationPass(gl: WebGL2RenderingContext, programs: ProgramCache): AnnotationPass {
  let annotations: MapAnnotations | null = null;
  let buffer: WebGLBuffer | null = null;
  let array: WebGLVertexArrayObject | null = null;
  let uploaded: Float32Array | null = null;
  const forget = (): void => {
    buffer = null;
    array = null;
    uploaded = null;
  };
  return {
    set: (next) => {
      if (annotations?.data === next?.data && annotations?.density === next?.density) return false;
      if (next !== null && (next.data.length % ANNOTATION_FLOATS !== 0 || !next.data.every(Number.isFinite)
        || !Number.isFinite(next.density) || next.density <= 0)) throw new RangeError("Invalid annotation geometry");
      annotations = next;
      return true;
    },
    active: () => annotations !== null && annotations.data.length > 0,
    draw: (view) => {
      if (annotations === null || annotations.data.length === 0) return 0;
      const { program, uniforms } = programs.get(ANNOTATION_PROGRAM);
      if (buffer === null || array === null) {
        buffer = requireValue(gl.createBuffer(), "an annotation buffer");
        array = requireValue(gl.createVertexArray(), "an annotation vertex array");
        gl.bindVertexArray(array);
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        for (const [location, count, offset] of [[0, 4, 0], [1, 3, 16], [2, 2, 28]] as const) {
          gl.enableVertexAttribArray(location);
          gl.vertexAttribPointer(location, count, gl.FLOAT, false, ANNOTATION_FLOATS * 4, offset);
          gl.vertexAttribDivisor(location, 1);
        }
      }
      gl.bindVertexArray(array);
      if (uploaded !== annotations.data) {
        gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
        gl.bufferData(gl.ARRAY_BUFFER, annotations.data, gl.DYNAMIC_DRAW);
        uploaded = annotations.data;
      }
      gl.useProgram(program);
      gl.uniform2f(uniforms.uCamera, view.x, view.y);
      gl.uniform2f(uniforms.uViewport, view.width, view.height);
      gl.uniform1f(uniforms.uZoom, view.zoom);
      gl.uniform1f(uniforms.uDensity, annotations.density);
      gl.disable(gl.BLEND);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, annotations.data.length / ANNOTATION_FLOATS);
      gl.bindVertexArray(null);
      return 1;
    },
    lost: forget,
    release: () => {
      if (buffer !== null) gl.deleteBuffer(buffer);
      if (array !== null) gl.deleteVertexArray(array);
      forget();
    },
  };
}
