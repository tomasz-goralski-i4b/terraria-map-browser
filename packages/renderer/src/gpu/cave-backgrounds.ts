// The underground backgrounds on the GPU (docs/assets.md, "Cave backgrounds"): the sheets of every style and the
// style of every block of the world in one integer texture, and the bands they are drawn in.
/// <reference lib="dom" />

import { CAVE_SLOTS, CAVE_STYLE_COUNT, caveBackgroundBands, caveBackgroundSheets, caveBackgroundStyles } from "../chunk/cave-backgrounds.js";
import { UNIT, bindTexture, integerTexture, type Counters, type GpuPart, type UnpackState } from "./gl.js";
import type { SpriteAtlas } from "./sprite-atlas.js";
import type { RenderableWorld } from "./types.js";

/** The uniforms of the sprite chunk program the backgrounds set (uCaves, uCaveBands in shaders.ts). */
export const CAVE_UNIFORMS = ["uCaves", "uCaveBands"] as const;

export interface CaveBackgrounds extends GpuPart {
  /**
   * Binds the backgrounds of `world` with the sheets of `atlas` and sets their uniforms; the texture is built once per
   * world and atlas. A world without the header's settings or a rock level has none.
   */
  readonly set: (
    uniforms: Readonly<Record<(typeof CAVE_UNIFORMS)[number], WebGLUniformLocation>>, world: RenderableWorld, atlas: SpriteAtlas,
  ) => void;
}

const NONE = new Int32Array([-1, 0, 0, 0, 0, 0, 0, 0, 0]);

export function createCaveBackgrounds(gl: WebGL2RenderingContext, unpack: UnpackState, counters: Counters): CaveBackgrounds {
  let texture: WebGLTexture | null = null;
  // What the texture holds: the world (whose styles are kept) and the atlas uploads it was built after.
  let built: { readonly world: RenderableWorld; readonly uploads: number; readonly bands: Int32Array } | null = null;
  let styles: { readonly world: RenderableWorld; readonly value: ReturnType<typeof caveBackgroundStyles> } | null = null;

  const releaseTexture = (): void => {
    if (texture !== null && !gl.isContextLost()) gl.deleteTexture(texture);
    texture = null;
    built = null;
  };

  /**
   * Rows 0 … CAVE_STYLE_COUNT - 1: per style and band its sheet (atlas page, x, y, width; width 0 without it); from
   * row CAVE_STYLE_COUNT on, the style of each block (`.r`).
   */
  const build = (world: RenderableWorld, atlas: SpriteAtlas): Int32Array => {
    // shortcut: the styles are kept per world object, so tile edits and header style edits show once the world is
    // opened again; recompute the edited blocks' windows when that matters.
    if (styles?.world !== world) styles = { world, value: caveBackgroundStyles(world) };
    const blocks = styles.value;
    const { caves, rockY } = world;
    if (blocks === null || caves === undefined || rockY === undefined) return NONE;
    const width = Math.max(CAVE_SLOTS, blocks.width);
    const texels = new Uint16Array(width * (CAVE_STYLE_COUNT + blocks.height) * 4);
    for (let style = 0; style < CAVE_STYLE_COUNT; style++) {
      caveBackgroundSheets(style, caves).forEach((id, slot) => {
        const sheet = id === 0 ? undefined : atlas.sheet("background", id);
        if (sheet !== undefined) texels.set([sheet.page, sheet.x, sheet.y, sheet.width], (style * width + slot) * 4);
      });
    }
    for (let by = 0; by < blocks.height; by++) {
      for (let bx = 0; bx < blocks.width; bx++) texels[((CAVE_STYLE_COUNT + by) * width + bx) * 4] = blocks.styles[by * blocks.width + bx] ?? 0;
    }
    unpack.reset();
    gl.activeTexture(gl.TEXTURE0 + UNIT.caves);
    texture = integerTexture(gl, gl.RGBA16UI, width, CAVE_STYLE_COUNT + blocks.height);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, width, CAVE_STYLE_COUNT + blocks.height, gl.RGBA_INTEGER, gl.UNSIGNED_SHORT, texels);
    counters.textureUploads++;
    const { bands, magmaTop } = caveBackgroundBands(world.surfaceY, rockY, world.height);
    return new Int32Array([...bands, magmaTop]);
  };

  return {
    set: (uniforms, world, atlas) => {
      if (built?.world !== world || built.uploads !== atlas.uploads()) {
        releaseTexture();
        built = { world, uploads: atlas.uploads(), bands: build(world, atlas) };
      }
      bindTexture(gl, UNIT.caves, gl.TEXTURE_2D, texture);
      gl.uniform1i(uniforms.uCaves, UNIT.caves);
      gl.uniform1iv(uniforms.uCaveBands, built.bands);
    },
    lost: () => {
      texture = null;
      built = null;
    },
    release: () => {
      releaseTexture();
      styles = null;
    },
  };
}
