import { WorldWorkerClient, WorldWorkerError, type WorldTilesResult } from "@studio/world-codec";
import { useAppStore, type LoadError } from "../store.js";

/** Small display facts about the loaded world; the planes and palette themselves stay outside React and the store. */
export interface WorldSummary {
  readonly name: string;
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
  readonly open: (file: File) => Promise<void>;
  /** Cancels a parse in progress and returns to the previous state. */
  readonly cancel: () => void;
  /** Cancels a parse in progress and forgets the loaded world. */
  readonly reset: () => void;
  /** The loaded world (planes, palette, metadata) as a plain reference, not React state. */
  readonly getLoadedWorld: () => WorldTilesResult | null;
}

function summarize(world: WorldTilesResult): WorldSummary {
  const { metadata } = world;
  return {
    name: metadata.name,
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
  let current: AbortController | null = null;

  const cancel = (): void => {
    current?.abort();
  };

  const open = async (file: File): Promise<void> => {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    const store = useAppStore.getState();
    store.setLoading(file.name);
    try {
      const world = await parser.parse(file, { signal: controller.signal });
      if (current !== controller) return;
      loaded = world;
      useAppStore.getState().setLoaded(summarize(world));
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
    cancel();
    loaded = null;
  };

  return { open, cancel, reset, getLoadedWorld: () => loaded };
}

let defaultSession: WorldSession | undefined;

/** Forgets the loaded world and returns the store to its initial idle state (a freshly mounted app). */
export function resetDefaultWorldSession(): void {
  defaultSession?.reset();
  useAppStore.setState({ phase: "idle", loadingFileName: null, summary: null, error: null });
}

/** The session used by the app: backed by a real world-parsing Worker. */
export function getDefaultWorldSession(): WorldSession {
  defaultSession ??= createWorldSession(
    WorldWorkerClient.create(() => new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" })),
  );
  return defaultSession;
}
