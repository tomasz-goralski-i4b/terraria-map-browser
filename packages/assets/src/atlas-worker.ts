// Module Worker entry: runs buildSpriteAtlas off the main thread (protocol in atlas-worker-protocol.ts).
import { buildSpriteAtlas } from "./atlas-build.js";
import { loadCachedAtlas, loadCachedMissing, type CacheDirectory } from "./atlas-cache.js";
import { filesToContentDirectory } from "./content-files.js";
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

async function cacheRoot(cacheName: string): Promise<CacheDirectory> {
  return (await (await navigator.storage.getDirectory()).getDirectoryHandle(cacheName, { create: true })) as unknown as CacheDirectory;
}

async function load(request: Extract<AtlasWorkerRequest, { type: "load" }>): Promise<void> {
  try {
    const cache = await cacheRoot(request.cacheName);
    const atlas = await loadCachedAtlas(cache, request.fingerprint);
    if (atlas === undefined) {
      scope.postMessage({ type: "notCached" });
      return;
    }
    const missing = await loadCachedMissing(cache, request.fingerprint);
    const result = { atlas, missing, fromCache: true, fingerprint: request.fingerprint };
    scope.postMessage({ type: "done", result, networkRequests }, atlas.pages.map((page) => page.buffer));
  } catch (error) {
    scope.postMessage({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

async function build(request: Extract<AtlasWorkerRequest, { type: "build" }>): Promise<void> {
  const current = new AbortController();
  controller = current;
  networkRequests = 0;
  try {
    const root = await cacheRoot(request.cacheName);
    const contentDir = Array.isArray(request.contentDir)
      ? filesToContentDirectory(request.contentDir as readonly File[])
      : (request.contentDir as FileSystemDirectoryHandle);
    const result = await buildSpriteAtlas(contentDir, {
      cache: root,
      signal: current.signal,
      onProgress: (progress) => {
        scope.postMessage({ type: "progress", progress });
      },
    });
    // Every page owns its buffer (packSheets and the cache allocate one per page), so all of them can be transferred.
    scope.postMessage({ type: "done", result, networkRequests }, result.atlas.pages.map((page) => page.buffer));
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
  else if (event.data.type === "load") void load(event.data);
  else void build(event.data);
};
