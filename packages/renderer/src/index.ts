// Public entry point of the framework-free renderer: chunk rendering of CWM planes. The camera and
// drawing backends land here in later issues; this package must never import React (enforced by lint and a test).
export const RENDERER_PACKAGE = "@studio/renderer";
export { placeholderColor, renderChunk } from "./chunk/render.js";
export type { ChunkLayers, ChunkPixels, ChunkRenderOptions, Rgba } from "./chunk/render.js";
export {
  CHUNK_SIZE, MAX_ZOOM, MIN_ZOOM, actualSize, clampCamera, clampZoom, fitWorld, panBy, screenToTile, tileToScreen,
  visibleChunks, zoomAt,
} from "./camera/camera.js";
export type { Camera, ChunkCoord, Size } from "./camera/camera.js";
export { WebGl2UnavailableError, createMapRenderer } from "./gpu/map-renderer.js";
export type { MapRenderer, MapRendererOptions, MapRendererStats, RenderableWorld } from "./gpu/map-renderer.js";
