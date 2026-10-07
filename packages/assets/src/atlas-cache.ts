/* eslint-disable @typescript-eslint/no-unused-vars -- red-phase stubs: the green phase uses every parameter */
import type { SpriteAtlas } from "./atlas-types.js";

/** The subset of `FileSystemDirectoryHandle` the cache uses (OPFS, or an in-memory fake in tests). */
export interface CacheDirectory {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<CacheDirectory>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<CacheFile>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries(): AsyncIterable<[string, unknown]>;
}

export interface CacheFile {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }>;
  createWritable(): Promise<{
    write(data: Uint8Array | string): Promise<void>;
    close(): Promise<void>;
    abort?(): Promise<void>;
  }>;
}

/** One source file as seen by the fingerprint. */
export interface FingerprintInput {
  readonly name: string;
  readonly size: number;
  readonly lastModified: number;
}

/** Stable key over names, sizes and last-modified times (order-independent) and the atlas format version. */
export function computeFingerprint(_files: readonly FingerprintInput[], _formatVersion: number): string {
  throw new Error("not implemented");
}

/** Loads the cached atlas for `fingerprint`, or `undefined` when none (or a different/partial one) is stored. */
export function loadCachedAtlas(_root: CacheDirectory, _fingerprint: string): Promise<SpriteAtlas | undefined> {
  throw new Error("not implemented");
}

/** Stores the atlas under `fingerprint` atomically: a partial entry is never visible. Replaces older entries. */
export function storeAtlas(_root: CacheDirectory, _fingerprint: string, _atlas: SpriteAtlas): Promise<void> {
  throw new Error("not implemented");
}
