// Minimap geometry: the whole world drawn small, and where the camera's view sits on it. Pure math, like camera.ts.
import type { Camera, Size } from "./camera.js";

export interface MinimapRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Pixels of a minimap that fits `maxWidth` × `maxHeight` with the world's aspect ratio, at most one pixel per tile. */
export function minimapSize(world: Size, maxWidth: number, maxHeight: number): Size {
  const scale = Math.min(maxWidth / world.width, maxHeight / world.height, 1);
  return { width: Math.max(1, Math.round(world.width * scale)), height: Math.max(1, Math.round(world.height * scale)) };
}

/** The visible tile range of `camera` in minimap pixels, clamped to the minimap. */
export function minimapViewRect(camera: Camera, viewport: Size, world: Size, minimap: Size): MinimapRect {
  const scaleX = minimap.width / world.width;
  const scaleY = minimap.height / world.height;
  const left = Math.max(0, camera.x), top = Math.max(0, camera.y);
  const right = Math.min(world.width, camera.x + viewport.width / camera.zoom);
  const bottom = Math.min(world.height, camera.y + viewport.height / camera.zoom);
  return {
    x: left * scaleX, y: top * scaleY,
    width: Math.max(0, right - left) * scaleX, height: Math.max(0, bottom - top) * scaleY,
  };
}

/** The fractional tile under a point of the minimap (in the minimap's pixels). */
export function minimapTile(x: number, y: number, world: Size, minimap: Size): { readonly x: number; readonly y: number } {
  return { x: x * world.width / minimap.width, y: y * world.height / minimap.height };
}
