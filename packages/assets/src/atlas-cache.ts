import { throwIfAborted } from "./atlas-abort.js";
import type { AtlasIndex, MissingSheet, SpriteAtlas } from "./atlas-types.js";

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

const INDEX_FILE = "index.json";
const MISSING_FILE = "missing.json";
const pageFile = (page: number): string => `page-${String(page)}.rgba`;

/** Two independent 32-bit hashes, joined; not cryptographic, only a change detector. */
function hash(text: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b + code, 0x85ebca6b) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** Stable key over names, sizes and last-modified times (order-independent) and the atlas format version. */
export function computeFingerprint(files: readonly FingerprintInput[], formatVersion: number): string {
  const lines = files.map((file) => `${file.name}\u0000${String(file.size)}\u0000${String(file.lastModified)}`).sort();
  return `fp${String(formatVersion)}-${hash(lines.join("\n"))}-${String(lines.length)}`;
}

async function readBytes(directory: CacheDirectory, name: string): Promise<Uint8Array> {
  const file = await (await directory.getFileHandle(name)).getFile();
  return new Uint8Array(await file.arrayBuffer());
}

async function writeFile(directory: CacheDirectory, name: string, data: Uint8Array | string): Promise<void> {
  const writable = await (await directory.getFileHandle(name, { create: true })).createWritable();
  try {
    await writable.write(data);
    await writable.close();
  } catch (error) {
    await writable.abort?.();
    throw error;
  }
}

function isIndex(value: unknown): value is AtlasIndex {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<Record<keyof AtlasIndex, unknown>>;
  return (
    typeof candidate.pageSize === "number" &&
    typeof candidate.pageCount === "number" &&
    Array.isArray(candidate.entries) &&
    typeof candidate.metrics === "object"
  );
}

/** Loads the cached atlas for `fingerprint`, or `undefined` when none (or a different/partial one) is stored. */
export async function loadCachedAtlas(root: CacheDirectory, fingerprint: string): Promise<SpriteAtlas | undefined> {
  try {
    const directory = await root.getDirectoryHandle(fingerprint);
    // The index is written last, so its presence marks a complete entry.
    const index: unknown = JSON.parse(new TextDecoder().decode(await readBytes(directory, INDEX_FILE)));
    if (!isIndex(index)) return undefined;
    const pages: Uint8Array[] = [];
    for (let page = 0; page < index.pageCount; page++) {
      const bytes = await readBytes(directory, pageFile(page));
      if (bytes.length !== index.pageSize * index.pageSize * 4) return undefined;
      pages.push(bytes);
    }
    return { pages, index };
  } catch {
    // Missing, unreadable or corrupt entries are a cache miss; the caller rebuilds.
    return undefined;
  }
}

/** The missing-sheet report stored with the entry for `fingerprint`; empty when none is stored. */
export async function loadCachedMissing(root: CacheDirectory, fingerprint: string): Promise<MissingSheet[]> {
  try {
    const directory = await root.getDirectoryHandle(fingerprint);
    const missing: unknown = JSON.parse(new TextDecoder().decode(await readBytes(directory, MISSING_FILE)));
    return Array.isArray(missing) ? (missing as MissingSheet[]) : [];
  } catch {
    return [];
  }
}

export interface StoreOptions {
  /** Sheets that were left out of the atlas; restored on a cache hit. */
  readonly missing?: readonly MissingSheet[];
  /** Aborting rejects with an `AbortError` and removes the uncommitted entry. */
  readonly signal?: AbortSignal | undefined;
}

/** Stores the atlas under `fingerprint` atomically: a partial entry is never visible. Replaces older entries. */
export async function storeAtlas(root: CacheDirectory, fingerprint: string, atlas: SpriteAtlas, options?: StoreOptions): Promise<void> {
  const signal = options?.signal;
  throwIfAborted(signal);
  await root.removeEntry(fingerprint, { recursive: true }).catch(() => undefined);
  try {
    const directory = await root.getDirectoryHandle(fingerprint, { create: true });
    for (const [page, pixels] of atlas.pages.entries()) {
      await writeFile(directory, pageFile(page), pixels);
      throwIfAborted(signal);
    }
    await writeFile(directory, MISSING_FILE, JSON.stringify(options?.missing ?? []));
    throwIfAborted(signal);
    await writeFile(directory, INDEX_FILE, JSON.stringify(atlas.index));
    throwIfAborted(signal);
  } catch (error) {
    await root.removeEntry(fingerprint, { recursive: true }).catch(() => undefined);
    throw error;
  }

  const stale: string[] = [];
  for await (const [name] of root.entries()) if (name !== fingerprint) stale.push(name);
  for (const name of stale) await root.removeEntry(name, { recursive: true });
}
