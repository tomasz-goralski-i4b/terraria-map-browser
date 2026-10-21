// Sprite mode's object pass: sprites placed on the CPU from the world's planes (trees, the giant mushroom, track
// extras, drawn tiles, waterfalls), drawn as instanced quads over the chunk pass.
/// <reference lib="dom" />

import { CHUNK_SIZE } from "../camera/camera.js";
import type { ChunkCoord } from "../camera/camera.js";
import { objectSprites, type ObjectSprite } from "../objects/object-sprites.js";
import { waterfallSprites } from "../objects/waterfalls.js";
import { chunkGrid } from "./chunk-grid.js";
import { requireValue, type GpuPart, type ProgramCache, type ProgramSource } from "./gl.js";
import { PAINT_GROUP_UNIFORMS, SAMPLING_UNIFORMS, setPaintGroups, type SpriteAtlas } from "./sprite-atlas.js";
import {
  OBJECT_BEHIND, OBJECT_DEST_ATTRIBUTE, OBJECT_FADE_SHIFT, OBJECT_FLIP, OBJECT_GROUP_SHIFT, OBJECT_INACTIVE, OBJECT_PAINT_SHIFT,
  OBJECT_COLORS, OBJECT_COLOR_SHIFT, OBJECT_SOURCE_ATTRIBUTE, objectFragmentSource, objectOrder, objectVertexSource,
} from "./object-shaders.js";
import type { FrameView, RenderableWorld } from "./types.js";

/** Ints per object pass instance: its rectangle in world sprite pixels, then (atlas page, x, y, flags) of its source. */
const OBJECT_INTS = 8;
/** The layer bits (shaders' uLayers) of the blocks, which hold the objects, and the liquids, which hold the waterfalls. */
const BLOCKS_LAYER = 4;
export const LIQUIDS_LAYER = 8;
export const OBJECT_LAYERS: number = BLOCKS_LAYER | LIQUIDS_LAYER;

/** The camera uniforms every sprite pass besides the chunk pass has (spritePassInputs). */
export const SPRITE_PASS_UNIFORMS: readonly ["uCamera", "uZoom", "uViewport", ...typeof SAMPLING_UNIFORMS] = [
  "uCamera", "uZoom", "uViewport", ...SAMPLING_UNIFORMS,
];

const OBJECT_PROGRAM: ProgramSource<(typeof SPRITE_PASS_UNIFORMS)[number] | (typeof PAINT_GROUP_UNIFORMS)[number] | "uLayers"> = {
  vertex: objectVertexSource, fragment: objectFragmentSource,
  uniforms: [...SPRITE_PASS_UNIFORMS, ...PAINT_GROUP_UNIFORMS, "uLayers"],
};

/** Sets the camera and sprite sampling uniforms of a sprite pass. */
export function setSpritePassUniforms(
  gl: WebGL2RenderingContext, atlas: SpriteAtlas,
  uniforms: Readonly<Record<(typeof SPRITE_PASS_UNIFORMS)[number], WebGLUniformLocation>>, view: FrameView,
): void {
  gl.uniform2f(uniforms.uCamera, view.x, view.y);
  gl.uniform1f(uniforms.uZoom, view.zoom);
  gl.uniform2f(uniforms.uViewport, view.width, view.height);
  atlas.setSampling(uniforms, view.zoom);
}

/** One chunk's object list: its instances. */
interface ChunkObjects {
  readonly instances: Int32Array;
}

export interface ObjectPass extends GpuPart {
  /**
   * Draws the object sprites of the visible chunks and the chunks around them (an object may reach a few tiles past
   * its own chunk), blended by straight alpha. Returns the number of draw calls.
   */
  readonly draw: (view: FrameView, visible: readonly ChunkCoord[]) => number;
  /** Drops every list: the world, the atlas, or the layers they hold (objects with blocks, waterfalls with liquids) changed. */
  readonly clear: () => void;
  /**
   * After the world's planes changed at `tiles`: an object's look can depend on tiles far from it (a tree's on the
   * ground under its trunk), so the lists of every chunk within one chunk of a changed tile are collected again.
   */
  readonly invalidate: (source: RenderableWorld, tiles: readonly { readonly x: number; readonly y: number }[]) => void;
  /** Instance buffer uploads since creation (MapRendererStats.objectUploads). */
  readonly uploads: () => number;
  /** Chunk object lists collected since creation (MapRendererStats.objectChunksCollected). */
  readonly collected: () => number;
}

export function createObjectPass(gl: WebGL2RenderingContext, programs: ProgramCache, atlas: SpriteAtlas): ObjectPass {
  // By chunk key, for the current world and atlas: computed on the CPU from the world's planes on first draw.
  const cache = new Map<number, ChunkObjects>();
  let data = new Int32Array(OBJECT_INTS * 256);
  let buffer: WebGLBuffer | null = null;
  let array: WebGLVertexArrayObject | null = null;
  // The chunk keys whose instances the buffer holds, in order, and their instance count: a frame showing the same
  // chunks with none of their lists collected again draws the buffer as it is, without uploading it again.
  let uploaded: { readonly keys: readonly number[]; readonly instances: number } | null = null;
  let uploads = 0;
  let collected = 0;

  /**
   * The instances of `chunk` (cached): its object sprites whose sheet is in the atlas, each as its rectangle in world
   * sprite pixels and the atlas place of its source rectangle. A rectangle past its sheet is dropped.
   */
  const objectsOf = (source: RenderableWorld, chunk: ChunkCoord, key: number, layers: number): Int32Array => {
    const cached = cache.get(key);
    if (cached !== undefined) return cached.instances;
    collected++;
    const area = {
      left: chunk.x * CHUNK_SIZE, top: chunk.y * CHUNK_SIZE, right: (chunk.x + 1) * CHUNK_SIZE, bottom: (chunk.y + 1) * CHUNK_SIZE,
    };
    // Waterfalls belong to the liquids layer (docs/assets.md, "Waterfalls"), the other objects to the blocks layer;
    // toggling either drops these lists.
    const sprites: readonly ObjectSprite[] = [
      ...((layers & BLOCKS_LAYER) !== 0 ? objectSprites(source, area) : []),
      ...((layers & LIQUIDS_LAYER) !== 0 ? waterfallSprites(source, area) : []),
    ];
    const placed = new Int32Array(sprites.length * OBJECT_INTS);
    let at = 0;
    for (const sprite of sprites) {
      const sheet = atlas.sheet(sprite.kind, sprite.id);
      if (sheet === undefined || sprite.sx < 0 || sprite.sy < 0) continue;
      if (sprite.sx + sprite.width > sheet.width || sprite.sy + sprite.height > sheet.height) continue;
      const flags = (sprite.flip === true ? OBJECT_FLIP : 0) | ((255 - (sprite.alpha ?? 255)) << OBJECT_FADE_SHIFT)
        | ((sprite.color === undefined ? 0 : OBJECT_COLORS[sprite.color]) << OBJECT_COLOR_SHIFT) | (sprite.behind === true ? OBJECT_BEHIND : 0)
        | ((sprite.paint ?? 0) << OBJECT_PAINT_SHIFT)
        | (sprite.inactive === true ? OBJECT_INACTIVE : 0) | ((sprite.paintGroup ?? 0) << OBJECT_GROUP_SHIFT);
      placed.set([
        sprite.dx, sprite.dy, sprite.width | (sprite.height << 16),
        objectOrder(sprite),
        sheet.page, sheet.x + sprite.sx, sheet.y + sprite.sy, flags,
      ], at);
      at += OBJECT_INTS;
    }
    const instances = placed.subarray(0, at);
    cache.set(key, { instances });
    return instances;
  };

  const vertexArray = (): WebGLVertexArrayObject => {
    if (buffer === null || array === null) {
      buffer = requireValue(gl.createBuffer(), "a buffer");
      array = requireValue(gl.createVertexArray(), "a vertex array");
      gl.bindVertexArray(array);
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // Two ivec4 per instance (OBJECT_INTS).
      for (const [location, offset] of [[OBJECT_DEST_ATTRIBUTE, 0], [OBJECT_SOURCE_ATTRIBUTE, 16]] as const) {
        gl.enableVertexAttribArray(location);
        gl.vertexAttribIPointer(location, 4, gl.INT, OBJECT_INTS * 4, offset);
        gl.vertexAttribDivisor(location, 1);
      }
      gl.bindVertexArray(null);
      uploaded = null;
    }
    return array;
  };

  const forget = (): void => {
    buffer = null;
    array = null;
    uploaded = null;
  };

  return {
    draw: (view, visible) => {
      const { source, layers } = view;
      const grid = chunkGrid(source);
      const keys = new Set(visible.flatMap(grid.around));
      const sorted = [...keys].sort((a, b) => a - b);
      const vao = vertexArray();
      const previous = uploaded;
      // Unchanged when the same chunks are shown and none of their lists was dropped since the upload.
      const unchanged = previous !== null && previous.keys.length === sorted.length
        && sorted.every((key, index) => previous.keys[index] === key && cache.has(key));
      if (!unchanged) {
        const lists = sorted.map((key) => objectsOf(source, grid.coordOf(key), key, layers));
        const total = lists.reduce((sum, list) => sum + list.length, 0);
        if (data.length < total) data = new Int32Array(total * 2);
        let at = 0;
        for (const list of lists) {
          data.set(list, at);
          at += list.length;
        }
        if (total > 0) {
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, total), gl.DYNAMIC_DRAW);
          uploads++;
        }
        uploaded = { keys: sorted, instances: total / OBJECT_INTS };
      }
      const instances = uploaded?.instances ?? 0;
      if (instances === 0) return 0;
      const { program, uniforms } = programs.get(OBJECT_PROGRAM);
      gl.useProgram(program);
      setSpritePassUniforms(gl, atlas, uniforms, view);
      gl.uniform1i(uniforms.uLayers, layers);
      setPaintGroups(gl, uniforms);
      gl.bindVertexArray(vao);
      gl.enable(gl.BLEND);
      // Premultiplied: glitter adds its colour (writeAdded).
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instances);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
      return 1;
    },
    clear: () => {
      cache.clear();
      uploaded = null;
    },
    invalidate: (source, tiles) => {
      const grid = chunkGrid(source);
      for (const { x, y } of tiles) for (const key of grid.around(grid.coordOf(grid.keyAt(x, y)))) cache.delete(key);
    },
    uploads: () => uploads,
    collected: () => collected,
    lost: forget,
    release: () => {
      if (buffer !== null) gl.deleteBuffer(buffer);
      if (array !== null) gl.deleteVertexArray(array);
      forget();
    },
  };
}
