/* eslint-disable @typescript-eslint/no-unused-vars -- red-phase stubs: the green phase uses every parameter */
import type { AtlasEntry, PackableSheet, SheetKind, SpriteAtlas } from "./atlas-types.js";

/** Bump when the page layout or index shape changes; it is part of the cache key. */
export const ATLAS_FORMAT_VERSION = 1;

export interface PackOptions {
  /** Power-of-two page edge in pixels. */
  readonly pageSize?: number;
  /** Transparent pixels kept around every sheet. */
  readonly padding?: number;
}

/** A sheet does not fit into one atlas page. */
export class AtlasSheetTooLargeError extends Error {
  readonly kind: SheetKind;
  readonly id: number;

  constructor(kind: SheetKind, id: number, message: string) {
    super(message);
    this.name = "AtlasSheetTooLargeError";
    this.kind = kind;
    this.id = id;
  }
}

/** Packs sheets into pages, each placed exactly once, inside the page and without overlap (padding included). */
export function packSheets(_sheets: readonly PackableSheet[], _options?: PackOptions): SpriteAtlas {
  throw new Error("not implemented");
}

/** The entry of (kind, id), or `undefined` when the sheet is not in the atlas. */
export function findSprite(_atlas: Pick<SpriteAtlas, "index">, _kind: SheetKind, _id: number): AtlasEntry | undefined {
  throw new Error("not implemented");
}

/** Copies the entry's rectangle out of its page as `width × height × 4` bytes. */
export function readSpritePixels(_atlas: SpriteAtlas, _entry: AtlasEntry): Uint8Array {
  throw new Error("not implemented");
}
