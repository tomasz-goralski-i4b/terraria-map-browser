import type { BuildProgress, BuildResult } from "./atlas-build.js";

/** Messages main thread → atlas Worker. */
export type AtlasWorkerRequest =
  | { readonly type: "build"; readonly contentDir: FileSystemDirectoryHandle; readonly cacheName: string }
  | { readonly type: "cancel" };

/** Messages atlas Worker → main thread. */
export type AtlasWorkerResponse =
  | { readonly type: "progress"; readonly progress: BuildProgress }
  | { readonly type: "done"; readonly result: BuildResult; readonly networkRequests: number }
  | { readonly type: "cancelled" }
  | { readonly type: "error"; readonly message: string };
