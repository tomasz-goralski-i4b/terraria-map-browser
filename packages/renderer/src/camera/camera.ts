// Pure camera math: no WebGL, no DOM. Units are canvas (backing-store) pixels and tiles.

/** `x`/`y` are the (fractional) tile coordinates at the top-left corner of the viewport; `zoom` is pixels per tile. */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface ChunkCoord {
  readonly x: number;
  readonly y: number;
}

export const MIN_ZOOM: number = 1 / 8;
export const MAX_ZOOM = 256;
export const CHUNK_SIZE = 128;

export function clampZoom(zoom: number, minimum: number = MIN_ZOOM): number {
  return Math.min(MAX_ZOOM, Math.max(minimum, zoom));
}

/** Large/custom worlds can require a smaller scale than the usual wheel-zoom floor. */
function minimumZoom(viewport: Size, world: Size): number {
  const fit = Math.min(viewport.width / world.width, viewport.height / world.height);
  // An empty viewport (before layout) or empty world has no meaningful fit; keep the usual floor.
  return fit > 0 && Number.isFinite(fit) ? Math.min(MIN_ZOOM, fit) : MIN_ZOOM;
}

/** Fractional tile coordinates under a screen pixel. */
export function screenToTile(camera: Camera, screenX: number, screenY: number): { readonly x: number; readonly y: number } {
  return { x: camera.x + screenX / camera.zoom, y: camera.y + screenY / camera.zoom };
}

export function tileToScreen(camera: Camera, tileX: number, tileY: number): { readonly x: number; readonly y: number } {
  return { x: (tileX - camera.x) * camera.zoom, y: (tileY - camera.y) * camera.zoom };
}

/** One axis: centred when the world fits in the viewport, otherwise the viewport stays inside the world. */
function clampAxis(start: number, viewportTiles: number, worldTiles: number): number {
  if (worldTiles <= viewportTiles) return (worldTiles - viewportTiles) / 2;
  return Math.min(worldTiles - viewportTiles, Math.max(0, start));
}

/**
 * Keeps the world on screen: an axis whose world extent fits the viewport is centred, otherwise the viewport stays
 * inside the world.
 */
export function clampCamera(camera: Camera, viewport: Size, world: Size): Camera {
  return {
    x: clampAxis(camera.x, viewport.width / camera.zoom, world.width),
    y: clampAxis(camera.y, viewport.height / camera.zoom, world.height),
    zoom: camera.zoom,
  };
}

/** Moves the view by a screen-pixel drag delta (content follows the pointer), then clamps. */
export function panBy(camera: Camera, deltaX: number, deltaY: number, viewport: Size, world: Size): Camera {
  return clampCamera({ ...camera, x: camera.x - deltaX / camera.zoom, y: camera.y - deltaY / camera.zoom }, viewport, world);
}

/** Sets zoom within the world-fit floor and MAX_ZOOM, keeping the tile under the screen point fixed, then clamps. */
export function zoomAt(camera: Camera, zoom: number, screenX: number, screenY: number, viewport: Size, world: Size): Camera {
  // A camera already below the floor (the viewport grew since it was fitted) may stay there: zooming out must not zoom in.
  const next = clampZoom(zoom, Math.min(minimumZoom(viewport, world), camera.zoom));
  const tile = screenToTile(camera, screenX, screenY);
  return clampCamera({ x: tile.x - screenX / next, y: tile.y - screenY / next, zoom: next }, viewport, world);
}

/** Whole world visible and centred, at the largest zoom that fits, including custom world sizes. */
export function fitWorld(viewport: Size, world: Size): Camera {
  const zoom = clampZoom(Math.min(viewport.width / world.width, viewport.height / world.height), minimumZoom(viewport, world));
  return clampCamera({ x: 0, y: 0, zoom }, viewport, world);
}

/** One screen pixel per tile, keeping the tile at the viewport centre. */
export function actualSize(camera: Camera, viewport: Size, world: Size): Camera {
  return zoomAt(camera, 1, viewport.width / 2, viewport.height / 2, viewport, world);
}

/** Chunks intersecting the viewport, clipped to the world's chunk grid, ordered by y then x. */
export function visibleChunks(camera: Camera, viewport: Size, world: Size): ChunkCoord[] {
  const chunksX = Math.ceil(world.width / CHUNK_SIZE);
  const chunksY = Math.ceil(world.height / CHUNK_SIZE);
  const firstX = Math.max(0, Math.floor(camera.x / CHUNK_SIZE));
  const firstY = Math.max(0, Math.floor(camera.y / CHUNK_SIZE));
  const lastX = Math.min(chunksX - 1, Math.ceil((camera.x + viewport.width / camera.zoom) / CHUNK_SIZE) - 1);
  const lastY = Math.min(chunksY - 1, Math.ceil((camera.y + viewport.height / camera.zoom) / CHUNK_SIZE) - 1);
  const chunks: ChunkCoord[] = [];
  for (let y = firstY; y <= lastY; y++) {
    for (let x = firstX; x <= lastX; x++) chunks.push({ x, y });
  }
  return chunks;
}
