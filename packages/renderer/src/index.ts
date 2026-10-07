// Public entry point of the framework-free renderer: chunk rendering of CWM planes. The camera and
// drawing backends land here in later issues; this package must never import React (enforced by lint and a test).
export const RENDERER_PACKAGE = "@studio/renderer";
export { renderChunk } from "./chunk/render.js";
export type { ChunkLayers, ChunkPixels, ChunkRenderOptions } from "./chunk/render.js";
export { contentColor, liquidColors, placeholderColor } from "./palette/map-palette.js";
export type { MapColor, MapPalette, Rgba } from "./palette/map-palette.js";
export { terrariaMapPalette } from "./palette/terraria-map-palette.generated.js";
export {
  CHUNK_SIZE, MAX_ZOOM, MIN_ZOOM, actualSize, clampCamera, clampZoom, fitWorld, panBy, screenToTile, tileToScreen,
  visibleChunks, zoomAt,
} from "./camera/camera.js";
export type { Camera, ChunkCoord, Size } from "./camera/camera.js";
export { WebGl2UnavailableError, createMapRenderer } from "./gpu/map-renderer.js";
export type { MapRenderer, MapRendererOptions, MapRendererStats, RenderableWorld } from "./gpu/map-renderer.js";
