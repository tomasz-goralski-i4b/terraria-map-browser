import { create } from "zustand";
import { deleteStored, readStored, writeStored } from "../handle-db.js";
import { useAppStore } from "../store.js";
import { notify } from "../shell/notification-store.js";
import {
  ensurePermission, errorText, isAbort, WORLD_PICKER_LOCATION,
  type OpenWorldHandle, type WorldFolderDirectory, type WorldFolderFile, type WorldSaveDirectory,
} from "./world-file.js";
import { getDefaultWorldSession } from "./world-session.js";

/**
 * The worlds the app knows about: the remembered worlds folder (listed in File ▸ Worlds and on the start screen) and
 * the recently opened files (File ▸ Open Recent). Handles live in IndexedDB and in this module, never in React state;
 * the store holds only what menus display. The folder is opened read-only: write access is asked for by Save As.
 */
export interface FolderWorld {
  readonly fileName: string;
  readonly size: number;
  /** Last modified, in ms since the epoch. */
  readonly modified: number;
}

export type WorldsFolderState =
  | { readonly kind: "none" }
  /** Remembered from an earlier visit; the browser wants a click before it lists the folder again. */
  | { readonly kind: "permission"; readonly name: string }
  | { readonly kind: "listing"; readonly name: string }
  | { readonly kind: "ready"; readonly name: string; readonly worlds: readonly FolderWorld[] }
  | { readonly kind: "failed"; readonly name: string; readonly message: string };

export interface RecentWorld {
  readonly fileName: string;
  readonly worldName: string;
  readonly openedAt: number;
}

interface LibraryState {
  readonly folder: WorldsFolderState;
  readonly recent: readonly RecentWorld[];
}

const EMPTY: LibraryState = { folder: { kind: "none" }, recent: [] };
export const useWorldLibrary = create<LibraryState>()(() => EMPTY);

export const RECENT_LIMIT = 8;
const FOLDER_KEY = "worlds-folder";
const RECENT_KEY = "recent-worlds";

interface StoredRecent extends RecentWorld {
  readonly handle: OpenWorldHandle;
}

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options: { readonly id: string; readonly startIn: string; readonly mode: "read" }) => Promise<WorldFolderDirectory>;
}

let folder: WorldFolderDirectory | null = null;
let folderFiles = new Map<string, WorldFolderFile>();
let recent: StoredRecent[] = [];
/** Bumped by every folder change, so a slow listing of an older folder never lands. */
let generation = 0;
/** Bumped by every open from the folder or Open Recent: a slow file read never overtakes a later choice. */
let openRequest = 0;

export function hasFolderPicker(): boolean {
  return typeof (window as DirectoryPickerWindow).showDirectoryPicker === "function";
}

/** The remembered worlds folder, for Save As. */
export function worldsFolder(): WorldFolderDirectory | null {
  return folder;
}

function publishRecent(): void {
  useWorldLibrary.setState({ recent: recent.map(({ fileName, worldName, openedAt }) => ({ fileName, worldName, openedAt })) });
}

async function listFolder(selected: WorldFolderDirectory): Promise<void> {
  const id = ++generation;
  folder = selected;
  useWorldLibrary.setState({ folder: { kind: "listing", name: selected.name } });
  try {
    const entries = new Map<string, WorldFolderFile>();
    const worlds: FolderWorld[] = [];
    for await (const entry of selected.values()) {
      if (id !== generation) return;
      if (entry.kind !== "file" || !/\.wld$/i.test(entry.name)) continue;
      const file = await entry.getFile();
      entries.set(entry.name, entry);
      worlds.push({ fileName: entry.name, size: file.size, modified: file.lastModified });
    }
    if (id !== generation) return;
    folderFiles = entries;
    worlds.sort((left, right) => right.modified - left.modified || left.fileName.localeCompare(right.fileName));
    useWorldLibrary.setState({ folder: { kind: "ready", name: selected.name, worlds } });
  } catch (error) {
    if (id === generation) useWorldLibrary.setState({ folder: { kind: "failed", name: selected.name, message: errorText(error) } });
  }
}

/** File ▸ Open Folder…: picks the worlds folder (read-only) and remembers it for later visits. */
export async function chooseWorldsFolder(): Promise<void> {
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (picker === undefined) return;
  let selected: WorldFolderDirectory;
  try {
    selected = await picker.call(window, { ...WORLD_PICKER_LOCATION, mode: "read" });
  } catch (error) {
    if (isAbort(error)) return;
    notify({ kind: "error", title: "Could not open the folder", detail: errorText(error) });
    return;
  }
  await writeStored(FOLDER_KEY, selected).catch(() => undefined);
  await listFolder(selected);
  const state = useWorldLibrary.getState().folder;
  if (state.kind === "ready") {
    const count = state.worlds.length;
    notify({
      kind: count === 0 ? "info" : "success",
      title: count === 0 ? `No worlds in “${state.name}”` : `${String(count)} ${count === 1 ? "world" : "worlds"} in “${state.name}”`,
      detail: count === 0 ? "Terraria keeps worlds in Documents\\My Games\\Terraria\\Worlds." : "Open them from File ▸ Worlds.",
    });
  }
}

/** Lists a remembered folder again after the browser asked for a click (a new visit). */
export async function reconnectWorldsFolder(): Promise<void> {
  const remembered = folder;
  if (remembered === null) return;
  if (await ensurePermission(remembered, "read", true)) await listFolder(remembered);
}

export async function forgetWorldsFolder(): Promise<void> {
  generation++;
  folder = null;
  folderFiles = new Map();
  useWorldLibrary.setState({ folder: { kind: "none" } });
  await deleteStored(FOLDER_KEY).catch(() => undefined);
}

export async function openFolderWorld(fileName: string): Promise<void> {
  const selected = folder;
  const entry = folderFiles.get(fileName);
  if (selected === null || entry === undefined) return;
  const id = ++openRequest;
  try {
    const file = await entry.getFile();
    if (id === openRequest) await getDefaultWorldSession().open(file, entry, selected);
  } catch (error) {
    if (id === openRequest) notify({ kind: "error", title: `Could not open ${fileName}`, detail: errorText(error) });
  }
}

/** The remembered folder, when it holds `handle` directly: Save As then defaults to it. */
export async function folderForWorld(handle: OpenWorldHandle): Promise<WorldSaveDirectory | null> {
  const selected = folder;
  if (selected?.resolve === undefined) return null;
  try {
    const path = await selected.resolve(handle);
    return path?.length === 1 ? selected : null;
  } catch {
    return null; // a revoked folder permission must not prevent opening a separately granted file
  }
}

export async function openRecentWorld(index: number): Promise<void> {
  const entry = recent[index];
  if (entry === undefined) return;
  const id = ++openRequest;
  try {
    if (!(await ensurePermission(entry.handle, "read", true))) {
      notify({ kind: "error", title: `No access to ${entry.fileName}`, detail: "The browser did not allow reading the file again. Open it with File ▸ Open World…" });
      return;
    }
    const file = await entry.handle.getFile();
    const directory = await folderForWorld(entry.handle);
    if (id === openRequest) await getDefaultWorldSession().open(file, entry.handle, directory ?? undefined);
  } catch (error) {
    recent = recent.filter((candidate) => candidate !== entry);
    publishRecent();
    await writeStored(RECENT_KEY, recent).catch(() => undefined);
    notify({ kind: "error", title: `Could not open ${entry.fileName}`, detail: `${errorText(error)} It was removed from Open Recent.` });
  }
}

export async function clearRecentWorlds(): Promise<void> {
  recent = [];
  publishRecent();
  await deleteStored(RECENT_KEY).catch(() => undefined);
}

async function sameFile(left: OpenWorldHandle, right: OpenWorldHandle): Promise<boolean> {
  if (left === right) return true;
  const same = (left as Partial<{ isSameEntry: (other: OpenWorldHandle) => Promise<boolean> }>).isSameEntry;
  return same === undefined ? false : same.call(left, right).catch(() => false);
}

/** Opens are recorded one after another: two quick opens must not both start from the same list. */
let recording: Promise<void> = Promise.resolve();

async function recordOpened(): Promise<void> {
  const opened = getDefaultWorldSession().getOpenedFile();
  const summary = useAppStore.getState().summary;
  if (opened?.handle == null || summary === null) return;
  const { handle } = opened;
  const others: StoredRecent[] = [];
  for (const entry of recent) {
    if (!(await sameFile(entry.handle, handle))) others.push(entry);
  }
  recent = [{ fileName: opened.file.name, worldName: summary.name, openedAt: Date.now(), handle }, ...others].slice(0, RECENT_LIMIT);
  publishRecent();
  await writeStored(RECENT_KEY, recent).catch(() => undefined);
}

/**
 * Restores the remembered folder and recent worlds and starts recording opened worlds. A folder whose permission
 * lapsed waits for a click; a folder the browser forgot is dropped. Returns the stop function.
 */
export function startWorldLibrary(): () => void {
  let stopped = false;
  // Read through a call: the restore awaits, and the stop function may run meanwhile.
  const isStopped = (): boolean => stopped;
  void (async () => {
    const [storedFolder, storedRecent] = await Promise.all([
      readStored<WorldFolderDirectory>(FOLDER_KEY).catch(() => null),
      readStored<StoredRecent[]>(RECENT_KEY).catch(() => null),
    ]);
    if (isStopped()) return;
    if (Array.isArray(storedRecent) && recent.length === 0) {
      recent = storedRecent.slice(0, RECENT_LIMIT);
      publishRecent();
    }
    if (storedFolder !== null && folder === null) {
      folder = storedFolder;
      if (await ensurePermission(storedFolder, "read", false)) await listFolder(storedFolder);
      else if (!isStopped() && folder === storedFolder) useWorldLibrary.setState({ folder: { kind: "permission", name: storedFolder.name } });
    }
  })();
  const unsubscribe = useAppStore.subscribe((state, previous) => {
    if (state.summary !== null && state.summary !== previous.summary) recording = recording.then(recordOpened, recordOpened);
  });
  return () => {
    stopped = true;
    unsubscribe();
  };
}

/** Forgets everything in memory (a freshly mounted app); what IndexedDB holds is restored by `startWorldLibrary`. */
export function resetWorldLibrary(): void {
  generation++;
  folder = null;
  folderFiles = new Map();
  recent = [];
  useWorldLibrary.setState(EMPTY);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "5 min ago", "3 h ago", "yesterday", "4 days ago", then the date. */
export function formatAge(time: number, now: number): string {
  const age = Math.max(0, now - time);
  if (age < MINUTE) return "just now";
  if (age < HOUR) return `${String(Math.floor(age / MINUTE))} min ago`;
  if (age < DAY) return `${String(Math.floor(age / HOUR))} h ago`;
  if (age < 2 * DAY) return "yesterday";
  if (age < 7 * DAY) return `${String(Math.floor(age / DAY))} days ago`;
  return new Date(time).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
