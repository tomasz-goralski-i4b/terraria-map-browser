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
  setLoading: () => {
    throw new Error("not implemented");
  },
  setLoaded: () => {
    throw new Error("not implemented");
  },
  setFailed: () => {
    throw new Error("not implemented");
  },
  cancelLoading: () => {
    throw new Error("not implemented");
  },
}));
