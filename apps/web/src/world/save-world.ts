import { create } from "zustand";
import { collectTransferList, type WorldTilesResult } from "@studio/world-codec";
import { formatBytes } from "../panels/world-fields.js";
import { notify } from "../shell/notification-store.js";
import { useAppStore } from "../store.js";
import type { ExportResponse, ExportStage } from "./export-protocol.js";
import { snapshotForExport } from "./export-snapshot.js";
import {
  ensurePermission, errorText, isAbort, WORLD_PICKER_LOCATION,
  type OpenWorldHandle, type WorldCopyDestination, type WorldSaveDirectory,
} from "./world-file.js";
import { worldsFolder } from "./world-library.js";
import { getDefaultWorldSession } from "./world-session.js";

/**
 * File ▸ Save As…: one dialog that names the file, shows where it goes and saves it there, with Download as the
 * alternative. Nothing touches the disk until the world has been encoded and read back to the same world; the opened
 * world's own file is never overwritten, and an existing file is replaced only after the user confirms.
 */
export type SaveStage = "idle" | "permission" | ExportStage | "writing";

export interface SaveDialogState {
  readonly open: boolean;
  readonly fileName: string;
  /** Where Save writes; null until a folder is chosen. */
  readonly folderName: string | null;
  /** The browser can pick folders (File System Access); without it only Download is offered. */
  readonly canPickFolder: boolean;
  readonly stage: SaveStage;
  readonly error: string | null;
  /** The named file exists in the folder: Save turns into Replace. */
  readonly replacing: boolean;
  /** Facts shown next to the name: the world's format, kept as it was. */
  readonly formatVersion: number | null;
  /** Bumped when the app replaces the name (the suggestion): the dialog selects it again. */
  readonly nameRevision: number;
}

const CLOSED: SaveDialogState = {
  open: false, fileName: "", folderName: null, canPickFolder: false, stage: "idle", error: null, replacing: false, formatVersion: null,
  nameRevision: 0,
};
export const useSaveStore = create<SaveDialogState>()(() => CLOSED);

interface DirectoryPickerWindow {
  showDirectoryPicker?: (options: { readonly id: string; readonly startIn: string; readonly mode: "readwrite" }) => Promise<WorldSaveDirectory>;
}

let destination: WorldSaveDirectory | null = null;
let current: AbortController | null = null;
/** Bumped by every suggestion and folder change: a late suggestion for an old folder never lands. */
let suggestion = 0;
const downloads = new Set<string>();
const DOWNLOAD_URL_LIFETIME_MS = 60_000;

function picker(): DirectoryPickerWindow["showDirectoryPicker"] {
  const candidate = (window as DirectoryPickerWindow).showDirectoryPicker;
  return typeof candidate === "function" ? candidate : undefined;
}

function folderLabel(directory: WorldSaveDirectory): string {
  return directory.name ?? "the chosen folder";
}

/** `name.wld`, or why the name cannot be used. */
export function normalizeWorldFileName(input: string): { readonly name: string } | { readonly error: string } {
  const trimmed = input.trim();
  const name = /\.wld$/i.test(trimmed) ? trimmed : `${trimmed}.wld`;
  if (trimmed.length === 0 || name.length === 4) return { error: "Enter a file name." };
  if (/[\\/:*?"<>|]/.test(name) || name.startsWith(".")) return { error: "A file name cannot contain \\ / : * ? \" < > | or start with a dot." };
  return { name };
}

async function exists(directory: WorldSaveDirectory, name: string): Promise<WorldCopyDestination | null> {
  try {
    return await directory.getFileHandle(name, { create: false });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "TypeMismatchError")) return null;
    throw error;
  }
}

/** The opened file's name when the folder lacks it (another folder), else the first free `name (n).wld`. */
async function suggestName(base: string, directory: WorldSaveDirectory | null): Promise<string> {
  if (directory === null) return `${base}.wld`;
  try {
    for (let index = 1; index < 100; index++) {
      const candidate = index === 1 ? `${base}.wld` : `${base} (${String(index)}).wld`;
      if ((await exists(directory, candidate)) === null) return candidate;
    }
  } catch {
    // Without read access the folder cannot be checked; Save checks again before writing.
  }
  return `${base} (2).wld`;
}

function encode(world: WorldTilesResult, signal: AbortSignal, onStage: (stage: ExportStage) => void): Promise<ArrayBuffer> {
  return snapshotForExport(world, signal).then((snapshot) => new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
    const cleanup = (): void => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const fail = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const abort = (): void => {
      fail(new DOMException("Save cancelled", "AbortError"));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<ExportResponse>) => {
      if (signal.aborted) return;
      const response = event.data;
      if (response.type === "progress") onStage(response.stage);
      else if (response.type === "failed") fail(new Error(response.message));
      else {
        cleanup();
        resolve(response.output);
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail(new Error(event.message || "The save Worker failed"));
    };
    worker.onmessageerror = () => {
      fail(new Error("The save Worker's response could not be read"));
    };
    try {
      worker.postMessage(snapshot, { transfer: collectTransferList(snapshot) });
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  }));
}

/**
 * `getFileHandle({ create: true })` leaves an empty file behind; a cancelled or failed save removes it, so the folder
 * shows no empty "world". Only a file that is still empty and is not the opened world is removed.
 */
async function removeIfEmpty(directory: WorldSaveDirectory, handle: WorldCopyDestination, name: string, source: OpenWorldHandle | null): Promise<void> {
  try {
    if (directory.removeEntry === undefined || handle.getFile === undefined) return;
    if (source !== null && await handle.isSameEntry(source)) return;
    if ((await handle.getFile()).size === 0) await directory.removeEntry(name);
  } catch {
    // Nothing more to clean up: the save already reports its own failure.
  }
}

/** Opens the Save As dialog for the loaded world. */
export async function openSaveAs(): Promise<void> {
  const session = getDefaultWorldSession();
  const opened = session.getOpenedFile();
  const world = session.getLoadedWorld();
  if (opened === null || world === null || useAppStore.getState().phase === "loading") return;
  resetWorldSave();
  destination = opened.directory ?? worldsFolder();
  const base = opened.file.name.replace(/\.wld$/i, "");
  const canPickFolder = picker() !== undefined;
  useSaveStore.setState({
    ...CLOSED, open: true, fileName: `${base}.wld`, folderName: destination === null ? null : folderLabel(destination),
    canPickFolder, formatVersion: world.header.version,
  });
  const id = ++suggestion;
  const suggested = await suggestName(base, destination);
  const state = useSaveStore.getState();
  // Only the untouched default of this folder is replaced: not after typing, a folder change or a started save.
  if (id === suggestion && state.open && state.stage === "idle" && state.fileName === `${base}.wld` && suggested !== state.fileName) {
    useSaveStore.setState({ fileName: suggested, nameRevision: state.nameRevision + 1 });
  }
}

export function setSaveFileName(fileName: string): void {
  useSaveStore.setState({ fileName, replacing: false, error: null });
}

/** Picks the destination folder with write access; picking a folder never creates or changes a file. */
export async function chooseSaveFolder(): Promise<void> {
  const pick = picker();
  if (pick === undefined || current !== null) return;
  try {
    destination = await pick.call(window, { ...WORLD_PICKER_LOCATION, mode: "readwrite" });
    suggestion++;
    useSaveStore.setState({ folderName: folderLabel(destination), replacing: false, error: null });
  } catch (error) {
    if (!isAbort(error)) useSaveStore.setState({ error: errorText(error) });
  }
}

function begin(): { readonly controller: AbortController; readonly active: () => boolean } {
  const controller = new AbortController();
  current = controller;
  return { controller, active: () => current === controller && !controller.signal.aborted };
}

function finish(controller: AbortController): void {
  if (current === controller) current = null;
}

/** Save (or Replace, after the user confirmed it): encode, verify, then write the file in the destination folder. */
export async function confirmSave(): Promise<void> {
  const session = getDefaultWorldSession();
  const opened = session.getOpenedFile();
  const world = session.getLoadedWorld();
  const directory = destination;
  const state = useSaveStore.getState();
  if (opened === null || world === null || directory === null || current !== null || !state.open) return;
  const parsed = normalizeWorldFileName(state.fileName);
  if ("error" in parsed) {
    useSaveStore.setState({ error: parsed.error });
    return;
  }
  const { name } = parsed;
  const source: OpenWorldHandle | null = opened.handle;
  const { controller, active } = begin();
  useSaveStore.setState({ fileName: name, error: null, stage: "permission" });
  try {
    // Asked here, on the Save click: opening a world never asks for write access.
    if (!(await ensurePermission(directory, "readwrite", true))) {
      throw new Error(`Saving needs permission to change files in “${folderLabel(directory)}”. Nothing was saved.`);
    }
    if (!active()) return;
    const existing = await exists(directory, name);
    if (!active()) return;
    if (existing !== null) {
      if (source !== null && await existing.isSameEntry(source)) {
        throw new Error(`“${name}” is the world you opened. Choose another name: the original is never overwritten.`);
      }
      if (source === null) {
        throw new Error(`“${name}” already exists, and it may be the world you opened. Choose another name.`);
      }
      if (!state.replacing) {
        useSaveStore.setState({ replacing: true, stage: "idle" });
        return;
      }
    }
    useSaveStore.setState({ stage: "encoding" });
    const output = await encode(world, controller.signal, (stage) => {
      if (active()) useSaveStore.setState({ stage });
    });
    if (!active()) return;
    useSaveStore.setState({ stage: "writing" });
    if (existing === null) {
      // Encoding takes a while: a file that appeared meanwhile is replaced only after a confirmation, as one found before.
      const appeared = await exists(directory, name);
      if (!active()) return;
      if (appeared !== null) {
        if (source === null || await appeared.isSameEntry(source)) {
          throw new Error(`“${name}” appeared in “${folderLabel(directory)}” while saving. Nothing was saved; choose another name.`);
        }
        useSaveStore.setState({ replacing: true, stage: "idle" });
        return;
      }
    }
    const handle = await directory.getFileHandle(name, { create: true });
    let written = false;
    try {
      if (!active()) return;
      // Checked again after creation: a file that appeared meanwhile is not truncated by getFileHandle.
      if (source !== null && await handle.isSameEntry(source)) throw new Error(`“${name}” is the world you opened. Nothing was saved.`);
      const writable = await handle.createWritable();
      try {
        await writable.write(output);
        if (!active()) {
          await writable.abort();
          return;
        }
        // The browser writes to a temporary file and swaps it in on close: a failed save leaves the old file intact.
        await writable.close();
        written = true;
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
    } finally {
      if (!written && existing === null) await removeIfEmpty(directory, handle, name, source);
    }
    finish(controller);
    useSaveStore.setState(CLOSED);
    useAppStore.getState().setUnsavedChanges(false);
    notify({ kind: "success", title: `Saved ${name}`, detail: `${formatBytes(output.byteLength)} in “${folderLabel(directory)}” · verified by reading it back` });
  } catch (error) {
    if (active()) useSaveStore.setState({ stage: "idle", error: isAbort(error) ? null : errorText(error) });
  } finally {
    finish(controller);
  }
}

/** Download: the same encoded and verified bytes, handed to the browser's downloads. */
export async function downloadWorldCopy(): Promise<void> {
  const session = getDefaultWorldSession();
  const world = session.getLoadedWorld();
  const state = useSaveStore.getState();
  if (world === null || current !== null || !state.open) return;
  const parsed = normalizeWorldFileName(state.fileName);
  if ("error" in parsed) {
    useSaveStore.setState({ error: parsed.error });
    return;
  }
  const { name } = parsed;
  const { controller, active } = begin();
  useSaveStore.setState({ fileName: name, error: null, replacing: false, stage: "encoding" });
  try {
    const output = await encode(world, controller.signal, (stage) => {
      if (active()) useSaveStore.setState({ stage });
    });
    if (!active()) return;
    const url = URL.createObjectURL(new Blob([output], { type: "application/octet-stream" }));
    downloads.add(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => {
      if (downloads.delete(url)) URL.revokeObjectURL(url);
    }, DOWNLOAD_URL_LIFETIME_MS);
    finish(controller);
    useSaveStore.setState(CLOSED);
    useAppStore.getState().setUnsavedChanges(false);
    notify({ kind: "success", title: `Downloaded ${name}`, detail: `${formatBytes(output.byteLength)} · verified by reading it back` });
  } catch (error) {
    if (active()) useSaveStore.setState({ stage: "idle", error: isAbort(error) ? null : errorText(error) });
  } finally {
    finish(controller);
  }
}

/** Closes the dialog, cancelling work in progress; nothing is written after a cancel. */
export function closeSaveAs(): void {
  current?.abort();
  current = null;
  useSaveStore.setState(CLOSED);
}

/** Cancels saving and releases downloads when the opened world changes. */
export function resetWorldSave(): void {
  closeSaveAs();
  destination = null;
  for (const url of downloads) URL.revokeObjectURL(url);
  downloads.clear();
}
