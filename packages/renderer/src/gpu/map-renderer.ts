/* eslint-disable @typescript-eslint/no-unused-vars -- red-phase stubs and isolatedDeclarations annotations; remove the first rule when implemented */
import type { ChunkLayers } from "../chunk/render.js";
import type { Camera, ChunkCoord } from "../camera/camera.js";
import type { ContentRef } from "@studio/world-model";

/** The slice of a world the renderer reads. Planes are column-major (`x * height + y`); never copied by the caller. */
export interface RenderableWorld {
  readonly width: number;
  readonly height: number;
  readonly surfaceY: number;
  readonly planes: {
    readonly block: Uint16Array;
    readonly wall: Uint16Array;
    readonly liquid: Uint8Array;
    readonly liquidAmount: Uint8Array;
  };
  /** Append-only palette. */
  readonly palette: readonly ContentRef[];
}

export interface MapRendererOptions {
  /** Upper bound of chunk textures kept on the GPU (LRU). Default 512. */
  readonly maxCachedChunks?: number;
}

export interface MapRendererStats {
  /** Texture upload calls since creation: one per chunk upload (all planes) and one per palette append. */
  readonly textureUploads: number;
  /** Draw calls issued by the last `render()`. */
  readonly drawCalls: number;
  /** Chunks drawn by the last `render()`. */
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
  /** Draws synchronously (what the animation frame calls). Setters schedule a frame via requestAnimationFrame. */
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

export function createMapRenderer(_canvas: HTMLCanvasElement, _options?: MapRendererOptions): MapRenderer {
  throw new Error("not implemented");
}
