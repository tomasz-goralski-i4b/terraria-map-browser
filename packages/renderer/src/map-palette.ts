import type { ContentRef } from "@studio/world-model";
import type { Rgba } from "./chunk/render.js";

export type MapRgb = readonly [number, number, number];

/** Versioned local export. IDs are array positions; each entry preserves every map option. */
export interface MapPalette {
  readonly schemaVersion: 1;
  readonly gameVersion: string;
  readonly tiles: readonly (readonly MapRgb[])[];
  readonly walls: readonly (readonly MapRgb[])[];
  /** Water, lava, honey, shimmer, in that order. */
  readonly liquids: readonly MapRgb[];
}

export const MAX_MAP_PALETTE_BYTES: number = 4 * 1024 * 1024;

function rgb(value: unknown): MapRgb {
  if (!Array.isArray(value) || value.length !== 3
    || !value.every((channel: unknown) => typeof channel === "number" && Number.isInteger(channel) && channel >= 0 && channel <= 255)) {
    throw new Error("Map palette colours must contain three integer RGB channels (0–255).");
  }
  return Object.freeze([value[0] as number, value[1] as number, value[2] as number]);
}

function entries(value: unknown): readonly (readonly MapRgb[])[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 65535) {
    throw new Error("Map palette content tables must contain 1–65535 indexed entries.");
  }
  return Object.freeze(value.map((options: unknown) => {
    if (!Array.isArray(options) || options.length > 256) throw new Error("Invalid map palette options.");
    return Object.freeze(options.map((option: unknown) => rgb(option)));
  }));
}

/** Validates untrusted local JSON before it can reach CPU/GPU lookup tables. */
export function parseMapPalette(json: string): MapPalette {
  if (json.length > MAX_MAP_PALETTE_BYTES) throw new Error("Map palette file exceeds 4 MiB.");
  const data: unknown = JSON.parse(json);
  if (typeof data !== "object" || data === null || !("schemaVersion" in data) || data.schemaVersion !== 1
    || !("gameVersion" in data) || typeof data.gameVersion !== "string" || data.gameVersion.trim().length === 0
    || data.gameVersion.length > 80 || !("tiles" in data) || !("walls" in data) || !("liquids" in data)
    || !Array.isArray(data.liquids) || data.liquids.length !== 4) {
    throw new Error("Unsupported map palette document. Expected schemaVersion 1 and four liquid colours.");
  }
  return Object.freeze({
    schemaVersion: 1, gameVersion: data.gameVersion,
    tiles: entries(data.tiles), walls: entries(data.walls),
    liquids: Object.freeze(data.liquids.map((colour: unknown) => rgb(colour))),
  });
}

/** POC selects map option zero. Missing IDs and mod content use the existing fallback. */
export function importedContentColor(palette: MapPalette | undefined, ref: ContentRef, layer: "block" | "wall"): Rgba | undefined {
  if (ref.kind !== "vanilla") return undefined;
  const colour = (layer === "block" ? palette?.tiles : palette?.walls)?.[ref.id]?.[0];
  return colour === undefined ? undefined : [colour[0], colour[1], colour[2], 255];
}
