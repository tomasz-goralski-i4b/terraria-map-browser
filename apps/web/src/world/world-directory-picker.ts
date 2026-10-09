import { create } from "zustand";
import { WORLD_PICKER_LOCATION, type WorldFolderDirectory } from "./world-file.js";

export const FOLDER_HINT_PREFERENCE = "terraria-world-folder-hint-hidden";
interface PickerWindow {
  showDirectoryPicker?: (options: { readonly mode: "readwrite"; readonly id: string; readonly startIn: "documents" }) => Promise<WorldFolderDirectory>;
}
const EMPTY = { open: false, dontShowAgain: false };
export const useFolderHintStore = create(() => EMPTY);
interface HintRequest {
  readonly picker: NonNullable<PickerWindow["showDirectoryPicker"]>;
  readonly resolve: (directory: WorldFolderDirectory) => void;
  readonly reject: (error: unknown) => void;
}
let pending: HintRequest | null = null;

export function closeFolderHint(): void {
  const request = pending;
  pending = null;
  useFolderHintStore.setState(EMPTY);
  request?.reject(new DOMException("Folder selection cancelled", "AbortError"));
}

/** Called directly by the confirmation click, preserving native-picker user activation. */
export function confirmFolderHint(): void {
  const request = pending;
  if (request === null) return;
  pending = null;
  if (useFolderHintStore.getState().dontShowAgain) {
    try { localStorage.setItem(FOLDER_HINT_PREFERENCE, "1"); }
    catch { /* Folder access still works when browser storage is unavailable. */ }
  }
  useFolderHintStore.setState(EMPTY);
  try { void request.picker.call(window, { ...WORLD_PICKER_LOCATION, mode: "readwrite" }).then(request.resolve, request.reject); }
  catch (error) { request.reject(error); }
}

export async function pickWorldDirectory(signal?: AbortSignal): Promise<WorldFolderDirectory> {
  const picker = (window as PickerWindow).showDirectoryPicker;
  if (picker === undefined) throw new Error("Folder access is unavailable in this browser");
  if (signal?.aborted) throw new DOMException("Folder selection cancelled", "AbortError");
  closeFolderHint();
  let hidden = false;
  try { hidden = localStorage.getItem(FOLDER_HINT_PREFERENCE) === "1"; }
  catch { /* Show the explanation when a preference cannot be read. */ }
  if (hidden) return picker.call(window, { ...WORLD_PICKER_LOCATION, mode: "readwrite" });
  let request: HintRequest | null = null;
  const result = new Promise<WorldFolderDirectory>((resolve, reject) => {
    request = { picker, resolve, reject };
    pending = request;
    useFolderHintStore.setState({ open: true, dontShowAgain: false });
  });
  const abort = (): void => {
    if (pending === request) closeFolderHint();
    else request?.reject(new DOMException("Folder selection cancelled", "AbortError"));
  };
  signal?.addEventListener("abort", abort, { once: true });
  try { return await result; }
  finally { signal?.removeEventListener("abort", abort); }
}
