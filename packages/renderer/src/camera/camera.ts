/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-inferrable-types -- red-phase stubs and isolatedDeclarations annotations; remove the first rule when implemented */
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
export const MAX_ZOOM: number = 16;
export const CHUNK_SIZE: number = 128;

export function clampZoom(_zoom: number): number {
  throw new Error("not implemented");
}

/** Fractional tile coordinates under a screen pixel. */
export function screenToTile(_camera: Camera, _screenX: number, _screenY: number): { readonly x: number; readonly y: number } {
  throw new Error("not implemented");
}

export function tileToScreen(_camera: Camera, _tileX: number, _tileY: number): { readonly x: number; readonly y: number } {
  throw new Error("not implemented");
}

/**
 * Keeps the world on screen: an axis whose world extent fits the viewport is centred, otherwise the viewport stays
 * inside the world.
 */
export function clampCamera(_camera: Camera, _viewport: Size, _world: Size): Camera {
  throw new Error("not implemented");
}

/** Moves the view by a screen-pixel drag delta (content follows the pointer), then clamps. */
export function panBy(_camera: Camera, _deltaX: number, _deltaY: number, _viewport: Size, _world: Size): Camera {
  throw new Error("not implemented");
}

/** Sets the zoom (clamped to MIN_ZOOM…MAX_ZOOM) keeping the tile under the screen point fixed, then clamps. */
export function zoomAt(_camera: Camera, _zoom: number, _screenX: number, _screenY: number, _viewport: Size, _world: Size): Camera {
  throw new Error("not implemented");
}

/** Whole world visible and centred, at the largest zoom that fits (never below MIN_ZOOM). */
export function fitWorld(_viewport: Size, _world: Size): Camera {
  throw new Error("not implemented");
}

/** One screen pixel per tile, keeping the tile at the viewport centre. */
export function actualSize(_camera: Camera, _viewport: Size, _world: Size): Camera {
  throw new Error("not implemented");
}

/** Chunks intersecting the viewport, clipped to the world's chunk grid, ordered by y then x. */
export function visibleChunks(_camera: Camera, _viewport: Size, _world: Size): ChunkCoord[] {
  throw new Error("not implemented");
}
