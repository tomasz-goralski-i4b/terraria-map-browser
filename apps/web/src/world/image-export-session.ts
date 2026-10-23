import { create } from "zustand";
import type { WorldTilesResult } from "@studio/world-codec";
import { notify } from "../shell/notification-store.js";
import { formatBytes } from "../panels/world-fields.js";
import { getMapController, rendererLayers, useViewStore, type MapLayers } from "../shell/view-store.js";
import type { Area } from "./area-clipboard.js";
import { useAreaStore } from "./area-session.js";
import { imageExportProblem, type ImageFormat } from "./image-export.js";
import type { ImageExportMessage, ImageExportResponse, MapImageRequest } from "./image-export.worker.js";
import { getDefaultAssetSession } from "../assets/asset-session.js";
import { getBlockFraming } from "./block-framing.js";
import { toRenderableWorld } from "./renderable-world.js";
import { TEXTURED_MIN_SCALE, texturedBands } from "./textured-image.js";
import { errorText, isAbort } from "./world-file.js";
import { getDefaultWorldSession } from "./world-session.js";

export type ImageScope = "world" | "view" | "selection";
/** Map colours (the CPU reference renderer, in a Worker) or the game's textures (the WebGL2 renderer, as the map up close). */
export type ImageStyle = "map" | "textured";
/** The layers an export can leave out; the style decides whether sprites are drawn. */
export type ImageLayers = Omit<MapLayers, "sprites">;

export interface ImageExportState {
  readonly open: boolean;
  readonly scope: ImageScope;
  readonly scale: number;
  readonly style: ImageStyle;
  readonly format: ImageFormat;
  readonly layers: ImageLayers;
  /** The running export: its fraction done, 0–1; null when none runs. */
  readonly progress: number | null;
}

export const useImageExportStore = create<ImageExportState>()(() => ({
  open: false, scope: "world", scale: 1, style: "map", format: "png", layers: useViewStore.getState().layers, progress: null,
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
  if (state.style === "textured") {
    if (getDefaultAssetSession().getAtlas() === null) return "Connect the game's Images folder to export textures";
    if (state.scale < TEXTURED_MIN_SCALE) return `Textures need ${String(TEXTURED_MIN_SCALE)} or more pixels per block`;
  }
  return imageExportProblem(area, state.scale, state.format);
}

/** Textures are drawn whole only from `TEXTURED_MIN_SCALE`: choosing them raises a smaller scale to their native 16. */
export function setImageStyle(style: ImageStyle): void {
  const { scale } = useImageExportStore.getState();
  useImageExportStore.setState(style === "textured" && scale < TEXTURED_MIN_SCALE ? { style, scale: 16 } : { style });
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
async function copyPlanes(planes: MapImageRequest["planes"], signal: AbortSignal): Promise<MapImageRequest["planes"]> {
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
  return copy as MapImageRequest["planes"];
}

interface ExportWorker {
  readonly post: (message: ImageExportMessage, transfer?: Transferable[]) => void;
  /** Settles when the Worker has encoded `bands` bands, or rejects with its failure. */
  readonly encoded: (bands: number) => Promise<void>;
  readonly image: Promise<Blob>;
}

/** The encoding Worker: progress goes to `onProgress`, cancelling terminates it. */
function startExportWorker(signal: AbortSignal, onProgress: (fraction: number) => void): ExportWorker {
  const worker = new Worker(new URL("./image-export.worker.ts", import.meta.url), { type: "module" });
  let bands = 0;
  let wake = (): void => undefined;
  const image = new Promise<Blob>((resolve, reject) => {
    const finish = (): void => { worker.terminate(); signal.removeEventListener("abort", abort); };
    const abort = (): void => { finish(); reject(new DOMException("Export cancelled", "AbortError")); };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<ImageExportResponse>) => {
      const response = event.data;
      if (response.type === "progress") { bands++; wake(); onProgress(response.fraction); }
      else if (response.type === "failed") { finish(); reject(new Error(response.message)); }
      else { finish(); resolve(response.image); }
    };
    worker.onerror = (event) => { event.preventDefault(); finish(); reject(new Error(event.message || "The image export Worker failed")); };
  });
  // The caller awaits it; this only keeps a failure that arrives between awaits from being reported as unhandled.
  image.catch(() => undefined);
  const encoded = async (count: number): Promise<void> => {
    while (bands < count) await Promise.race([new Promise<void>((resolve) => { wake = resolve; }), image]);
  };
  return { post: (message, transfer = []) => { worker.postMessage(message, transfer); }, encoded, image };
}

/** Map colours: the Worker renders and encodes from a copy of the planes. */
export async function renderMapImage(request: MapImageRequest, signal: AbortSignal, onProgress: (fraction: number) => void): Promise<Blob> {
  const planes = await copyPlanes(request.planes, signal);
  const job = startExportWorker(signal, onProgress);
  job.post({ ...request, planes }, Object.values(planes).map((plane) => plane.buffer as ArrayBuffer));
  return job.image;
}

/** Textures: drawn here band by band and encoded in the Worker with at most two bands waiting, so memory stays bounded. */
async function renderTexturedImage(
  world: WorldTilesResult, area: Area, state: ImageExportState, signal: AbortSignal, onProgress: (fraction: number) => void,
): Promise<Blob> {
  const atlas = getDefaultAssetSession().getAtlas();
  if (atlas === null) throw new Error("Connect the game's Images folder to export textures");
  // Without the framing database self-framed blocks keep their map colours, as on the map.
  const framing = await getBlockFraming().catch(() => null);
  const job = startExportWorker(signal, onProgress);
  job.post({ type: "start", width: area.width * state.scale, height: area.height * state.scale, format: state.format });
  const layers = rendererLayers({ ...state.layers, sprites: true });
  let sent = 0;
  for await (const band of texturedBands(toRenderableWorld(world), area, state.scale, layers, { atlas, framing }, signal)) {
    job.post({ type: "band", band }, [band.pixels.buffer]);
    sent++;
    await job.encoded(sent - 2);
  }
  job.post({ type: "end" });
  return job.image;
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
    const onProgress = (fraction: number): void => { useImageExportStore.setState({ progress: fraction }); };
    const image = state.style === "textured"
      ? await renderTexturedImage(world, area, state, controller.signal, onProgress)
      : await renderMapImage({
        type: "map", width, height, surfaceY: surfaceLevel, rockY: rockLevel, planes: world.planes, palette: world.palette, area,
        scale: state.scale, layers: rendererLayers({ ...state.layers, sprites: false }), format: state.format,
      }, controller.signal, onProgress);
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
