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
export { WebGl2UnavailableError, createMapRenderer } from "./gpu/map-renderer.js";
export type {
  MapRenderer, MapRendererOptions, MapRendererStats, RenderableWorld, SpriteAtlasSource, SpriteSheetEntry,
} from "./gpu/map-renderer.js";
export { SPRITE_FRAME_WRAPS, wrappedFrame } from "./gpu/frame-wrap.js";
export type { FrameWrap } from "./gpu/frame-wrap.js";
export { MISSING_SPRITE_COLORS, SPRITE_FULL_ZOOM, SPRITE_MIN_ZOOM, spriteSampling } from "./gpu/shaders.js";
export { NEIGHBOUR_ORDER, UNSTABLE_CELL, loadFramingDatabase, neighbourhoodCode } from "./framing/framing-database.js";
export type {
  BlockFramingData, BlockRelation, Cell, FramingDatabase, FramingDatabaseData, WallFramingData, WallTables,
} from "./framing/framing-database.js";
export { terrariaFramingData } from "./framing/terraria-framing.generated.js";
export { NOT_VANILLA, NO_CELL, createBlockFraming } from "./framing/frame-block.js";
export type {
  BlockFraming, BlockFramingInput, BlockKind, BlockRegion, FramingWorld, SheetCell,
} from "./framing/frame-block.js";
export { BLOCK_CELL_STRIDE, blockSourceRect, createChunkCellCache, shapedColumns } from "./framing/chunk-cells.js";
export type { ChunkCellCache, ShapedColumn, SourceRect } from "./framing/chunk-cells.js";
export {
  WALL_CELL_PIXELS, WALL_CELL_STRIDE, WALL_OVERHANG, WALL_SIDE, createWallFraming, wallSourceRect,
} from "./framing/frame-wall.js";
export type { WallFraming, WallFramingWorld } from "./framing/frame-wall.js";
export { createChunkWallCellCache } from "./framing/chunk-wall-cells.js";
export type { ChunkWallCellCache } from "./framing/chunk-wall-cells.js";
export {
  TRACK_CELL_STRIDE, TRACK_EXTRA_OFFSET, TRACK_FLAGS, TRACK_PIECE_COUNT, TRACK_TILE, trackExtraCell, trackPiece,
} from "./objects/tracks.js";
export type { TrackCell, TrackExtra, TrackPiece } from "./objects/tracks.js";
export type { SpriteObjectData } from "./objects/sprite-object-data.js";
export { terrariaSpriteObjects } from "./objects/terraria-sprite-objects.generated.js";
export { WIRE_CELL_STRIDE, WIRE_DRAW_ORDER, wireCell, wirePiece } from "./objects/wires.js";
export type { WireColor, WireNeighbours } from "./objects/wires.js";
export { OBJECT_TILES, SPRITE_PIXELS_PER_TILE, objectSprites } from "./objects/object-sprites.js";
export type { ObjectSheetKind, ObjectSprite, ObjectWorld, TileArea, TreeSettings } from "./objects/object-sprites.js";
