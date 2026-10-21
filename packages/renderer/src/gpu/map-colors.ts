// The map colour inputs of the tile colour function: the palette texture (block and wall colours by palette index),
// the map option rules, and the background colours by row with the paint colours.
/// <reference lib="dom" />

import type { ContentRef } from "@studio/world-model";
import { WIRE_ALPHA, WIRE_COLORS } from "../chunk/render.js";
import { backgroundColor, contentColor, liquidColors, type MapPalette } from "../palette/map-palette.js";
import { UNIT, bindTexture, integerTexture, type Counters, type GpuPart, type UnpackState } from "./gl.js";
import { PRESENT, RULE_HEADER_ROWS, RULE_ROW } from "./shaders.js";
import type { RenderableWorld } from "./types.js";

export const PALETTE_ROW = 256;
const PALETTE_WIDTH = PALETTE_ROW * 2;
export const PALETTE_CAPACITY = 0xffff;
const PALETTE_HEIGHT = PALETTE_ROW;

/** The uniforms of the tile colour function (tileColorSource), shared by the chunk passes and the overview build. */
export const TILE_UNIFORMS = [
  "uPlanes16", "uPlanes8", "uPresent", "uPalette", "uBackground", "uRules", "uPaintRow", "uPaintCount", "uPaletteLength",
  "uLayers", "uLiquids",
] as const;
/** The wire overlay's uniforms: the map program and the overview build pass draw it, in sprite mode the wire pass does. */
export const OVERLAY_UNIFORMS = ["uWireColors", "uWireBits", "uWireAlpha"] as const;

const wireColorUniform = new Int32Array(WIRE_COLORS.flatMap(([, color]) => [...color]));
const wireBitUniform = new Int32Array(WIRE_COLORS.map(([bit]) => bit));

/** Sets the wire overlay's uniforms (the map program, the overview build and the wire pass). */
export function setWireUniforms(
  gl: WebGL2RenderingContext, uniforms: Readonly<Record<(typeof OVERLAY_UNIFORMS)[number], WebGLUniformLocation>>,
): void {
  gl.uniform3iv(uniforms.uWireColors, wireColorUniform);
  gl.uniform1iv(uniforms.uWireBits, wireBitUniform);
  gl.uniform1i(uniforms.uWireAlpha, WIRE_ALPHA);
}

/**
 * The map option rules of a map palette, for the rules texture: the ranges of every ruled tile ID, and where they are.
 */
interface RuleTable {
  /** (from, to, colour, 0) per range, RGBA32I, RULE_ROW per row. */
  readonly ranges: Int32Array;
  readonly rows: number;
  /** By tile ID: (first range, range count, axis, colour of option 0), the header of each palette entry with that ID. */
  readonly headers: ReadonlyMap<number, readonly [number, number, number, number]>;
}

/**
 * The rules of every tile ID with a frame → option rule and map colours, in ID order: each range carries the colour
 * of its option (`optionColor`: an option the ID lacks falls back to option 0), each header the colour of option 0,
 * which a frame outside every range selects (`mapOption`).
 */
function ruleTable(mapPalette: MapPalette | undefined): RuleTable {
  const headers = new Map<number, readonly [number, number, number, number]>();
  const ranges: number[] = [];
  const entries = Object.entries(mapPalette?.tileOptions ?? {}).map(([id, rule]) => [Number(id), rule] as const);
  for (const [id, rule] of entries.sort(([first], [second]) => first - second)) {
    const colors = mapPalette?.tiles[id];
    const fallback = colors?.[0];
    if (colors === undefined || fallback === undefined) continue;
    headers.set(id, [ranges.length / 4, rule.ranges.length, rule.axis === "frameX" ? 0 : 1, fallback]);
    for (const [from, to, option] of rule.ranges) ranges.push(from, to, colors[option] ?? fallback, 0);
  }
  const rows = Math.ceil(ranges.length / 4 / RULE_ROW);
  const padded = new Int32Array(rows * RULE_ROW * 4);
  padded.set(ranges);
  return { ranges: padded, rows, headers };
}

export interface MapColors extends GpuPart {
  /** Palette entries uploaded for the current world. */
  readonly uploaded: () => number;
  /**
   * Uploads the entries appended to `palette` since the last call (colours and rule headers, one texture upload);
   * returns the range of new indices, empty when nothing was appended.
   */
  readonly upload: (palette: readonly ContentRef[]) => readonly [from: number, to: number];
  /** Uploads the background colours of `world` (once per world). */
  readonly uploadBackground: (world: RenderableWorld) => void;
  /** The world changed: its palette is uploaded again from the start and its background dropped. */
  readonly setWorld: () => void;
  /** Sets the tile colour function's uniforms and binds its textures. */
  readonly setTileUniforms: (
    uniforms: Readonly<Record<(typeof TILE_UNIFORMS)[number], WebGLUniformLocation>>, layers: number, present: number,
  ) => void;
}

export function createMapColors(
  gl: WebGL2RenderingContext, unpack: UnpackState, counters: Counters, mapPalette: MapPalette | undefined,
): MapColors {
  const rules = ruleTable(mapPalette);
  // The four liquid kinds (CWM kinds 1–4) as the shader's ivec3 array.
  const liquidUniform = new Int32Array(liquidColors(mapPalette).slice(1).flatMap(([red, green, blue]) => [red, green, blue]));
  const paintCount = mapPalette === undefined ? 0 : Math.min(PALETTE_ROW, mapPalette.paints.length);
  const paletteMirror = new Uint8Array(PALETTE_WIDTH * PALETTE_HEIGHT * 4);
  // Rule headers by palette index, written only with a palette that has rules (the texture starts zeroed: no rule).
  const ruleHeaders = rules.headers.size === 0 ? null : new Int32Array(RULE_ROW * RULE_HEADER_ROWS * 4);
  let palette: WebGLTexture | null = null;
  let rulesTexture: WebGLTexture | null = null;
  let uploaded = 0;
  // Per-row background colours plus the paint row, for the world they were computed for.
  let background: { readonly texture: WebGLTexture; readonly world: RenderableWorld; readonly paintRow: number } | null = null;

  /** The palette and rules textures, created on first use (the rules' ranges uploaded once). */
  const textures = (): { palette: WebGLTexture; rules: WebGLTexture } => {
    if (palette === null || rulesTexture === null) {
      unpack.reset();
      gl.activeTexture(gl.TEXTURE0 + UNIT.rules);
      rulesTexture = integerTexture(gl, gl.RGBA32I, RULE_ROW, RULE_HEADER_ROWS + rules.rows);
      if (rules.rows > 0) {
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, RULE_HEADER_ROWS, RULE_ROW, rules.rows, gl.RGBA_INTEGER, gl.INT, rules.ranges);
      }
      gl.activeTexture(gl.TEXTURE0 + UNIT.palette);
      palette = integerTexture(gl, gl.RGBA8UI, PALETTE_WIDTH, PALETTE_HEIGHT);
    }
    return { palette, rules: rulesTexture };
  };

  const releaseBackground = (): void => {
    if (background !== null && !gl.isContextLost()) gl.deleteTexture(background.texture);
    background = null;
  };

  return {
    uploaded: () => uploaded,
    upload: (entries) => {
      const from = uploaded;
      const total = Math.min(entries.length, PALETTE_CAPACITY);
      if (total <= from) return [from, from];
      for (let index = from; index < total; index++) {
        const ref = entries[index];
        if (ref === undefined) break;
        const row = Math.floor(index / PALETTE_ROW);
        const column = index % PALETTE_ROW;
        paletteMirror.set(contentColor(ref, "block", mapPalette), (row * PALETTE_WIDTH + column) * 4);
        paletteMirror.set(contentColor(ref, "wall", mapPalette), (row * PALETTE_WIDTH + PALETTE_ROW + column) * 4);
        ruleHeaders?.set((ref.kind === "vanilla" ? rules.headers.get(ref.id) : undefined) ?? [0, 0, 0, 0], index * 4);
      }
      const firstRow = Math.floor(from / PALETTE_ROW);
      const lastRow = Math.floor((total - 1) / PALETTE_ROW);
      const { palette: paletteTexture, rules: rulesTex } = textures();
      unpack.reset();
      bindTexture(gl, UNIT.palette, gl.TEXTURE_2D, paletteTexture);
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, PALETTE_WIDTH);
      // Only the appended entries: a partial first/last row is cut at the entry, in both colour halves.
      for (let row = firstRow; row <= lastRow; row++) {
        const start = row === firstRow ? from % PALETTE_ROW : 0;
        const end = row === lastRow ? ((total - 1) % PALETTE_ROW) + 1 : PALETTE_ROW;
        for (const half of [0, PALETTE_ROW]) {
          gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, half + start);
          gl.pixelStorei(gl.UNPACK_SKIP_ROWS, row);
          gl.texSubImage2D(
            gl.TEXTURE_2D, 0, half + start, row, end - start, 1, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, paletteMirror,
          );
        }
      }
      gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0);
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      if (ruleHeaders !== null) {
        // Whole rows: headers of a previous world's palette are overwritten with this one's.
        bindTexture(gl, UNIT.rules, gl.TEXTURE_2D, rulesTex);
        gl.texSubImage2D(
          gl.TEXTURE_2D, 0, 0, firstRow, RULE_ROW, lastRow - firstRow + 1, gl.RGBA_INTEGER, gl.INT,
          ruleHeaders.subarray(firstRow * RULE_ROW * 4),
        );
      }
      counters.textureUploads++;
      uploaded = total;
      return [from, total];
    },
    /**
     * Background colour of every world row, resolved on the CPU by the same `backgroundColor` as `renderChunk` (so the
     * GPU output is exact), 256 rows per texture row; the last texture row holds the paint colours by paint ID.
     */
    uploadBackground: (source) => {
      if (background?.world === source) return;
      releaseBackground();
      const paintRow = Math.ceil(source.height / PALETTE_ROW);
      unpack.reset();
      const texels = new Uint8Array(PALETTE_ROW * (paintRow + 1) * 4);
      const depth = { surfaceY: source.surfaceY, height: source.height, ...(source.rockY === undefined ? {} : { rockY: source.rockY }) };
      for (let y = 0; y < source.height; y++) texels.set(backgroundColor(y, depth, mapPalette), y * 4);
      for (let paint = 0; paint < paintCount; paint++) {
        const color = mapPalette?.paints[paint] ?? 0;
        texels.set([(color >>> 16) & 0xff, (color >>> 8) & 0xff, color & 0xff, 255], (paintRow * PALETTE_ROW + paint) * 4);
      }
      gl.activeTexture(gl.TEXTURE0 + UNIT.background);
      const texture = integerTexture(gl, gl.RGBA8UI, PALETTE_ROW, paintRow + 1);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, PALETTE_ROW, paintRow + 1, gl.RGBA_INTEGER, gl.UNSIGNED_BYTE, texels);
      counters.textureUploads++;
      background = { texture, world: source, paintRow };
    },
    setWorld: () => {
      uploaded = 0;
      // Also drops the reference that would keep the previous world's planes alive.
      releaseBackground();
    },
    setTileUniforms: (uniforms, layers, present) => {
      const { palette: paletteTexture, rules: rulesTex } = textures();
      gl.uniform1i(uniforms.uPlanes16, UNIT.planes16);
      gl.uniform1i(uniforms.uPlanes8, UNIT.planes8);
      gl.uniform1i(uniforms.uPresent, present);
      gl.uniform1i(uniforms.uPalette, UNIT.palette);
      gl.uniform1i(uniforms.uBackground, UNIT.background);
      gl.uniform1i(uniforms.uRules, UNIT.rules);
      gl.uniform1i(uniforms.uPaletteLength, uploaded);
      gl.uniform1i(uniforms.uLayers, layers);
      gl.uniform3iv(uniforms.uLiquids, liquidUniform);
      gl.uniform1i(uniforms.uPaintRow, background?.paintRow ?? 0);
      gl.uniform1i(uniforms.uPaintCount, paintCount);
      bindTexture(gl, UNIT.palette, gl.TEXTURE_2D, paletteTexture);
      bindTexture(gl, UNIT.background, gl.TEXTURE_2D, background?.texture ?? null);
      bindTexture(gl, UNIT.rules, gl.TEXTURE_2D, rulesTex);
    },
    lost: () => {
      palette = null;
      rulesTexture = null;
      background = null;
      uploaded = 0;
    },
    release: () => {
      if (palette !== null) gl.deleteTexture(palette);
      if (rulesTexture !== null) gl.deleteTexture(rulesTexture);
      palette = null;
      rulesTexture = null;
      releaseBackground();
      uploaded = 0;
    },
  };
}

/** Whether `present` (PRESENT bits) holds the flags plane, which the wire overlay reads. */
export const hasFlags = (present: number): boolean => (present & PRESENT.flags) !== 0;
