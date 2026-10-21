import type { ContentRef } from "@studio/world-model";
import type { TreeSettings } from "../objects/object-sprites.js";

/** The slice of a world the renderer reads. Planes are column-major (`x * height + y`); never copied by the caller. */
export interface RenderableWorld {
  readonly width: number;
  readonly height: number;
  /** The world's surface level: the sky is above it. */
  readonly surfaceY: number;
  /** The world's rock level; without one the dirt layer reaches the underworld (only drawn with a map palette). */
  readonly rockY?: number;
  readonly planes: {
    readonly block: Uint16Array;
    readonly wall: Uint16Array;
    readonly liquid: Uint8Array;
    readonly liquidAmount: Uint8Array;
    readonly paint: Uint8Array;
    readonly wallPaint: Uint8Array;
    /**
     * Frame planes pick the map option of multi-option content; absent planes mean frame 0 everywhere. They are
     * uploaded as their 16-bit pattern (through a Uint16Array view of the same memory) and sign-extended on the GPU.
     */
    readonly frameX?: Int16Array;
    readonly frameY?: Int16Array;
    /** CWM flags; only the wire and actuator bits (0–4) are read, for the wire overlay. Absent means none. */
    readonly flags?: Uint16Array;
    /** Block shapes (0 full, 1 half, 2–5 slopes): framing and drawing of self-framed blocks. Absent means all full. */
    readonly shape?: Uint8Array;
  };
  /** Append-only palette. */
  readonly palette: readonly ContentRef[];
  /** The world header's tree-style zones and tree top variations (docs/assets.md, "Trees"); without them all are 0. */
  readonly trees?: TreeSettings;
}

/** One sheet of a sprite atlas: where it lies on its page and the size of its frame cells (docs/assets.md, "Atlas"). */
export interface SpriteSheetEntry {
  readonly kind: "tile" | "wall" | "treeTop" | "treeBranch" | "shroomTop" | "wire" | "actuator" | "item" | "liquid" | "liquidSlope" | "waterfall"
    | "water" | "wallGlow";
  readonly id: number;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
}

/**
 * A sprite atlas as the renderer reads it: square RGBA8 pages (`pageSize² × 4` bytes, straight alpha) and the sheets
 * on them. `@studio/assets`' `SpriteAtlas` has this shape.
 */
export interface SpriteAtlasSource {
  readonly pages: readonly Uint8Array[];
  readonly index: { readonly pageSize: number; readonly entries: readonly SpriteSheetEntry[] };
}

export interface MapAnnotations {
  /** Nine floats per primitive: from x/y, to x/y, RGB (0–1), CSS width, kind (0 stroke, 1 handle, 2 tick).
   * Replace the array when geometry or styling changes; camera moves never upload it again. */
  readonly data: Float32Array;
  readonly density: number;
}

export interface MapGrid {
  /** Solid boundaries every this many tiles; dashed boundaries every tile. */
  readonly spacing: number;
  /** Shared opacity, from 0 to 1. */
  readonly opacity: number;
  /** Backing pixels per CSS pixel, for one CSS pixel strokes and 2 / 3 CSS pixel dashes. */
  readonly density: number;
}

/**
 * What a pass draws with in one frame: the world, the camera the frame is drawn with (snapped to whole screen pixels
 * for scheduled frames), the viewport (the canvas backing store) and the layer bits (shaders' uLayers).
 */
export interface FrameView {
  readonly source: RenderableWorld;
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
  readonly layers: number;
}
