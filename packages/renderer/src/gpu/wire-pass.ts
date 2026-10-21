// Sprite mode's wire pass: wires and actuators drawn from their sheets over everything else, one quad per run of
// tiles with any, so a view without wires costs no pass at all.
/// <reference lib="dom" />

import { CHUNK_SIZE } from "../camera/camera.js";
import type { ChunkCoord } from "../camera/camera.js";
import { WIRE_LAYER } from "../chunk/render.js";
import { collectWireRuns, type WireRuns } from "../objects/wires.js";
import { chunkGrid } from "./chunk-grid.js";
import { CHUNKS_PER_PAGE, type ChunkStore, type Resident } from "./chunk-store.js";
import { UNIT, requireValue, type GpuPart, type ProgramCache, type ProgramSource } from "./gl.js";
import { OVERLAY_UNIFORMS, hasFlags, setWireUniforms } from "./map-colors.js";
import { SPRITE_PASS_UNIFORMS, setSpritePassUniforms } from "./object-pass.js";
import type { SpriteAtlas } from "./sprite-atlas.js";
import { LAYER_ATTRIBUTE, RECT_ATTRIBUTE } from "./shaders.js";
import { WIRE_RUN_ATTRIBUTE, wireFragmentSource, wireVertexSource } from "./wire-shaders.js";
import type { FrameView, RenderableWorld } from "./types.js";

/** Ints per instance: its chunk's rectangle and page layer (as the chunk pass), then its run (x, y, w, h). */
const WIRE_INTS = 9;

const WIRE_PROGRAM: ProgramSource<
  (typeof SPRITE_PASS_UNIFORMS)[number] | (typeof OVERLAY_UNIFORMS)[number] | "uPlanes16" | "uPresent" | "uLayers" | "uWorldSize"
  | "uWireSheet" | "uActuatorSheet"
> = {
  vertex: wireVertexSource, fragment: wireFragmentSource,
  uniforms: [
    ...SPRITE_PASS_UNIFORMS, ...OVERLAY_UNIFORMS, "uPlanes16", "uPresent", "uLayers", "uWorldSize", "uWireSheet", "uActuatorSheet",
  ],
};

/** The wire layer bits shown in `layers` (shaders' uLayers). */
export const shownWires = (layers: number): number => (layers >> 4) & WIRE_LAYER.all;

export interface WirePass extends GpuPart {
  /**
   * Draws the wires and actuators of the chunks of `ready` with any shown, premultiplied. Drawing the same `ready`
   * again (a reused frame's strips) uploads nothing. Returns the number of draw calls.
   */
  readonly draw: (view: FrameView, ready: readonly Resident[], present: number) => number;
  /** Drops every chunk's runs: the world changed. */
  readonly clear: () => void;
  /** Drops the runs of the chunks of `tiles`. */
  readonly invalidate: (source: RenderableWorld, tiles: readonly { readonly x: number; readonly y: number }[]) => void;
}

export function createWirePass(
  gl: WebGL2RenderingContext, programs: ProgramCache, atlas: SpriteAtlas, store: ChunkStore,
): WirePass {
  // Per chunk key, the wire and actuator bits (0–4) set anywhere in the chunk and its runs of tiles with any (WireRuns).
  const runsByChunk = new Map<number, WireRuns>();
  let data = new Int32Array(WIRE_INTS * 256);
  let buffer: WebGLBuffer | null = null;
  let array: WebGLVertexArrayObject | null = null;
  // What the buffer holds: the items and shown bits it was written for, its page runs and instance count.
  let uploaded: {
    readonly items: readonly Resident[]; readonly shown: number;
    readonly runs: readonly (readonly [number, number])[]; readonly count: number;
  } | null = null;

  const runsOf = (source: RenderableWorld, chunk: ChunkCoord, key: number): WireRuns => {
    const cached = runsByChunk.get(key);
    if (cached !== undefined) return cached;
    const runs = source.planes.flags === undefined ? { bits: 0, runs: new Int32Array(0) } : collectWireRuns(source, chunk);
    runsByChunk.set(key, runs);
    return runs;
  };

  const vertexArray = (): WebGLVertexArrayObject => {
    if (buffer === null || array === null) {
      buffer = requireValue(gl.createBuffer(), "a buffer");
      array = requireValue(gl.createVertexArray(), "a vertex array");
      gl.bindVertexArray(array);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      for (const location of [RECT_ATTRIBUTE, LAYER_ATTRIBUTE, WIRE_RUN_ATTRIBUTE]) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribDivisor(location, 1);
      }
      gl.bindVertexArray(null);
      uploaded = null;
    }
    return array;
  };

  /** Writes the instances of `ready`'s chunks with shown wires, sorted by page, into the buffer. */
  const upload = (source: RenderableWorld, ready: readonly Resident[], shown: number): NonNullable<typeof uploaded> => {
    const grid = chunkGrid(source);
    const items = ready
      .map(([chunk, slot]) => [chunk, slot, runsOf(source, chunk, grid.keyOf(chunk))] as const)
      .filter(([, , runs]) => (runs.bits & shown) !== 0)
      .sort((first, second) => first[1] - second[1]);
    const total = items.reduce((sum, [, , runs]) => sum + runs.runs.length / 4, 0);
    if (data.length < total * WIRE_INTS) data = new Int32Array(total * WIRE_INTS * 2);
    const runs: (readonly [number, number])[] = [];
    let at = 0;
    for (const [chunk, slot, { runs: chunkRuns }] of items) {
      const page = Math.floor(slot / CHUNKS_PER_PAGE);
      if (runs.at(-1)?.[0] !== page) runs.push([page, at / WIRE_INTS]);
      const originX = chunk.x * CHUNK_SIZE;
      const originY = chunk.y * CHUNK_SIZE;
      const width = Math.min(CHUNK_SIZE, source.width - originX);
      const height = Math.min(CHUNK_SIZE, source.height - originY);
      for (let k = 0; k < chunkRuns.length; k += 4) {
        data[at] = originX;
        data[at + 1] = originY;
        data[at + 2] = width;
        data[at + 3] = height;
        data[at + 4] = slot % CHUNKS_PER_PAGE;
        data.set(chunkRuns.subarray(k, k + 4), at + 5);
        at += WIRE_INTS;
      }
    }
    if (at > 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, at), gl.STREAM_DRAW);
    }
    return { items: ready, shown, runs, count: at / WIRE_INTS };
  };

  const forget = (): void => {
    buffer = null;
    array = null;
    uploaded = null;
  };

  return {
    draw: (view, ready, present) => {
      const { source, layers } = view;
      const shown = shownWires(layers);
      if (shown === 0 || !hasFlags(present)) return 0;
      const vao = vertexArray();
      gl.bindVertexArray(vao);
      if (uploaded?.items !== ready || uploaded.shown !== shown) uploaded = upload(source, ready, shown);
      if (uploaded.count === 0) {
        gl.bindVertexArray(null);
        return 0;
      }
      const { program, uniforms } = programs.get(WIRE_PROGRAM);
      gl.useProgram(program);
      setSpritePassUniforms(gl, atlas, uniforms, view);
      gl.uniform1i(uniforms.uPlanes16, UNIT.planes16);
      gl.uniform1i(uniforms.uPresent, present);
      gl.uniform1i(uniforms.uLayers, layers);
      setWireUniforms(gl, uniforms);
      gl.uniform2i(uniforms.uWorldSize, source.width, source.height);
      gl.uniform4iv(uniforms.uWireSheet, atlas.place("wire"));
      gl.uniform4iv(uniforms.uActuatorSheet, atlas.place("actuator"));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      const stride = WIRE_INTS * 4;
      const calls = store.drawRuns(uploaded.runs, uploaded.count, (first) => {
        gl.vertexAttribIPointer(RECT_ATTRIBUTE, 4, gl.INT, stride, first * stride);
        gl.vertexAttribIPointer(LAYER_ATTRIBUTE, 1, gl.INT, stride, first * stride + 16);
        gl.vertexAttribIPointer(WIRE_RUN_ATTRIBUTE, 4, gl.INT, stride, first * stride + 20);
      });
      gl.bindVertexArray(null);
      gl.disable(gl.BLEND);
      return calls;
    },
    clear: () => {
      runsByChunk.clear();
      uploaded = null;
    },
    invalidate: (source, tiles) => {
      const grid = chunkGrid(source);
      for (const { x, y } of tiles) runsByChunk.delete(grid.keyAt(x, y));
      uploaded = null;
    },
    lost: forget,
    release: () => {
      if (buffer !== null) gl.deleteBuffer(buffer);
      if (array !== null) gl.deleteVertexArray(array);
      forget();
    },
  };
}
