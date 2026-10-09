import { create } from "zustand";
import type { WorldSummary } from "./world/world-session.js";

export type LoadPhase = "idle" | "loading" | "loaded" | "failed";

/** A failed parse as the codec reported it. */
export interface LoadError {
  readonly code: string;
  readonly offset: number;
  readonly message: string;
  readonly fileName: string;
}

// UI state only. World data (CWM planes, palette) never lives here: see README.md.
export interface AppState {
  readonly status: string;
  readonly setStatus: (status: string) => void;
  readonly phase: LoadPhase;
  readonly loadingFileName: string | null;
  /** Summary of the currently loaded world; kept when a later open fails or is cancelled. */
  readonly summary: WorldSummary | null;
  readonly error: LoadError | null;
  /**
   * The loaded world was changed after it was opened or last saved. Edit tools set it; saving or opening another world
   * clears it. While it is set, reloading or closing the tab asks first.
   */
  readonly unsavedChanges: boolean;
  readonly setUnsavedChanges: (unsaved: boolean) => void;
  readonly setLoading: (fileName: string) => void;
  readonly setLoaded: (summary: WorldSummary) => void;
  readonly setFailed: (error: LoadError) => void;
  /** Leaves `loading`, returning to `loaded` when a world is held, else `idle`. */
  readonly cancelLoading: () => void;
}

export const useAppStore = create<AppState>()((set) => ({
  status: "Ready",
  setStatus: (status) => {
    set({ status });
  },
  phase: "idle",
  loadingFileName: null,
  summary: null,
  error: null,
  unsavedChanges: false,
  setUnsavedChanges: (unsaved) => {
    set({ unsavedChanges: unsaved });
  },
  setLoading: (fileName) => {
    set({ phase: "loading", loadingFileName: fileName, error: null });
  },
  setLoaded: (summary) => {
    set({ phase: "loaded", loadingFileName: null, summary, error: null, unsavedChanges: false });
  },
  setFailed: (error) => {
    set({ phase: "failed", loadingFileName: null, error });
  },
  cancelLoading: () => {
    set((state) => ({ phase: state.summary === null ? "idle" : "loaded", loadingFileName: null, error: null }));
  },
}));
