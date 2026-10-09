import { create } from "zustand";
import type { OpenWorldHandle, WorldSaveDirectory, WorldFolderDirectory, WorldFolderFile } from "./world-file.js";
import { getDefaultWorldSession } from "./world-session.js";
import { pickWorldDirectory } from "./world-directory-picker.js";
interface FolderState {
  readonly open: boolean;
  readonly loading: boolean;
  readonly name: string | null;
  readonly files: readonly string[];
  readonly error: string | null;
}
const EMPTY: FolderState = { open: false, loading: false, name: null, files: [], error: null };
export const useWorldFolderStore = create<FolderState>()(() => EMPTY);
let folder: WorldFolderDirectory | null = null;
let files = new Map<string, WorldFolderFile>();
let request = 0;

export function closeWorldFolder(): void {
  request++;
  useWorldFolderStore.setState({ open: false, loading: false });
}

export function resetWorldFolder(): void {
  closeWorldFolder();
  folder = null;
  files.clear();
  useWorldFolderStore.setState(EMPTY);
}

export async function folderForWorld(handle: OpenWorldHandle): Promise<WorldSaveDirectory | null> {
  const selected = folder;
  if (selected?.resolve === undefined) return null;
  try {
    const path = await selected.resolve(handle);
    return path !== null && path.length === 1 ? selected : null;
  } catch {
    // A revoked folder permission must not prevent opening a separately granted file.
    return null;
  }
}

/** Selects a writable world folder; handles stay outside React, and the chooser contains only names. */
export async function chooseWorldFolder(): Promise<void> {
  const id = ++request;
  try {
    const selected = await pickWorldDirectory();
    if (id !== request) return;
    useWorldFolderStore.setState({ open: true, loading: true, name: selected.name, files: [], error: null });
    const entries = new Map<string, WorldFolderFile>();
    for await (const entry of selected.values()) {
      if (id !== request) return;
      if (entry.kind === "file" && /\.wld$/i.test(entry.name)) entries.set(entry.name, entry);
    }
    if (id !== request) return;
    folder = selected;
    files = entries;
    useWorldFolderStore.setState({ loading: false, files: [...entries.keys()].sort((left, right) => left.localeCompare(right)) });
  } catch (error) {
    if (id !== request) return;
    if (error instanceof DOMException && error.name === "AbortError") closeWorldFolder();
    else useWorldFolderStore.setState({ open: true, loading: false, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function openFolderWorld(name: string): Promise<void> {
  const selected = folder;
  const handle = files.get(name);
  if (selected === null || handle === undefined) return;
  const id = ++request;
  try {
    const file = await handle.getFile();
    if (id !== request) return;
    closeWorldFolder();
    await getDefaultWorldSession().open(file, handle, selected);
  } catch (error) {
    if (id === request) useWorldFolderStore.setState({ error: error instanceof Error ? error.message : String(error) });
  }
}
