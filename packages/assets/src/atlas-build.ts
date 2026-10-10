import { throwIfAborted } from "./atlas-abort.js";
import { computeFingerprint, loadCachedAtlas, loadCachedMissing, storeAtlas, type CacheDirectory, type FingerprintInput } from "./atlas-cache.js";
import { ATLAS_FORMAT_VERSION, DEFAULT_PADDING, DEFAULT_PAGE_SIZE, packSheets, type PackOptions } from "./atlas-pack.js";
import type { MissingSheet, PackableSheet, SheetKind, SpriteAtlas } from "./atlas-types.js";
import { readXnbTexture, type XnbTexture } from "./xnb-texture.js";

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

type SourceFile = Awaited<ReturnType<NonNullable<ContentEntry["getFile"]>>>;

interface SourceSheet {
  readonly kind: SheetKind;
  readonly id: number;
  readonly name: string;
  readonly file: SourceFile;
}

interface Scan {
  readonly sheets: SourceSheet[];
  /** Matched entries whose file could not be obtained. */
  readonly unreadable: MissingSheet[];
}

// Case-insensitive: the casing of Tiles_/Wall_ files differs between installs (docs/assets.md).
const SHEET_NAME = /^(tiles|wall|tree_tops|tree_branches)_(\d+)\.xnb$/i;
/** The single sheets the atlas holds by name, each as id 0 of its kind (docs/assets.md, "Atlas"). */
const NAMED_SHEETS: ReadonlyMap<string, SheetKind> = new Map([
  ["shroom_tops.xnb", "shroomTop"], ["wiresnew.xnb", "wire"], ["actuator.xnb", "actuator"],
]);
const NUMBERED_KINDS: ReadonlyMap<string, SheetKind> = new Map([
  ["tiles", "tile"], ["wall", "wall"], ["tree_tops", "treeTop"], ["tree_branches", "treeBranch"],
]);

/** The kind and id of a sheet file the atlas holds, or undefined for any other file. */
function sheetOf(name: string): { readonly kind: SheetKind; readonly id: number } | undefined {
  const named = NAMED_SHEETS.get(name.toLowerCase());
  if (named !== undefined) return { kind: named, id: 0 };
  const match = SHEET_NAME.exec(name);
  if (match === null) return undefined;
  const kind = NUMBERED_KINDS.get((match[1] ?? "").toLowerCase());
  return kind === undefined ? undefined : { kind, id: Number(match[2]) };
}

/** The `Images` folder when `contentDir` is `Content`, otherwise `contentDir` itself. */
async function imagesDirectory(contentDir: ContentDirectory): Promise<ContentDirectory> {
  try {
    return await contentDir.getDirectoryHandle("Images");
  } catch {
    return contentDir;
  }
}

async function scanSheets(directory: ContentDirectory): Promise<Scan> {
  const sheets: SourceSheet[] = [];
  const unreadable: MissingSheet[] = [];
  for await (const [name, entry] of directory.entries()) {
    const sheet = sheetOf(name);
    if (sheet === undefined || entry.kind !== "file" || entry.getFile === undefined) continue;
    const { kind, id } = sheet;
    try {
      sheets.push({ kind, id, name, file: await entry.getFile() });
    } catch (error) {
      unreadable.push({ kind, id, name, reason: error instanceof Error ? error.message : String(error) });
    }
  }
  sheets.sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
  return { sheets, unreadable };
}

/** Rejects with an `AbortError` `DOMException` when `signal` aborts; leaves no partial cache entry. */
export async function buildSpriteAtlas(contentDir: ContentDirectory, options?: BuildOptions): Promise<BuildResult> {
  const { cache, signal, onProgress } = options ?? {};
  const decode = options?.decode ?? ((bytes: Uint8Array): XnbTexture => readXnbTexture(bytes));
  const pageSize = options?.pageSize ?? DEFAULT_PAGE_SIZE;
  const padding = options?.padding ?? DEFAULT_PADDING;

  throwIfAborted(signal);
  const { sheets: sources, unreadable } = await scanSheets(await imagesDirectory(contentDir));
  const inputs: FingerprintInput[] = sources.map((s) => ({ name: s.name, size: s.file.size, lastModified: s.file.lastModified }));
  const fingerprint = computeFingerprint(inputs, ATLAS_FORMAT_VERSION);
  onProgress?.({ phase: "scan", done: sources.length, total: sources.length });
  throwIfAborted(signal);

  // An incomplete scan has a fingerprint that does not describe the install, so it is neither read from nor written to the cache.
  const cacheable = cache !== undefined && unreadable.length === 0;
  if (cacheable) {
    const cached = await loadCachedAtlas(cache, fingerprint);
    throwIfAborted(signal);
    if (cached?.index.pageSize === pageSize && cached.index.padding === padding) {
      const cachedMissing = await loadCachedMissing(cache, fingerprint);
      throwIfAborted(signal);
      return { atlas: cached, missing: cachedMissing, fromCache: true, fingerprint };
    }
  }

  const sheets: PackableSheet[] = [];
  const missing: MissingSheet[] = [...unreadable];
  for (const [position, source] of sources.entries()) {
    throwIfAborted(signal);
    try {
      const texture = decode(new Uint8Array(await source.file.arrayBuffer()));
      sheets.push({ kind: source.kind, id: source.id, width: texture.width, height: texture.height, rgba: texture.rgba });
    } catch (error) {
      missing.push({ kind: source.kind, id: source.id, name: source.name, reason: error instanceof Error ? error.message : String(error) });
    }
    onProgress?.({ phase: "decode", done: position + 1, total: sources.length });
  }

  throwIfAborted(signal);
  onProgress?.({ phase: "pack", done: 0, total: 1 });
  const atlas = packSheets(sheets, { pageSize, padding });
  onProgress?.({ phase: "pack", done: 1, total: 1 });

  throwIfAborted(signal);
  if (cacheable) {
    onProgress?.({ phase: "store", done: 0, total: 1 });
    throwIfAborted(signal);
    await storeAtlas(cache, fingerprint, atlas, { missing, signal });
    onProgress?.({ phase: "store", done: 1, total: 1 });
  }
  return { atlas, missing, fromCache: false, fingerprint };
}
