import { WorldWorkerClient, WorldWorkerError, normalizeWorldMetadata, type WorldTilesResult } from "@studio/world-codec";
import { useAppStore, type LoadError } from "../store.js";
import { resetWorldSave } from "./save-world.js";
import { finishBrush, setBrushWorld } from "./brush-session.js";
import { confirmDiscardChanges } from "./discard-guard.js";
import type { OpenedWorldFile, OpenWorldHandle, WorldSaveDirectory } from "./world-file.js";
import { setPropertiesWorld, propertyReadOnly, checkPropertyRange, type PropertyValue } from "./world-properties.js";
import { resizeWorld } from "./resize-world.js";

/** Small display facts about the loaded world; the planes and palette themselves stay outside React and the store. */
export interface WorldSummary {
  readonly name: string;
  readonly fileName: string;
  /** Size of the opened file in bytes. */
  readonly fileSize: number;
  readonly width: number;
  readonly height: number;
  readonly seed: string;
  readonly mode: string;
  readonly evil: "corruption" | "crimson";
  readonly formatVersion: number;
  readonly paletteSize: number;
}

/** The slice of `WorldWorkerClient` the session needs. */
export interface WorldParser {
  parse(input: File, options?: { readonly signal?: AbortSignal }): Promise<WorldTilesResult>;
}

export interface WorldSession {
  /** Parses `file` in the Worker; a failure or cancel keeps the previous world. */
  readonly open: (file: File, handle?: OpenWorldHandle, directory?: WorldSaveDirectory) => Promise<void>;
  /** Cancels a parse in progress and returns to the previous state. */
  readonly cancel: () => void;
  /** Cancels a parse in progress and forgets the loaded world. */
  readonly reset: () => void;
  /** The loaded world (planes, palette, metadata) as a plain reference, not React state. */
  readonly getLoadedWorld: () => WorldTilesResult | null;
  readonly getOpenedFile: () => OpenedWorldFile | null;
  readonly editProperty: (path: string, value: PropertyValue) => void;
}

function summarize(world: WorldTilesResult, file: File): WorldSummary {
  const { metadata } = world;
  return {
    name: metadata.name,
    fileName: file.name,
    fileSize: file.size,
    width: metadata.width,
    height: metadata.height,
    seed: metadata.seed,
    mode: typeof metadata.mode === "string" ? metadata.mode : `unknown (${String(metadata.mode.raw)})`,
    evil: metadata.evil,
    formatVersion: world.header.version,
    paletteSize: world.palette.length,
  };
}

function toLoadError(error: unknown, fileName: string): LoadError {
  if (error instanceof WorldWorkerError) return { code: error.code, offset: error.offset, message: error.message, fileName };
  return { code: "Internal", offset: 0, message: error instanceof Error ? error.message : String(error), fileName };
}

export function createWorldSession(parser: WorldParser): WorldSession {
  let loaded: WorldTilesResult | null = null;
  let openedFile: OpenedWorldFile | null = null;
  let current: AbortController | null = null;

  const cancel = (): void => {
    current?.abort();
  };

  const open = async (file: File, handle?: OpenWorldHandle, directory?: WorldSaveDirectory): Promise<void> => {
    finishBrush();
    // Only an unsaved world waits for the question, before anything changes: declining leaves a load in flight going.
    if (useAppStore.getState().unsavedChanges && !(await confirmDiscardChanges())) return;
    current?.abort();
    const controller = new AbortController();
    current = controller;
    resetWorldSave();
    const store = useAppStore.getState();
    store.setLoading(file.name);
    try {
      const world = await parser.parse(file, { signal: controller.signal });
      if (current !== controller) return;
      loaded = world;
      setPropertiesWorld(world);
      setBrushWorld("entities" in world ? world : null);
      openedFile = { file, handle: handle ?? null, directory: directory ?? null };
      useAppStore.getState().setLoaded(summarize(world, file));
    } catch (error) {
      // A superseded request is settled by the newer open; only the latest one reports.
      if (current !== controller) return;
      if (controller.signal.aborted) useAppStore.getState().cancelLoading();
      else useAppStore.getState().setFailed(toLoadError(error, file.name));
    } finally {
      if (current === controller) current = null;
    }
  };

  const reset = (): void => {
    finishBrush(true);
    setBrushWorld(null);
    resetWorldSave();
    cancel();
    current = null;
    loaded = null;
    setPropertiesWorld(null);
    openedFile = null;
  };

  const editProperty = (path: string, value: PropertyValue): void => {
    if (loaded === null || openedFile === null) throw new Error("Open a world first.");
    if (propertyReadOnly(path)) throw new Error("This property is derived or part of the file structure.");
    if (path === "metadata.width" || path === "metadata.height") {
      if (typeof value !== "number") throw new Error("Enter a dimension in tiles.");
      const resized = resizeWorld(loaded, path === "metadata.width" ? value : loaded.metadata.width, path === "metadata.height" ? value : loaded.metadata.height);
      loaded = resized;
      setBrushWorld(resized);
      setPropertiesWorld(resized, false);
      const resizedSummary = summarize(resized, openedFile.file);
      useAppStore.setState((state) => ({ summary: resizedSummary, unsavedChanges: true, worldRevision: state.worldRevision + 1 }));
      return;
    }
    checkPropertyRange(path, value, { width: loaded.metadata.width, height: loaded.metadata.height,
      dayTime: path === "details.timeAndWeather.dayTime" ? value === true : loaded.details.timeAndWeather.dayTime });
    const candidate = { ...loaded, header: { ...loaded.header }, metadata: structuredClone(loaded.metadata), details: structuredClone(loaded.details) };
    const keys = path.split(".");
    const last = keys.pop();
    let parent: unknown = candidate;
    for (const key of keys) {
      if (parent === null || typeof parent !== "object" || !Object.hasOwn(parent, key)) throw new Error("Unknown world property.");
      parent = (parent as Record<string, unknown>)[key];
    }
    if (last === undefined || parent === null || typeof parent !== "object" || !Object.hasOwn(parent, last)) throw new Error("Unknown world property.");
    (parent as Record<string, unknown>)[last] = value;
    if (!Number.isInteger(candidate.header.revision) || candidate.header.revision < 0 || candidate.header.revision > 0xffffffff) throw new Error("Save revision must be a UInt32 integer.");
    if (typeof candidate.header.isFavorite !== "boolean") throw new Error("Favorite must be a boolean.");
    Object.assign(candidate.header, { flags: candidate.header.isFavorite ? candidate.header.flags | 1n : candidate.header.flags & ~1n });
    Object.assign(candidate.details.other, { killCountLength: candidate.details.other.killCounts.length, claimableBannerLength: candidate.details.other.claimableBanners?.length });
    Object.assign(loaded, normalizeWorldMetadata(candidate, loaded.envelope.source));
    Object.assign(loaded, { header: candidate.header });
    // Only the layer lines read metadata among the plane-built views; other edits leave the map and its caches alone.
    const geometry = path === "metadata.surfaceLevel" || path === "metadata.rockLevel";
    const edited = summarize(loaded, openedFile.file);
    useAppStore.setState((state) => ({ summary: edited, unsavedChanges: true, worldRevision: state.worldRevision + (geometry ? 1 : 0) }));
  };
  return { open, cancel, reset, editProperty, getLoadedWorld: () => loaded, getOpenedFile: () => openedFile };
}

let defaultSession: WorldSession | undefined;

/** Forgets the loaded world and returns the store to its initial idle state (a freshly mounted app). */
export function resetDefaultWorldSession(): void {
  defaultSession?.reset();
  useAppStore.setState({ phase: "idle", loadingFileName: null, summary: null, error: null, unsavedChanges: false });
}

/** The session used by the app: backed by a real world-parsing Worker. */
export function getDefaultWorldSession(): WorldSession {
  defaultSession ??= createWorldSession(
    WorldWorkerClient.create(() => new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" })),
  );
  return defaultSession;
}

/** File ▸ Close World: back to the start screen, after asking about unsaved edits. */
export async function closeWorld(): Promise<void> {
  finishBrush();
  if (await confirmDiscardChanges()) resetDefaultWorldSession();
}
