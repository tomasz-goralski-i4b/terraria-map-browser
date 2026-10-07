import { create } from "zustand";

// UI state only. World data (CWM planes, palette) never lives here: see README.md.
export interface AppState {
  readonly status: string;
  readonly setStatus: (status: string) => void;
}

export const useAppStore = create<AppState>()((set) => ({
  status: "Ready",
  setStatus: (status) => {
    set({ status });
  },
}));
