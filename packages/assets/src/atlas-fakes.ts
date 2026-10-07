import type { CacheDirectory, CacheFile } from "./atlas-cache.js";
import type { ContentDirectory, ContentEntry } from "./atlas-build.js";

/** A stored file; `lastModified` and `size` are what the fingerprint sees. */
class MemoryFile implements CacheFile, ContentEntry {
  readonly kind = "file";
  bytes: Uint8Array;
  lastModified: number;

  constructor(bytes: Uint8Array, lastModified: number) {
    this.bytes = bytes;
    this.lastModified = lastModified;
  }

  getFile(): Promise<{ name: string; size: number; lastModified: number; arrayBuffer(): Promise<ArrayBuffer> }> {
    const bytes = this.bytes;
    return Promise.resolve({
      name: "",
      size: bytes.length,
      lastModified: this.lastModified,
      arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
    });
  }

  createWritable(): Promise<{
    write(data: Uint8Array | string): Promise<void>;
    close(): Promise<void>;
    abort(): Promise<void>;
  }> {
    const chunks: Uint8Array[] = [];
    return Promise.resolve({
      write: (data) => {
        chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data.slice());
        return Promise.resolve();
      },
      close: () => {
        const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        this.bytes = merged;
        return Promise.resolve();
      },
      abort: () => Promise.resolve(),
    });
  }
}

/** In-memory stand-in for both a `FileSystemDirectoryHandle` cache (OPFS) and a picked content directory. */
export class MemoryDirectory implements CacheDirectory, ContentDirectory {
  readonly kind = "directory";
  private readonly children = new Map<string, MemoryDirectory | MemoryFile>();

  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<MemoryDirectory> {
    const existing = this.children.get(name);
    if (existing instanceof MemoryDirectory) return Promise.resolve(existing);
    if (existing !== undefined || options?.create !== true) {
      return Promise.reject(new DOMException(`${name} is not a directory`, "NotFoundError"));
    }
    const created = new MemoryDirectory();
    this.children.set(name, created);
    return Promise.resolve(created);
  }

  getFileHandle(name: string, options?: { create?: boolean }): Promise<MemoryFile> {
    const existing = this.children.get(name);
    if (existing instanceof MemoryFile) return Promise.resolve(existing);
    if (existing !== undefined || options?.create !== true) {
      return Promise.reject(new DOMException(`${name} is not a file`, "NotFoundError"));
    }
    const created = new MemoryFile(new Uint8Array(0), 0);
    this.children.set(name, created);
    return Promise.resolve(created);
  }

  removeEntry(name: string): Promise<void> {
    this.children.delete(name);
    return Promise.resolve();
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- an async generator is the shape of the DOM API
  async *entries(): AsyncGenerator<[string, MemoryDirectory | MemoryFile]> {
    for (const entry of [...this.children]) yield entry;
  }

  /** Test helper: adds (or replaces) a file. */
  putFile(name: string, bytes: Uint8Array, lastModified = 1_000): void {
    this.children.set(name, new MemoryFile(bytes, lastModified));
  }

  /** Test helper: adds (or replaces) a subdirectory. */
  putDirectory(name: string, directory: MemoryDirectory): void {
    this.children.set(name, directory);
  }

  /** Test helper: the file named `name`, if any. */
  file(name: string): { bytes: Uint8Array; lastModified: number } | undefined {
    const child = this.children.get(name);
    return child instanceof MemoryFile ? child : undefined;
  }

  /** Test helper: names of the direct children. */
  names(): string[] {
    return [...this.children.keys()];
  }
}
