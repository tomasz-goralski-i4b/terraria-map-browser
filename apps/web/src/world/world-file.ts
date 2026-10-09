/** Retained only for identity checks; the opened handle is never made writable. */
export interface OpenWorldHandle {
  getFile(): Promise<File>;
}

export interface OpenedWorldFile {
  readonly file: File;
  readonly handle: OpenWorldHandle | null;
}
