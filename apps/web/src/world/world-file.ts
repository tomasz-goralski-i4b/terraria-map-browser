/** The browser remembers this world-folder location; first use starts in Documents. */
export const WORLD_PICKER_LOCATION = { id: "terraria-worlds", startIn: "documents" } as const;

/** Retained only for identity checks; the opened handle is never made writable. */
export interface OpenWorldHandle {
  getFile(): Promise<File>;
}

export interface WorldCopyDestination {
  isSameEntry(other: OpenWorldHandle): Promise<boolean>;
  createWritable(): Promise<{
    write(bytes: ArrayBuffer): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }>;
}

export interface WorldSaveDirectory {
  getFileHandle(name: string, options: { readonly create: boolean }): Promise<WorldCopyDestination>;
}

export interface WorldFolderFile extends OpenWorldHandle {
  readonly kind: "file";
  readonly name: string;
}
export interface WorldFolderDirectory extends WorldSaveDirectory {
  readonly name: string;
  values(): AsyncIterable<WorldFolderFile | { readonly kind: "directory"; readonly name: string }>;
  resolve?(handle: OpenWorldHandle): Promise<string[] | null>;
}

export interface OpenedWorldFile {
  readonly file: File;
  readonly handle: OpenWorldHandle | null;
  readonly directory?: WorldSaveDirectory | null;
}
