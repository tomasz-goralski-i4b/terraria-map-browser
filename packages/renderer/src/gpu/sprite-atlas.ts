// The sprite atlas on the GPU: its pages, their half-resolution copy, the sheet lookup by palette index, and the
// uniforms every sprite pass samples them with.
/// <reference lib="dom" />

import type { ContentRef } from "@studio/world-model";
import { LIQUID_SHEETS } from "../chunk/liquids.js";
import { DRAWN_TILES } from "../objects/draw-offsets.js";
import { OBJECT_TILES } from "../objects/object-sprites.js";
import { TRACK_TILE } from "../objects/tracks.js";
import { paintGroupOf } from "../palette/sprite-paint.js";
import { terrariaPaintGroups } from "../palette/terraria-paint-groups.generated.js";
import { SPRITE_FRAME_WRAPS } from "./frame-wrap.js";
import {
  UNIT, arrayTexture, bindTexture, integerTexture, requireValue, type GpuPart, type ProgramCache, type ProgramSource,
  type UnpackState,
} from "./gl.js";
import { PALETTE_ROW } from "./map-colors.js";
import {
  LIQUID_FLAT, PAINT_GROUP_LIMIT, SPRITE_SHEET_ROW, SPRITE_SHEET_TEXELS, SPRITE_STATE, halfAtlasFragmentSource,
  halfAtlasVertexSource, spriteSampling,
} from "./shaders.js";
import type { SpriteAtlasSource, SpriteSheetEntry } from "./types.js";

/** Texels per row of the sprite sheet lookup: six per palette index (SPRITE_SHEET_ROW in shaders.ts). */
const SPRITE_SHEET_WIDTH = SPRITE_SHEET_ROW * SPRITE_SHEET_TEXELS;

const HALF_ATLAS_PROGRAM: ProgramSource<"uAtlas" | "uPage"> = {
  vertex: halfAtlasVertexSource, fragment: halfAtlasFragmentSource, uniforms: ["uAtlas", "uPage"],
};

/** The uniforms every pass that samples sprites has (spritePassInputs, the sprite chunk program). */
export const SAMPLING_UNIFORMS = ["uAtlas", "uAtlasHalf", "uSpriteSamples", "uSpriteStep", "uSpriteLevel", "uSpriteWeight"] as const;
export const PAINT_GROUP_UNIFORMS = ["uPaintGroupRanges", "uPaintGroupModes"] as const;

// The special groups paint is applied with (shaders' uPaintGroupRanges and uPaintGroupModes).
if (terrariaPaintGroups.groups.length > PAINT_GROUP_LIMIT) throw new Error("More special paint groups than the shaders hold");
const paintGroupRanges = new Float32Array(PAINT_GROUP_LIMIT * 4);
const paintGroupModes = new Float32Array(PAINT_GROUP_LIMIT * 2);
terrariaPaintGroups.groups.forEach(([minHue, maxHue, minSaturation, maxSaturation, offset, invert], index) => {
  paintGroupRanges.set([minHue, maxHue, minSaturation, maxSaturation], index * 4);
  paintGroupModes.set([offset, invert], index * 2);
});

export function setPaintGroups(
  gl: WebGL2RenderingContext, uniforms: Readonly<Record<(typeof PAINT_GROUP_UNIFORMS)[number], WebGLUniformLocation>>,
): void {
  gl.uniform4fv(uniforms.uPaintGroupRanges, paintGroupRanges);
  gl.uniform2fv(uniforms.uPaintGroupModes, paintGroupModes);
}

export interface SpriteAtlas extends GpuPart {
  /** Whether atlas pages are on the GPU. */
  readonly ready: () => boolean;
  /** Atlas uploads since creation. */
  readonly uploads: () => number;
  /** Puts `source` on the GPU (null removes it) and rewrites the sheets of palette indices 0 … `paletteLength` - 1. */
  readonly apply: (source: SpriteAtlasSource | null, palette: readonly ContentRef[], paletteLength: number) => void;
  /** Writes the sheets of palette indices `from` … `to` - 1 into the lookup (after a palette append). */
  readonly uploadSheets: (palette: readonly ContentRef[], from: number, to: number) => void;
  /** A sheet by kind and id. */
  readonly sheet: (kind: SpriteSheetEntry["kind"], id: number) => SpriteSheetEntry | undefined;
  /** (page, x, y, 1) of the first sheet of `kind`, or zeros without it: the wire pieces, the actuator. */
  readonly place: (kind: SpriteSheetEntry["kind"]) => Int32Array;
  /** uLiquidSheets: per liquid kind 1–4 the atlas page, x, y of its sheet and 1 when it is drawn from it (LIQUID_FLAT: flat). */
  readonly liquidSheets: () => Int32Array;
  /** Binds the atlas, its half and the sheet lookup and sets the sampling uniforms for `zoom`. */
  readonly setSampling: (
    uniforms: Readonly<Record<(typeof SAMPLING_UNIFORMS)[number], WebGLUniformLocation>>, zoom: number,
  ) => void;
  /** Binds the sheet lookup to its unit. */
  readonly bindSheets: () => void;
}

export function createSpriteAtlas(gl: WebGL2RenderingContext, unpack: UnpackState, programs: ProgramCache): SpriteAtlas {
  const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  let atlasTexture: WebGLTexture | null = null;
  // The atlas pages at half resolution (halfAtlasFragmentSource), read by sprite samples from 8 pixels per tile down.
  let atlasHalfTexture: WebGLTexture | null = null;
  // The tile and wall sheets of each palette index (SPRITE_SHEET_ROW in shaders.ts); all zero without an atlas.
  let sheetsTexture: WebGLTexture | null = null;
  const sheetMirror = new Int32Array(SPRITE_SHEET_WIDTH * PALETTE_ROW * 4);
  let tileSheets = new Map<number, SpriteSheetEntry>();
  let wallSheets = new Map<number, SpriteSheetEntry>();
  // Every sheet of the atlas by kind and id (`${kind}:${id}`), for the object pass and the wire pass.
  let sheetsByKey = new Map<string, SpriteSheetEntry>();
  let liquidSheets: Int32Array = new Int32Array(16);
  let uploads = 0;

  const sheetsTex = (): WebGLTexture => {
    if (sheetsTexture === null) {
      gl.activeTexture(gl.TEXTURE0 + UNIT.spriteSheets);
      sheetsTexture = integerTexture(gl, gl.RGBA32I, SPRITE_SHEET_WIDTH, PALETTE_ROW);
    }
    return sheetsTexture;
  };

  /**
   * Writes the sheets of palette indices `from` … `to` - 1 into the lookup (whole rows). With an atlas, an index whose
   * content has a tile sheet gets its place and frame size, deferred content (trees) the map colour, and any other
   * (newer than the install, mod, unknown) the missing-texture state; the shader only uses it for blocks with a
   * stored frame or a framed cell. Its wall sheet likewise, for walls with a framed cell. Without an atlas every index
   * has the map colour.
   */
  const uploadSheets = (palette: readonly ContentRef[], from: number, to: number): void => {
    if (to <= from) return;
    for (let index = from; index < to; index++) {
      const ref = palette[index];
      const vanilla = ref?.kind === "vanilla" ? ref.id : undefined;
      const sheet = vanilla === undefined ? undefined : tileSheets.get(vanilla);
      const at = (Math.floor(index / SPRITE_SHEET_ROW) * SPRITE_SHEET_WIDTH + (index % SPRITE_SHEET_ROW) * SPRITE_SHEET_TEXELS) * 4;
      const absent = atlasTexture === null ? SPRITE_STATE.mapColor : SPRITE_STATE.missing;
      if (sheet !== undefined) {
        // Tracks store piece indices, not sheet offsets (docs/assets.md, "Minecart tracks"); trees and the giant
        // mushroom are drawn by the object pass ("Trees").
        const state = vanilla === TRACK_TILE
          ? SPRITE_STATE.track
          : vanilla !== undefined && (OBJECT_TILES.has(vanilla) || DRAWN_TILES.has(vanilla)) ? SPRITE_STATE.object : SPRITE_STATE.sheet;
        sheetMirror.set([sheet.page, sheet.x, sheet.y, state, sheet.width, sheet.height, sheet.frameWidth, sheet.frameHeight], at);
      } else {
        sheetMirror.set([0, 0, 0, absent, 0, 0, 0, 0], at);
      }
      const wallSheet = vanilla === undefined ? undefined : wallSheets.get(vanilla);
      sheetMirror.set(wallSheet === undefined ? [0, 0, 0, absent, 0, 0, 0, 0] : [
        wallSheet.page, wallSheet.x, wallSheet.y, SPRITE_STATE.sheet, wallSheet.width, wallSheet.height,
        wallSheet.frameWidth, wallSheet.frameHeight,
      ], at + 8);
      const wrap = vanilla === undefined ? undefined : SPRITE_FRAME_WRAPS.get(vanilla);
      sheetMirror.set(wrap === undefined ? [0, 0, 0, 0] : wrap.axis === "x"
        ? [wrap.period, wrap.shift, 0, 0]
        : [0, 0, wrap.period, wrap.shift], at + 16);
      // The special group its sprites are painted with (grass, dirt, mud).
      sheetMirror.set([vanilla === undefined ? 0 : paintGroupOf("tile", vanilla), 0, 0, 0], at + 20);
    }
    const firstRow = Math.floor(from / SPRITE_SHEET_ROW);
    const lastRow = Math.floor((to - 1) / SPRITE_SHEET_ROW);
    unpack.reset();
    bindTexture(gl, UNIT.spriteSheets, gl.TEXTURE_2D, sheetsTex());
    gl.texSubImage2D(
      gl.TEXTURE_2D, 0, 0, firstRow, SPRITE_SHEET_WIDTH, lastRow - firstRow + 1, gl.RGBA_INTEGER, gl.INT,
      sheetMirror.subarray(firstRow * SPRITE_SHEET_WIDTH * 4),
    );
  };

  /** Draws the half-resolution copy of the atlas pages in `pages` (one pass per page) into a new texture. */
  const halfAtlas = (pages: WebGLTexture, pageSize: number, pageCount: number): WebGLTexture => {
    const size = Math.ceil(pageSize / 2);
    gl.activeTexture(gl.TEXTURE0 + UNIT.atlasHalf);
    const texture = arrayTexture(gl, gl.RGBA8UI, size, pageCount);
    const program = programs.get(HALF_ATLAS_PROGRAM);
    gl.useProgram(program.program);
    bindTexture(gl, UNIT.atlas, gl.TEXTURE_2D_ARRAY, pages);
    gl.uniform1i(program.uniforms.uAtlas, UNIT.atlas);
    const framebuffer = requireValue(gl.createFramebuffer(), "a framebuffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.viewport(0, 0, size, size);
    gl.bindVertexArray(null);
    for (let layer = 0; layer < pageCount; layer++) {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, texture, 0, layer);
      gl.uniform1i(program.uniforms.uPage, layer);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(framebuffer);
    return texture;
  };

  /** Uploads the atlas pages as one RGBA8 array texture, one layer per page. */
  const uploadAtlas = (source: SpriteAtlasSource): void => {
    const { pageSize } = source.index;
    const pageCount = Math.max(1, source.pages.length);
    if (pageSize > maxTextureSize || pageCount > (gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number)) {
      throw new Error(`This GPU cannot hold a sprite atlas of ${String(pageCount)} pages of ${String(pageSize)} pixels`);
    }
    unpack.reset();
    gl.activeTexture(gl.TEXTURE0 + UNIT.atlas);
    const texture = arrayTexture(gl, gl.RGBA8, pageSize, pageCount);
    source.pages.forEach((page, layer) => {
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, pageSize, pageSize, 1, gl.RGBA, gl.UNSIGNED_BYTE, page);
    });
    atlasTexture = texture;
    atlasHalfTexture = halfAtlas(texture, pageSize, pageCount);
    uploads++;
  };

  const releaseAtlas = (): void => {
    if (!gl.isContextLost()) {
      if (atlasTexture !== null) gl.deleteTexture(atlasTexture);
      if (atlasHalfTexture !== null) gl.deleteTexture(atlasHalfTexture);
    }
    atlasTexture = null;
    atlasHalfTexture = null;
  };

  const place = (kind: SpriteSheetEntry["kind"]): Int32Array => {
    const entry = sheetsByKey.get(`${kind}:0`);
    return new Int32Array(entry === undefined ? [0, 0, 0, 0] : [entry.page, entry.x, entry.y, 1]);
  };

  return {
    ready: () => atlasTexture !== null,
    uploads: () => uploads,
    apply: (source, palette, paletteLength) => {
      releaseAtlas();
      tileSheets = new Map(source?.index.entries.filter((entry) => entry.kind === "tile").map((entry) => [entry.id, entry]));
      wallSheets = new Map(source?.index.entries.filter((entry) => entry.kind === "wall").map((entry) => [entry.id, entry]));
      sheetsByKey = new Map(source?.index.entries.map((entry) => [`${entry.kind}:${String(entry.id)}`, entry]));
      liquidSheets = new Int32Array(LIQUID_SHEETS.flatMap((id) => {
        if (id === null) return [0, 0, 0, LIQUID_FLAT];
        const entry = sheetsByKey.get(`liquid:${String(id)}`);
        return entry === undefined ? [0, 0, 0, 0] : [entry.page, entry.x, entry.y, 1];
      }));
      if (source !== null) uploadAtlas(source);
      uploadSheets(palette, 0, paletteLength);
    },
    uploadSheets,
    sheet: (kind, id) => sheetsByKey.get(`${kind}:${String(id)}`),
    place,
    liquidSheets: () => liquidSheets,
    setSampling: (uniforms, zoom) => {
      bindTexture(gl, UNIT.atlas, gl.TEXTURE_2D_ARRAY, atlasTexture);
      bindTexture(gl, UNIT.atlasHalf, gl.TEXTURE_2D_ARRAY, atlasHalfTexture);
      gl.uniform1i(uniforms.uAtlas, UNIT.atlas);
      gl.uniform1i(uniforms.uAtlasHalf, UNIT.atlasHalf);
      const sampling = spriteSampling(zoom);
      gl.uniform1i(uniforms.uSpriteSamples, sampling.samples);
      gl.uniform1f(uniforms.uSpriteStep, sampling.step);
      gl.uniform1i(uniforms.uSpriteLevel, sampling.level);
      gl.uniform1i(uniforms.uSpriteWeight, sampling.weight);
    },
    bindSheets: () => { bindTexture(gl, UNIT.spriteSheets, gl.TEXTURE_2D, sheetsTex()); },
    lost: () => {
      atlasTexture = null;
      atlasHalfTexture = null;
      sheetsTexture = null;
    },
    release: () => {
      releaseAtlas();
      if (sheetsTexture !== null) gl.deleteTexture(sheetsTexture);
      sheetsTexture = null;
    },
  };
}
