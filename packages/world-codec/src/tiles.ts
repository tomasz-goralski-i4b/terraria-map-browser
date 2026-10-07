import type { WorldMetadataResult } from "./metadata.js";

/** A stable reference to world content as stored in the CWM palette (vanilla or unknown ids in this section). */
export type TileContentRef =
  | { readonly kind: "vanilla"; readonly id: number }
  | { readonly kind: "unknown"; readonly runtimeId: number };

/** The ten CWM planes (docs/cwm.md), column-major: index = x * height + y. */
export interface TilePlanes {
  readonly block: Uint16Array;
  readonly wall: Uint16Array;
  readonly frameX: Int16Array;
  readonly frameY: Int16Array;
  readonly paint: Uint8Array;
  readonly wallPaint: Uint8Array;
  readonly liquid: Uint8Array;
  readonly liquidAmount: Uint8Array;
  readonly shape: Uint8Array;
  readonly flags: Uint16Array;
}

/** Header, metadata and the decoded tile section as CWM planes plus the first-appearance palette. */
export interface WorldTilesResult extends WorldMetadataResult {
  readonly planes: TilePlanes;
  readonly palette: readonly TileContentRef[];
}

/**
 * Decodes the tile section (docs/file-format/tiles.md, "Tile data (section 2)") straight into CWM planes.
 * Malformed records throw `MalformedTiles` with the record's `x`, `y` and absolute `offset`.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- RED stub: the green phase reads `bytes`.
export function readWorldTiles(_bytes: Uint8Array): WorldTilesResult {
  throw new Error("not implemented");
}
