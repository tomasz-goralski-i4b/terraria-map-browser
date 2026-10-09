import { create } from "zustand";
import { useLayoutStore } from "../shell/layout-store.js";
import { deleteStored, readStored, writeStored } from "../handle-db.js";
import type { AtlasWorkerRequest, AtlasWorkerResponse, BuildProgress, BuildResult, MissingSheet, SpriteAtlas } from "@studio/assets";

/** A picked `Content` folder with the permission calls of the File System Access API. */
export interface ContentFolder extends FileSystemDirectoryHandle {
  queryPermission(descriptor: { readonly mode: "read" }): Promise<PermissionState>;
  requestPermission(descriptor: { readonly mode: "read" }): Promise<PermissionState>;
}

/** What the atlas is built from: a picked folder, or the files of the folder-input fallback. */
export type ContentSource = ContentFolder | readonly File[];

/** Builds the sprite atlas off the main thread; rejects with an `AbortError` when `signal` aborts. */
export interface AtlasBuilder {
  build(source: ContentSource, options: { readonly onProgress: (progress: BuildProgress) => void; readonly signal: AbortSignal }): Promise<BuildResult>;
  /** The cached atlas of an earlier build, without its source files; null when it is no longer cached. */
  loadCached(fingerprint: string): Promise<BuildResult | null>;
  /** Removes every cached atlas, so the next build decodes the sheets again. */
  clearCache(): Promise<void>;
}

/**
 * What is kept between visits: the picked folder's handle, or, for the folder-input fallback (which gives no handle),
 * the fingerprint of the atlas it built, so the atlas comes back from the cache.
 */
export type RememberedSource =
  | { readonly kind: "folder"; readonly folder: ContentFolder }
  | { readonly kind: "files"; readonly folderName: string; readonly fingerprint: string };

export interface RememberedContent {
  load(): Promise<RememberedSource | null>;
  save(source: RememberedSource): Promise<void>;
  forget(): Promise<void>;
}

/** What the Layers panel shows about the Terraria assets. Small values only; the atlas itself stays outside React. */
export type AssetStatus =
  | { readonly kind: "none" }
  /**
   * The folder dialog is open, or the browser is still collecting the chosen folder's files (with thousands of files
   * that takes seconds after the user confirms, before the page gets them).
   */
  | { readonly kind: "choosing" }
  /** A folder is remembered, but the browser must ask for permission again (only on a user gesture). */
  | { readonly kind: "reconnect"; readonly folderName: string }
  | { readonly kind: "building"; readonly folderName: string; readonly progress: BuildProgress | null }
  | {
      readonly kind: "ready";
      readonly folderName: string;
      readonly tileSheets: number;
      readonly wallSheets: number;
      readonly pages: number;
      readonly fromCache: boolean;
      readonly missing: readonly MissingSheet[];
    };

/** The atlas build's progress, 0–1; decoding is nearly all of the work. */
export function buildFraction(status: AssetStatus): number {
  if (status.kind !== "building" || status.progress === null) return 0;
  const { phase, done, total } = status.progress;
  if (phase === "scan") return 0;
  if (phase === "decode") return 0.95 * (done / Math.max(total, 1));
  return phase === "pack" ? 0.95 : 0.98;
}

export interface AssetState {
  readonly status: AssetStatus;
  /** Why the last connect failed (wrong folder, unreadable files); shown over the map until dismissed. */
  readonly notice: string | null;
}

export const useAssetStore = create<AssetState>()(() => ({ status: { kind: "none" }, notice: null }));

function setStatus(status: AssetStatus): void {
  useAssetStore.setState({ status });
}

function setNotice(notice: string | null): void {
  useAssetStore.setState({ notice });
}

export function dismissAssetNotice(): void {
  setNotice(null);
}

export interface AssetSession {
  /** Opens the directory picker (or, without one, the folder input) and builds the atlas from the chosen folder. */
  readonly connect: () => Promise<void>;
  /**
   * Opens the folder input even where there is a directory picker: Chrome's picker refuses folders it treats as system
   * folders, such as anything under Program Files, where Steam installs Terraria by default.
   */
  readonly chooseFiles: () => void;
  /** Whether `connect` uses the directory picker (so `chooseFiles` is a separate way in). */
  readonly hasDirectoryPicker: boolean;
  /** The folder dialog was closed without a choice. */
  readonly cancelChoosing: () => void;
  /** Builds the atlas from the files of the folder-input fallback. */
  readonly connectFiles: (files: readonly File[]) => Promise<void>;
  /** Asks again for the remembered folder (must run on a user gesture) and builds the atlas. */
  readonly reconnect: () => Promise<void>;
  /** Loads the remembered folder of an earlier visit, once; never prompts. */
  readonly restore: () => Promise<void>;
  /** Cancels a build in progress, or the wait for the folder dialog, and returns to the state before it. */
  readonly cancel: () => void;
  /** The loaded atlas as a plain reference, not React state. */
  readonly getAtlas: () => SpriteAtlas | null;
  /** Unloads the atlas, forgets the folder and clears the atlas cache: back to "not connected". */
  readonly disconnect: () => Promise<void>;
}

export interface AssetSessionOptions {
  readonly builder: AtlasBuilder;
  readonly remembered: RememberedContent;
  /** `showDirectoryPicker`; resolves null when the user closes it. Null where the browser has no picker. */
  readonly pickDirectory: (() => Promise<ContentFolder | null>) | null;
  /** Opens the `<input webkitdirectory>` fallback; its files come back through `connectFiles`. */
  readonly openFolderInput: () => void;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The picked folder's name: the first segment of the files' relative paths. */
function filesFolderName(files: readonly File[]): string {
  const first = files[0]?.webkitRelativePath.split("/")[0] ?? "";
  return first === "" ? "selected folder" : first;
}

/** The files the atlas is built from (docs/assets.md, "Atlas"); every other file of the folder is never read. */
const SHEET_FILE = /^(tiles|wall)_\d+\.xnb$/i;

const nextFrame = (run: () => void): void => {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
  else setTimeout(run, 16);
};

/**
 * At most one call per frame, always ending with the latest value. The Worker reports every decoded sheet (over a
 * thousand when it decodes fast), and each store update renders at once, which would freeze the UI for seconds.
 */
function throttled<T>(apply: (value: T) => void): (value: T) => void {
  let scheduled = false;
  let pending: { readonly value: T } | null = null;
  const flush = (): void => {
    if (pending === null) {
      scheduled = false;
      return;
    }
    const { value } = pending;
    pending = null;
    apply(value);
    nextFrame(flush);
  };
  return (value) => {
    if (scheduled) {
      pending = { value };
      return;
    }
    scheduled = true;
    apply(value);
    nextFrame(flush);
  };
}

function readyStatus(folderName: string, result: BuildResult): AssetStatus {
  const { entries, pageCount } = result.atlas.index;
  return {
    kind: "ready",
    folderName,
    tileSheets: entries.filter((entry) => entry.kind === "tile").length,
    wallSheets: entries.filter((entry) => entry.kind === "wall").length,
    pages: pageCount,
    fromCache: result.fromCache,
    missing: result.missing,
  };
}

export function createAssetSession({ builder, remembered, pickDirectory, openFolderInput }: AssetSessionOptions): AssetSession {
  let atlas: SpriteAtlas | null = null;
  let current: AbortController | null = null;
  /** The status to return to when a build is cancelled or fails. */
  let beforeBuild: AssetStatus = { kind: "none" };
  /** The status to return to when the folder dialog is closed without a choice. */
  let beforeChoosing: AssetStatus = { kind: "none" };
  let restoring: Promise<void> | null = null;
  /** Counts started builds, so a slower cache restore never replaces one. */
  let builds = 0;

  const forget = (): Promise<void> => remembered.forget().catch(() => undefined);

  /**
   * A failed build reports why and goes back to where it started (an earlier atlas stays loaded). Only a remembered
   * source that fails is forgotten, so the next visit does not fail again.
   */
  const fail = async (text: string, fromRemembered: boolean): Promise<void> => {
    setNotice(text);
    if (fromRemembered) {
      atlas = null;
      await forget();
      setStatus({ kind: "none" });
      return;
    }
    setStatus(beforeBuild.kind === "building" ? { kind: "none" } : beforeBuild);
  };

  const build = async (
    source: ContentSource,
    folderName: string,
    remember: (result: BuildResult) => RememberedSource,
    fromRemembered = false,
  ): Promise<void> => {
    builds++;
    if (current === null) {
      const status = useAssetStore.getState().status;
      beforeBuild = status.kind === "choosing" ? beforeChoosing : status;
    }
    current?.abort();
    const controller = new AbortController();
    current = controller;
    setNotice(null);
    setStatus({ kind: "building", folderName, progress: null });
    try {
      const result = await builder.build(source, {
        signal: controller.signal,
        onProgress: throttled((progress) => {
          if (current === controller) setStatus({ kind: "building", folderName, progress });
        }),
      });
      if (current !== controller) return;
      if (result.atlas.index.entries.length === 0 && result.missing.length === 0) {
        await fail(`“${folderName}” has no Tiles_<id>.xnb or Wall_<id>.xnb files. Choose the Content (or Content\\Images) folder of your Terraria installation.`, fromRemembered);
        return;
      }
      atlas = result.atlas;
      setStatus(readyStatus(folderName, result));
      await remembered.save(remember(result)).catch(() => undefined);
    } catch (error) {
      // A superseded build is settled by the newer one; only the latest reports.
      if (current !== controller) return;
      if (controller.signal.aborted && isAbort(error)) {
        setStatus(beforeBuild);
        return;
      }
      await fail(`Could not load sprites from “${folderName}”: ${message(error)}`, fromRemembered);
    } finally {
      if (current === controller) current = null;
    }
  };

  const buildFolder = (folder: ContentFolder, fromRemembered = false): Promise<void> =>
    build(folder, folder.name, () => ({ kind: "folder", folder }), fromRemembered);

  const chooseFiles = (): void => {
    const status = useAssetStore.getState().status;
    if (status.kind === "building") return;
    if (status.kind !== "choosing") beforeChoosing = status;
    setNotice(null);
    setStatus({ kind: "choosing" });
    openFolderInput();
  };

  const cancelChoosing = (): void => {
    if (useAssetStore.getState().status.kind === "choosing") setStatus(beforeChoosing);
  };

  const connect = async (): Promise<void> => {
    if (pickDirectory === null) {
      chooseFiles();
      return;
    }
    let folder: ContentFolder | null;
    try {
      folder = await pickDirectory();
    } catch (error) {
      if (isAbort(error)) return; // the user closed the picker
      throw error;
    }
    if (folder !== null) await buildFolder(folder);
  };

  const connectFiles = (files: readonly File[]): Promise<void> => {
    if (files.length === 0) {
      cancelChoosing();
      return Promise.resolve();
    }
    const folderName = filesFolderName(files);
    // Only the sheets go to the Worker: copying all ~15 000 files of Content into it blocks the main thread.
    const sheets = files.filter((file) => SHEET_FILE.test(file.name));
    return build(sheets, folderName, (result) => ({ kind: "files", folderName, fingerprint: result.fingerprint }));
  };

  const reconnect = async (): Promise<void> => {
    const source = await remembered.load().catch(() => null);
    if (source?.kind !== "folder") {
      setStatus({ kind: "none" });
      return;
    }
    const { folder } = source;
    const permission = await folder.requestPermission({ mode: "read" }).catch((): PermissionState => "denied");
    if (permission !== "granted") {
      await forget();
      setStatus({ kind: "none" });
      return;
    }
    await buildFolder(folder, true);
  };

  const restoreFromCache = async (folderName: string, fingerprint: string): Promise<void> => {
    const startedBuilds = builds;
    setStatus({ kind: "building", folderName, progress: null });
    const result = await builder.loadCached(fingerprint).catch(() => null);
    // A build the user started meanwhile wins over the cached atlas.
    if (builds !== startedBuilds) return;
    if (result === null) {
      await forget();
      setStatus({ kind: "none" });
      return;
    }
    atlas = result.atlas;
    setStatus(readyStatus(folderName, result));
  };

  const restoreOnce = async (): Promise<void> => {
    const source = await remembered.load().catch(() => null);
    if (source === null) return;
    if (source.kind === "files") {
      await restoreFromCache(source.folderName, source.fingerprint);
      return;
    }
    const { folder } = source;
    const permission = await folder.queryPermission({ mode: "read" }).catch((): PermissionState => "denied");
    if (permission === "granted") await buildFolder(folder, true);
    else if (permission === "prompt") setStatus({ kind: "reconnect", folderName: folder.name });
    else await forget();
  };

  const restore = (): Promise<void> => {
    restoring ??= restoreOnce();
    return restoring;
  };

  const disconnect = async (): Promise<void> => {
    cancelChoosing();
    current?.abort();
    current = null;
    builds++; // a cache restore still in flight must not bring the atlas back
    atlas = null;
    setNotice(null);
    setStatus({ kind: "none" });
    await forget();
    await builder.clearCache().catch(() => undefined);
  };

  const cancel = (): void => {
    cancelChoosing();
    current?.abort();
  };

  return {
    connect, chooseFiles, cancelChoosing, hasDirectoryPicker: pickDirectory !== null, connectFiles, reconnect, restore, cancel,
    getAtlas: () => atlas,
    disconnect,
  };
}

/**
 * Talks to the atlas Worker. A cancelled build lets its Worker finish cancelling in the background (so it can remove
 * its uncommitted cache entry) and the next build starts in a fresh Worker.
 */
export function createWorkerAtlasBuilder(createWorker: () => Worker, cacheName = "sprite-atlas"): AtlasBuilder {
  return {
    clearCache: async () => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(cacheName, { recursive: true }).catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
      });
    },
    loadCached: (fingerprint) =>
      new Promise<BuildResult | null>((resolve, reject) => {
        const worker = createWorker();
        worker.onmessage = (event: MessageEvent<AtlasWorkerResponse>): void => {
          const response = event.data;
          if (response.type === "progress") return;
          worker.terminate();
          if (response.type === "done") resolve(response.result);
          else if (response.type === "error") reject(new Error(response.message));
          else resolve(null);
        };
        worker.onerror = (event): void => {
          worker.terminate();
          reject(new Error(event.message || "The atlas Worker failed"));
        };
        worker.postMessage({ type: "load", fingerprint, cacheName } satisfies AtlasWorkerRequest);
      }),
    build: (source, { onProgress, signal }) =>
      new Promise<BuildResult>((resolve, reject) => {
        if (signal.aborted) {
          reject(new DOMException("Atlas build cancelled", "AbortError"));
          return;
        }
        const worker = createWorker();
        let settled = false;
        const finish = (): void => {
          settled = true;
          signal.removeEventListener("abort", onAbort);
        };
        const onAbort = (): void => {
          if (settled) return;
          finish();
          worker.postMessage({ type: "cancel" } satisfies AtlasWorkerRequest);
          reject(new DOMException("Atlas build cancelled", "AbortError"));
        };
        worker.onmessage = (event: MessageEvent<AtlasWorkerResponse>): void => {
          const response = event.data;
          if (response.type === "progress") {
            if (!settled) onProgress(response.progress);
            return;
          }
          worker.terminate();
          if (settled) return;
          finish();
          if (response.type === "done") resolve(response.result);
          else if (response.type === "error") reject(new Error(response.message));
          else reject(new DOMException("Atlas build cancelled", "AbortError"));
        };
        worker.onerror = (event): void => {
          worker.terminate();
          if (settled) return;
          finish();
          reject(new Error(event.message || "The atlas Worker failed"));
        };
        signal.addEventListener("abort", onAbort);
        worker.postMessage({ type: "build", contentDir: source, cacheName } satisfies AtlasWorkerRequest);
      }),
  };
}

const KEY = "content-source";

/** Keeps the remembered source in IndexedDB, the only storage that can hold a directory handle. */
export const indexedDbRememberedContent: RememberedContent = {
  load: () => readStored<RememberedSource>(KEY),
  save: (source) => writeStored(KEY, source),
  forget: () => deleteStored(KEY),
};

/**
 * Opens a fresh `<input type="file" webkitdirectory>`. It is created here, not rendered by a component, so the folder
 * dialog never depends on what is mounted; a new element per dialog leaves no stale listeners behind.
 */
function openFolderDialog(session: () => AssetSession): void {
  const input = document.createElement("input");
  input.type = "file";
  input.webkitdirectory = true;
  input.addEventListener("change", () => {
    const files = [...(input.files ?? [])];
    // The Sprites row in the Layers panel (View tab) shows the build, so make sure it is in view.
    const layout = useLayoutStore.getState();
    layout.setDockHidden(false);
    layout.setDockTab("view");
    layout.setSectionOpen("layers", true);
    void session().connectFiles(files);
  });
  input.addEventListener("cancel", () => {
    session().cancelChoosing();
  });
  input.click();
}

let defaultSession: AssetSession | undefined;

/**
 * The session used by the app: a real atlas Worker, the remembered source kept in IndexedDB. It picks the folder with
 * the folder input, never `showDirectoryPicker`: Chrome's picker refuses every folder under Program Files ("contains
 * system files"), which is where Steam installs Terraria by default. The atlas still comes back on the next visit,
 * from the cache by its fingerprint.
 */
export function getDefaultAssetSession(): AssetSession {
  defaultSession ??= createAssetSession({
    builder: createWorkerAtlasBuilder(() => new Worker(new URL("./atlas.worker.ts", import.meta.url), { type: "module" })),
    remembered: indexedDbRememberedContent,
    pickDirectory: null,
    openFolderInput: () => {
      openFolderDialog(getDefaultAssetSession);
    },
  });
  return defaultSession;
}

/** Replaces the app's session (tests inject fakes); `undefined` goes back to the default one. */
export function setDefaultAssetSession(session: AssetSession | undefined): void {
  defaultSession = session;
}
