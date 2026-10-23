import { create } from "zustand";
import { notify } from "../shell/notification-store.js";
import { formatBytes } from "../panels/world-fields.js";
import { getMapController, rendererLayers, useViewStore, type MapLayers } from "../shell/view-store.js";
import type { Area } from "./area-clipboard.js";
import { useAreaStore } from "./area-session.js";
import { imageExportProblem, type ImageFormat } from "./image-export.js";
import type { ImageExportRequest, ImageExportResponse } from "./image-export.worker.js";
import { errorText, isAbort } from "./world-file.js";
import { getDefaultWorldSession } from "./world-session.js";

export type ImageScope = "world" | "view" | "selection";
/** The layers an export can leave out; sprites are not drawn (the image is in map colours). */
export type ImageLayers = Omit<MapLayers, "sprites">;

export interface ImageExportState {
  readonly open: boolean;
  readonly scope: ImageScope;
  readonly scale: number;
  readonly format: ImageFormat;
  readonly layers: ImageLayers;
  /** The running export: its fraction done, 0–1; null when none runs. */
  readonly progress: number | null;
}

export const useImageExportStore = create<ImageExportState>()(() => ({
  open: false, scope: "world", scale: 1, format: "png", layers: useViewStore.getState().layers, progress: null,
}));

const MIME: Readonly<Record<ImageFormat, string>> = { png: "image/png", jxl: "image/jxl" };
const PLANE_SLICE = 1 << 20;
let current: AbortController | null = null;

interface SaveFilePickerWindow {
  showSaveFilePicker?: (options: {
    readonly suggestedName: string;
    readonly types: readonly { readonly description: string; readonly accept: Readonly<Record<string, readonly string[]>> }[];
  }) => Promise<{ createWritable: () => Promise<{ write: (data: Blob) => Promise<void>; close: () => Promise<void> }> }>;
}

/** The tiles a scope covers, or null when it has none (no selection, no map). */
export function scopeArea(scope: ImageScope): Area | null {
  const world = getDefaultWorldSession().getLoadedWorld();
  if (world === null) return null;
  if (scope === "selection") return useAreaStore.getState().selection;
  if (scope === "view") return getMapController()?.viewArea() ?? null;
  return { x: 0, y: 0, width: world.metadata.width, height: world.metadata.height };
}

/** Why Export cannot run now, or null. */
export function imageExportReason(state: ImageExportState): string | null {
  if (state.progress !== null) return "An image export is already running";
  const area = scopeArea(state.scope);
  if (area === null) return state.scope === "selection" ? "Select an area first" : "Open a world first";
  return imageExportProblem(area, state.scale, state.format);
}

export function openImageExport(): void {
  const { selection } = useAreaStore.getState();
  useImageExportStore.setState({ open: true, layers: useViewStore.getState().layers, ...(selection === null ? {} : { scope: "selection" }) });
}

export function closeImageExport(): void {
  useImageExportStore.setState({ open: false });
}

export function cancelImageExport(): void {
  current?.abort();
}

/** Cancels a running export when the opened world changes. */
export function resetImageExport(): void {
  cancelImageExport();
  closeImageExport();
}

/** Copies the planes in slices that yield between them, so a Large world never holds the main thread for long. */
async function copyPlanes(planes: ImageExportRequest["planes"], signal: AbortSignal): Promise<ImageExportRequest["planes"]> {
  const copy: Record<string, ArrayBufferView> = {};
  for (const [name, plane] of Object.entries(planes)) {
    const target = new (plane.constructor as new (length: number) => Uint8Array)(plane.length);
    for (let offset = 0; offset < plane.length; offset += PLANE_SLICE) {
      signal.throwIfAborted();
      target.set((plane as Uint8Array).subarray(offset, offset + PLANE_SLICE), offset);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    copy[name] = target;
  }
  return copy as ImageExportRequest["planes"];
}

/** Renders the image in a Worker; progress goes to the store, cancelling terminates the Worker. */
export async function renderMapImage(request: ImageExportRequest, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<Blob> {
  const planes = await copyPlanes(request.planes, signal);
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./image-export.worker.ts", import.meta.url), { type: "module" });
    const finish = (): void => { worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = (): void => { finish(); reject(new DOMException("Export cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<ImageExportResponse>) => {
      const response = event.data;
      if (response.type === "progress") onProgress(response.fraction);
      else if (response.type === "failed") { finish(); reject(new Error(response.message)); }
      else { finish(); resolve(response.image); }
    };
    worker.onerror = (event) => { event.preventDefault(); finish(); reject(new Error(event.message || "The image export Worker failed")); };
    worker.postMessage({ ...request, planes }, Object.values(planes).map((plane) => plane.buffer as ArrayBuffer));
  });
}

/**
 * Export: asks where to save first (the browser allows the picker only right after the click), then renders in the
 * background with progress and Cancel in the status bar's job cell. Without a save picker the image is downloaded.
 */
export async function runImageExport(): Promise<void> {
  const state = useImageExportStore.getState();
  const world = getDefaultWorldSession().getLoadedWorld();
  const area = scopeArea(state.scope);
  if (world === null || area === null || imageExportReason(state) !== null) return;
  const name = `${world.metadata.name.replace(/[\\/:*?"<>|]/g, "_") || "map"}.${state.format}`;
  const picker = (window as SaveFilePickerWindow).showSaveFilePicker;
  let handle: Awaited<ReturnType<NonNullable<SaveFilePickerWindow["showSaveFilePicker"]>>> | null = null;
  try {
    if (typeof picker === "function") {
      handle = await picker({ suggestedName: name, types: [{ description: state.format === "png" ? "PNG image" : "JPEG XL image", accept: { [MIME[state.format]]: [`.${state.format}`] } }] });
    }
  } catch (error) {
    if (!isAbort(error)) notify({ kind: "error", title: "Could not choose where to save", detail: errorText(error) });
    return;
  }
  const controller = new AbortController();
  current = controller;
  useImageExportStore.setState({ open: false, progress: 0 });
  try {
    const { width, height, surfaceLevel, rockLevel } = world.metadata;
    const image = await renderMapImage({
      width, height, surfaceY: surfaceLevel, rockY: rockLevel, planes: world.planes, palette: world.palette, area,
      scale: state.scale, layers: rendererLayers({ ...state.layers, sprites: false }), format: state.format,
    }, controller.signal, (fraction) => { useImageExportStore.setState({ progress: fraction }); });
    if (handle === null) download(image, name);
    else {
      const writable = await handle.createWritable();
      await writable.write(image);
      await writable.close();
    }
    notify({ kind: "success", title: `Exported ${name}`, detail: `${String(area.width * state.scale)} × ${String(area.height * state.scale)} px · ${formatBytes(image.size)}` });
  } catch (error) {
    if (!isAbort(error)) notify({ kind: "error", title: "Image export failed", detail: errorText(error) });
  } finally {
    if (current === controller) current = null;
    useImageExportStore.setState({ progress: null });
  }
}

function download(image: Blob, name: string): void {
  const url = URL.createObjectURL(image);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => { URL.revokeObjectURL(url); }, 60_000);
}
