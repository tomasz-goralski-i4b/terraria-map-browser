import type { BuildProgress, BuildResult } from "./atlas-build.js";

/** Messages main thread → atlas Worker. */
export type AtlasWorkerRequest =
  | {
      readonly type: "build";
      /** A picked `Content` (or `Images`) directory, or the files of `<input webkitdirectory>` where there is no picker. */
      readonly contentDir: FileSystemDirectoryHandle | readonly File[];
      readonly cacheName: string;
    }
  /** Loads the cached atlas of an earlier build without its source files; answered by `done` or `notCached`. */
  | { readonly type: "load"; readonly fingerprint: string; readonly cacheName: string }
  | { readonly type: "cancel" };

/** Messages atlas Worker → main thread. The atlas pages of `done` are transferred, not copied. */
export type AtlasWorkerResponse =
  | { readonly type: "progress"; readonly progress: BuildProgress }
  | { readonly type: "done"; readonly result: BuildResult; readonly networkRequests: number }
  | { readonly type: "cancelled" }
  | { readonly type: "notCached" }
  | { readonly type: "error"; readonly message: string };
