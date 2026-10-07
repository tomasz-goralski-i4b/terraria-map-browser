import type { CanonicalWorld, ContentRef } from "../../../world-model/dist/index.js";

export type Rgba = readonly [number, number, number, number];

export interface ChunkLayers {
  readonly background: boolean;
  readonly walls: boolean;
  readonly blocks: boolean;
  readonly liquids: boolean;
}

export interface ChunkRenderOptions {
  readonly surfaceY: number;
  readonly layers: ChunkLayers;
}

export interface ChunkPixels {
  readonly width: number;
  readonly height: number;
  /** Straight-alpha RGBA, row-major within the chunk. */
  readonly pixels: Uint8ClampedArray;
}

/* eslint-disable @typescript-eslint/no-unused-vars -- RED-phase stubs retain the intended API parameters until implementation. */
export function placeholderColor(_ref: ContentRef, _layer: "block" | "wall"): Rgba {
  throw new Error("not implemented");
}

export function renderChunk(
  _world: CanonicalWorld,
  _chunkX: number,
  _chunkY: number,
  _options: ChunkRenderOptions,
): ChunkPixels {
  throw new Error("not implemented");
}
/* eslint-enable @typescript-eslint/no-unused-vars */
