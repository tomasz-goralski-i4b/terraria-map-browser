/** The browser remembers this world-folder location; first use starts in Documents. */
export const WORLD_PICKER_LOCATION = { id: "terraria-worlds", startIn: "documents" } as const;

export type HandlePermissionMode = "read" | "readwrite";

/** The permission calls of the File System Access API; absent in some browsers and in test doubles (then granted). */
export interface PermissionedHandle {
  queryPermission?(descriptor: { readonly mode: HandlePermissionMode }): Promise<PermissionState>;
  requestPermission?(descriptor: { readonly mode: HandlePermissionMode }): Promise<PermissionState>;
}

/** An opened world's file. Only read, and kept for identity checks: the app never writes to the world it opened. */
export interface OpenWorldHandle extends PermissionedHandle {
  getFile(): Promise<File>;
}

export interface WorldCopyDestination {
  isSameEntry(other: OpenWorldHandle): Promise<boolean>;
  /** Read only to check that a file this app created is still empty before removing it. */
  getFile?(): Promise<File>;
  createWritable(): Promise<{
    write(bytes: ArrayBuffer): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

/** A folder a world can be saved into. */
export interface WorldSaveDirectory extends PermissionedHandle {
  readonly name?: string;
  getFileHandle(name: string, options: { readonly create: boolean }): Promise<WorldCopyDestination>;
  removeEntry?(name: string): Promise<void>;
}

export interface WorldFolderFile extends OpenWorldHandle {
  readonly kind: "file";
  readonly name: string;
}

/** A folder of worlds: listed in File ▸ Worlds, and a save destination once write access is granted. */
export interface WorldFolderDirectory extends WorldSaveDirectory {
  readonly name: string;
  values(): AsyncIterable<WorldFolderFile | { readonly kind: "directory"; readonly name: string }>;
  resolve?(handle: OpenWorldHandle): Promise<string[] | null>;
}

export interface OpenedWorldFile {
  readonly file: File;
  readonly handle: OpenWorldHandle | null;
  /** The folder the world was opened from, when known: Save As offers it first. */
  readonly directory?: WorldSaveDirectory | null;
}

/** Whether `mode` access is granted, asking for it when `request` is set; a handle without the API counts as granted. */
export async function ensurePermission(handle: PermissionedHandle, mode: HandlePermissionMode, request: boolean): Promise<boolean> {
  if (handle.queryPermission === undefined) return true;
  try {
    if ((await handle.queryPermission({ mode })) === "granted") return true;
    if (!request || handle.requestPermission === undefined) return false;
    return (await handle.requestPermission({ mode })) === "granted";
  } catch {
    return false;
  }
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
