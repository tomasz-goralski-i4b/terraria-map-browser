// Public entry point of the framework-free renderer: chunk rendering of CWM planes. The camera and
// drawing backends land here in later issues; this package must never import React (enforced by lint and a test).
export const RENDERER_PACKAGE = "@studio/renderer";
export { WIRE_ALPHA, WIRE_COLORS, WIRE_LAYER, renderChunk, wireColor } from "./chunk/render.js";
export type { ChunkLayers, ChunkPixels, ChunkRenderOptions } from "./chunk/render.js";
export { FILTER_SUBTILE, MAX_FILTER_TILES, filterTiles, filterTilesPerPixel } from "./chunk/box-filter.js";
export { backgroundColor, contentColor, liquidColors, mapOption, paintedColor, placeholderColor } from "./palette/map-palette.js";
export type { ContentNameMetadata, ContentNameSource, MapBackground, MapColor, MapContentMetadata, MapContentNames, MapOptionRule, MapPalette, Rgba, WorldDepth } from "./palette/map-palette.js";
export { terrariaMapMetadata, terrariaMapNames, terrariaMapPalette } from "./palette/terraria-map-palette.generated.js";
export {
  CHUNK_SIZE, MAX_ZOOM, MIN_ZOOM, actualSize, clampCamera, clampZoom, fitWorld, panBy, screenToTile, tileToScreen,
  visibleChunks, zoomAt,
} from "./camera/camera.js";
export type { Camera, ChunkCoord, Size } from "./camera/camera.js";
export { CameraAnimator, wheelPixels } from "./camera/animator.js";
export type { CameraStep } from "./camera/animator.js";
export { SPRITE_DEFERRED_TILES, WebGl2UnavailableError, createMapRenderer } from "./gpu/map-renderer.js";
export type {
  MapRenderer, MapRendererOptions, MapRendererStats, RenderableWorld, SpriteAtlasSource, SpriteSheetEntry,
} from "./gpu/map-renderer.js";
export { MISSING_SPRITE_COLORS, SPRITE_MIN_ZOOM } from "./gpu/shaders.js";
