/* eslint-disable @typescript-eslint/no-unused-vars -- red-phase stubs: the green phase uses every parameter */
import type { CacheDirectory } from "./atlas-cache.js";
import type { MissingSheet, SpriteAtlas } from "./atlas-types.js";
import type { PackOptions } from "./atlas-pack.js";
import type { XnbTexture } from "./xnb-texture.js";

/** The `Content` directory (or `Content/Images`), as far as the build needs it. */
export interface ContentDirectory {
  getDirectoryHandle(name: string): Promise<ContentDirectory>;
  entries(): AsyncIterable<[string, ContentEntry]>;
}

export interface ContentEntry {
  readonly kind: string;
  getFile?(): Promise<{
    readonly name: string;
    readonly size: number;
    readonly lastModified: number;
    arrayBuffer(): Promise<ArrayBuffer>;
  }>;
}

export type BuildPhase = "scan" | "decode" | "pack" | "store";

export interface BuildProgress {
  readonly phase: BuildPhase;
  readonly done: number;
  readonly total: number;
}

export interface BuildOptions extends PackOptions {
  /** Where the atlas is cached; without it nothing is cached. */
  readonly cache?: CacheDirectory;
  /** Decoder for one `.xnb` file; defaults to `readXnbTexture`. Tests count its calls. */
  readonly decode?: (bytes: Uint8Array) => XnbTexture;
  readonly onProgress?: (progress: BuildProgress) => void;
  readonly signal?: AbortSignal;
}

export interface BuildResult {
  readonly atlas: SpriteAtlas;
  /** Sheets that were not found or could not be decoded; never fatal. */
  readonly missing: readonly MissingSheet[];
  /** True when the atlas came from the cache and no `.xnb` was decoded. */
  readonly fromCache: boolean;
  readonly fingerprint: string;
}

/** Rejects with an `AbortError` `DOMException` when `signal` aborts; leaves no partial cache entry. */
export function buildSpriteAtlas(_contentDir: ContentDirectory, _options?: BuildOptions): Promise<BuildResult> {
  throw new Error("not implemented");
}
