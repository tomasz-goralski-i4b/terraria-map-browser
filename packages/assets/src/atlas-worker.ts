// Module Worker entry: runs buildSpriteAtlas off the main thread (protocol in atlas-worker-protocol.ts).
import { buildSpriteAtlas } from "./atlas-build.js";
import type { CacheDirectory } from "./atlas-cache.js";
import type { AtlasWorkerRequest, AtlasWorkerResponse } from "./atlas-worker-protocol.js";

interface WorkerScope {
  onmessage: ((event: MessageEvent<AtlasWorkerRequest>) => void) | null;
  postMessage(message: AtlasWorkerResponse, transfer?: Transferable[]): void;
  fetch: typeof fetch;
}

const scope = globalThis as unknown as WorkerScope;
let controller: AbortController | undefined;

// Counts network calls so the build can prove it stayed local; the real fetch still runs.
let networkRequests = 0;
const realFetch = scope.fetch.bind(globalThis);
scope.fetch = (...args: Parameters<typeof fetch>): ReturnType<typeof fetch> => {
  networkRequests++;
  return realFetch(...args);
};

async function build(request: Extract<AtlasWorkerRequest, { type: "build" }>): Promise<void> {
  const current = new AbortController();
  controller = current;
  networkRequests = 0;
  try {
    const root = await (await navigator.storage.getDirectory()).getDirectoryHandle(request.cacheName, { create: true });
    const result = await buildSpriteAtlas(request.contentDir, {
      cache: root as unknown as CacheDirectory,
      signal: current.signal,
      onProgress: (progress) => {
        scope.postMessage({ type: "progress", progress });
      },
    });
    scope.postMessage({ type: "done", result, networkRequests });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      scope.postMessage({ type: "cancelled" });
    } else {
      scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
    }
  } finally {
    if (controller === current) controller = undefined;
  }
}

scope.onmessage = (event) => {
  if (event.data.type === "cancel") controller?.abort();
  else void build(event.data);
};
