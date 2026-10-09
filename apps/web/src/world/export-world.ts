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
}
const EMPTY: ExportState = { busy: false, message: null, error: null, download: null };
export const useExportStore = create<ExportState>()(() => EMPTY);

interface Destination {
  isSameEntry(other: OpenWorldHandle): Promise<boolean>;
  createWritable(): Promise<{
    write(bytes: ArrayBuffer): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}
interface SavePickerWindow {
  showSaveFilePicker?: (options: {
    readonly suggestedName: string;
    readonly types: readonly { readonly description: string; readonly accept: Record<string, readonly string[]> }[];
  }) => Promise<Destination>;
}

let current: AbortController | null = null;

/** Cancels pending work and releases the previous download when the opened world changes. */
export function resetWorldExport(): void {
  current?.abort();
  current = null;
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
    const picker = (window as SavePickerWindow).showSaveFilePicker;
    let destination: Destination | null = null;
    // Invoke the picker during the user gesture. Without a source handle only download can protect the original.
    if (picker !== undefined && opened.handle !== null) {
      useExportStore.setState({ message: "Choose a new file for the copy…" });
      destination = await picker.call(window, {
        suggestedName: name,
        types: [{ description: "Terraria world", accept: { "application/octet-stream": [".wld"] } }],
      });
      if (!active()) return;
      if (await destination.isSameEntry(opened.handle)) throw new Error("Export refused: choose a different file to protect the original world.");
      if (!active()) return;
    }
    const output = await prepare(world, controller.signal);
    if (!active()) return;
    if (destination === null) {
      const url = URL.createObjectURL(new Blob([output], { type: "application/octet-stream" }));
      useExportStore.setState({ download: { url, name }, message: "Your world copy is ready to download." });
    } else {
      useExportStore.setState({ message: "Writing the world copy…" });
      const writable = await destination.createWritable();
      try {
        if (!active()) { await writable.abort(); return; }
        await writable.write(output);
        if (!active()) { await writable.abort(); return; }
        await writable.close();
      } catch (error) {
        await writable.abort().catch(() => undefined);
        throw error;
      }
      if (active()) useExportStore.setState({ message: `Exported ${name}.` });
    }
  } catch (error) {
    if (active()) {
      if (error instanceof DOMException && error.name === "AbortError") useExportStore.setState({ message: null });
      else useExportStore.setState({ message: null, error: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    if (active()) { current = null; useExportStore.setState({ busy: false }); }
  }
}
