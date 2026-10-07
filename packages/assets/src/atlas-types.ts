/** Which sprite family a sheet belongs to. */
export type SheetKind = "tile" | "wall";

/** Frame and gutter metrics of a family (docs/assets.md, "Sprite layout"). */
export interface SheetMetrics {
  readonly cell: number;
  readonly gap: number;
}

/** A decoded sheet ready to be packed. */
export interface PackableSheet {
  readonly kind: SheetKind;
  readonly id: number;
  readonly width: number;
  readonly height: number;
  /** `width × height × 4` bytes, R, G, B, A. */
  readonly rgba: Uint8Array;
}

/** Where one sheet lives in the atlas; the rectangle excludes the padding around it. */
export interface AtlasEntry {
  readonly kind: SheetKind;
  readonly id: number;
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The serialisable part of an atlas. */
export interface AtlasIndex {
  readonly formatVersion: number;
  readonly pageSize: number;
  readonly padding: number;
  readonly pageCount: number;
  readonly metrics: Readonly<Record<SheetKind, SheetMetrics>>;
  readonly entries: readonly AtlasEntry[];
}

/** Atlas pages (`pageSize × pageSize × 4` bytes each) plus their index. */
export interface SpriteAtlas {
  readonly pages: readonly Uint8Array[];
  readonly index: AtlasIndex;
}

/** A source sheet that could not be decoded or was not found. */
export interface MissingSheet {
  readonly kind: SheetKind;
  readonly id: number;
  /** File name when known, otherwise the expected `Tiles_<id>.xnb` / `Wall_<id>.xnb`. */
  readonly name: string;
  readonly reason: string;
}
