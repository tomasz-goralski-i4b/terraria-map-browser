import { createMapRenderer, terrariaMapPalette, type BlockFraming, type ChunkLayers, type RenderableWorld, type SpriteAtlasSource } from "@studio/renderer";
import type { Area } from "./area-clipboard.js";
import { BAND_BYTES, type ImageBand } from "./image-export.js";

/** Textures are drawn whole (without the map colour) from 7.5 pixels per tile (`SPRITE_FULL_ZOOM`). */
export const TEXTURED_MIN_SCALE = 8;
/** The largest side of the offscreen canvas a piece is drawn on. */
const PIECE_PIXELS = 2048;

export interface TexturedSprites {
  readonly atlas: SpriteAtlasSource;
  readonly framing: BlockFraming | null;
}

/**
 * The textured image of `area` (the game's sprites, as the map draws them up close), band by band: an offscreen WebGL2
 * renderer draws each band in pieces of at most `piece` pixels at `scale` pixels per tile, and each piece is read back.
 * Pieces start on tile boundaries, so a sprite that spills over its tile is drawn by every piece it reaches. Yields to
 * the event loop between pieces.
 */
export async function* texturedBands(
  world: RenderableWorld, area: Area, scale: number, layers: ChunkLayers, sprites: TexturedSprites, signal: AbortSignal,
  piece = PIECE_PIXELS,
): AsyncGenerator<ImageBand> {
  const width = area.width * scale;
  const pieceTiles = Math.max(1, Math.floor(piece / scale));
  const bandTiles = Math.max(1, Math.min(pieceTiles, Math.floor(BAND_BYTES / (width * 4 * scale))));
  const canvas = document.createElement("canvas");
  canvas.width = Math.min(area.width, pieceTiles) * scale;
  canvas.height = Math.min(area.height, bandTiles) * scale;
  let prepared = (): void => undefined;
  const ready = new Promise<void>((resolve) => { prepared = resolve; });
  const renderer = createMapRenderer(canvas, {
    mapPalette: terrariaMapPalette, prefetchChunks: 0, onSpritesPreparing: (preparing) => { if (!preparing) prepared(); },
  });
  try {
    const gl = canvas.getContext("webgl2");
    if (gl === null) throw new Error("WebGL2 is unavailable");
    renderer.setWorld(world);
    renderer.setLayers(layers);
    renderer.setAtlas(sprites.atlas);
    renderer.setFraming(sprites.framing);
    renderer.setSpriteMode(true);
    renderer.setCamera({ x: area.x, y: area.y, zoom: scale });
    renderer.render();
    // The sprite program links in the background; until then frames show map colours.
    if (renderer.stats().spritesPreparing) await ready;
    const read = new Uint8Array(canvas.width * canvas.height * 4);
    for (let top = 0; top < area.height; top += bandTiles) {
      const rows = Math.min(bandTiles, area.height - top) * scale;
      const pixels = new Uint8ClampedArray(width * rows * 4);
      for (let left = 0; left < area.width; left += pieceTiles) {
        signal.throwIfAborted();
        const columns = Math.min(pieceTiles, area.width - left) * scale;
        renderer.setCamera({ x: area.x + left, y: area.y + top, zoom: scale });
        renderer.render();
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, read);
        // readPixels rows are bottom-up.
        for (let y = 0; y < rows; y++) {
          const from = (canvas.height - 1 - y) * canvas.width * 4;
          pixels.set(read.subarray(from, from + columns * 4), (y * width + left * scale) * 4);
        }
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      yield { pixels, rows };
    }
  } finally {
    renderer.dispose();
  }
}
