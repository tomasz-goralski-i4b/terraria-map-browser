import { create } from "zustand";
import { collectTransferList, type WorldTilesResult } from "@studio/world-codec";
import { useAppStore } from "../store.js";
import { getDefaultWorldSession } from "./world-session.js";
import type { ExportResponse } from "./export-protocol.js";
import type { OpenWorldHandle } from "./world-file.js";
import { snapshotForExport } from "./export-snapshot.js";

interface Download {
  readonly url: string;
  readonly name: string;
}
interface ExportState {
  readonly busy: boolean;
  readonly message: string | null;
  readonly error: string | null;
  readonly download: Download | null;
  readonly canSave: boolean;
}
const EMPTY: ExportState = { busy: false, message: null, error: null, download: null, canSave: false };
export const useExportStore = create<ExportState>()(() => EMPTY);

interface Destination {
  isSameEntry(other: OpenWorldHandle): Promise<boolean>;
  createWritable(): Promise<{
    write(bytes: ArrayBuffer): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}
interface CopyDirectory {
  getFileHandle(name: string, options: { readonly create: boolean }): Promise<Destination>;
}
interface DirectoryPickerWindow {
  showDirectoryPicker?: (options: { readonly mode: "readwrite" }) => Promise<CopyDirectory>;
}

let current: AbortController | null = null;
let prepared: { readonly output: ArrayBuffer; readonly name: string; readonly source: OpenWorldHandle | null } | null = null;

/** Cancels pending work and releases the previous download when the opened world changes. */
export function resetWorldExport(): void {
  current?.abort();
  current = null;
  prepared = null;
  const download = useExportStore.getState().download;
  if (download !== null) URL.revokeObjectURL(download.url);
  useExportStore.setState(EMPTY);
}

async function prepare(world: WorldTilesResult, signal: AbortSignal): Promise<ArrayBuffer> {
  useExportStore.setState({ message: "Preparing world data for export…" });
  const snapshot = await snapshotForExport(world, signal);
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./export.worker.ts", import.meta.url), { type: "module" });
    const cleanup = (): void => { worker.terminate(); signal.removeEventListener("abort", abort); };
    const fail = (error: Error): void => { cleanup(); reject(error); };
    const abort = (): void => { fail(new DOMException("Export cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<ExportResponse>) => {
      if (signal.aborted) return;
      const response = event.data;
      if (response.type === "progress") useExportStore.setState({ message: response.message });
      else if (response.type === "failed") fail(new Error(response.message));
      else { cleanup(); resolve(response.output); }
    };
    worker.onerror = (event) => { event.preventDefault(); fail(new Error(event.message || "The export Worker failed")); };
    worker.onmessageerror = () => { fail(new Error("The export Worker response could not be read")); };
    try { worker.postMessage(snapshot, { transfer: collectTransferList(snapshot) }); }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
}

/** Serializes the current CWM through the writer; the same path handles unchanged and edited tiles. */
export async function exportWorld(): Promise<void> {
  const opened = getDefaultWorldSession().getOpenedFile();
  const world = getDefaultWorldSession().getLoadedWorld();
  if (opened === null || world === null || current !== null || useAppStore.getState().phase === "loading") return;
  resetWorldExport();
  const controller = new AbortController();
  current = controller;
  const active = (): boolean => current === controller && !controller.signal.aborted;
  const name = `${opened.file.name.replace(/\.wld$/i, "")}.copy.wld`;
  useExportStore.setState({ busy: true, message: "Preparing export…" });
  try {
    const output = await prepare(world, controller.signal);
    if (!active()) return;
    prepared = { output, name, source: opened.handle };
    const url = URL.createObjectURL(new Blob([output], { type: "application/octet-stream" }));
    useExportStore.setState({
      download: { url, name }, message: "Your world copy is ready to save or download.",
      canSave: opened.handle !== null && (window as DirectoryPickerWindow).showDirectoryPicker !== undefined,
    });
  } catch (error) {
    if (active()) {
      if (error instanceof DOMException && error.name === "AbortError") useExportStore.setState({ message: null });
      else useExportStore.setState({ message: null, error: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    if (active()) { current = null; useExportStore.setState({ busy: false }); }
  }
}

/** A fresh user gesture selects a folder without creating or truncating any file. */
export async function saveWorldCopy(): Promise<void> {
  const copy = prepared;
  const source = copy?.source ?? null;
  const picker = (window as DirectoryPickerWindow).showDirectoryPicker;
  if (copy === null || source === null || picker === undefined || current !== null) return;
  const controller = new AbortController();
  current = controller;
  const active = (): boolean => current === controller && !controller.signal.aborted;
  useExportStore.setState({ busy: true, error: null, message: `Choose a folder for ${copy.name}…` });
  try {
    // showSaveFilePicker may truncate a selected file before returning; this picker only chooses a directory.
    const directory = await picker.call(window, { mode: "readwrite" });
    if (!active()) return;
    let existing: Destination | null = null;
    try { existing = await directory.getFileHandle(copy.name, { create: false }); }
    catch (error) {
      if (!(error instanceof DOMException && error.name === "NotFoundError")) throw error;
    }
    if (!active()) return;
    if (existing !== null) {
      if (await existing.isSameEntry(source)) throw new Error("Export refused: this file is the original world.");
      throw new Error(`${copy.name} already exists. Choose another folder or use Download to save under another name.`);
    }
    const destination = await directory.getFileHandle(copy.name, { create: true });
    if (!active()) return;
    // Recheck after creation too: getFileHandle never truncates a file which appeared during the lookup.
    if (await destination.isSameEntry(source)) throw new Error("Export refused: this file is the original world.");
    if (!active()) return;
    useExportStore.setState({ message: "Writing the world copy…" });
    const writable = await destination.createWritable();
    try {
      if (!active()) { await writable.abort(); return; }
      await writable.write(copy.output);
      if (!active()) { await writable.abort(); return; }
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
    if (active()) {
      prepared = null;
      useExportStore.setState({ canSave: false, message: `Exported ${copy.name}.` });
    }
  } catch (error) {
    if (active()) {
      if (error instanceof DOMException && error.name === "AbortError") useExportStore.setState({ message: "Your world copy is ready to save or download." });
      else useExportStore.setState({ error: error instanceof Error ? error.message : String(error), message: null });
    }
  } finally {
    if (active()) { current = null; useExportStore.setState({ busy: false }); }
  }
}
