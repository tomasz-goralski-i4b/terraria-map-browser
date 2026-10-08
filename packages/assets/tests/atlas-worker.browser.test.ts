import { afterEach, expect, test } from "vitest";
import type { AtlasWorkerRequest, AtlasWorkerResponse } from "../src/index.js";
import { buildTexturePayload, patternRgba, wrapUncompressed } from "../src/xnb-fixture.js";

const created: string[] = [];

afterEach(async () => {
  const root = await navigator.storage.getDirectory();
  for (const name of created.splice(0)) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
});

/** Writes synthetic `Images/Tiles_<n>.xnb` files into a fresh OPFS directory and returns its name and handle. */
async function syntheticContent(tag: string, sheets: number): Promise<{ name: string; handle: FileSystemDirectoryHandle }> {
  const root = await navigator.storage.getDirectory();
  const name = `atlas-test-content-${tag}-${String(Date.now())}`;
  created.push(name);
  const content = await root.getDirectoryHandle(name, { create: true });
  const images = await content.getDirectoryHandle("Images", { create: true });
  for (let id = 0; id < sheets; id++) {
    const width = 36 + (id % 5) * 18;
    const bytes = wrapUncompressed(buildTexturePayload(width, 36, patternRgba(width, 36)));
    const writable = await (await images.getFileHandle(`Tiles_${String(id)}.xnb`, { create: true })).createWritable();
    await writable.write(new Uint8Array(bytes));
    await writable.close();
  }
  return { name, handle: content };
}

function startWorker(): Worker {
  return new Worker(new URL("../src/atlas-worker.ts", import.meta.url), { type: "module" });
}

/** Sends `request`, collects messages until a terminal one (`done`, `cancelled`, `error`). */
function run(
  worker: Worker,
  request: AtlasWorkerRequest,
  onMessage?: (message: AtlasWorkerResponse) => void,
): Promise<AtlasWorkerResponse[]> {
  return new Promise((resolve, reject) => {
    const seen: AtlasWorkerResponse[] = [];
    const timeout = window.setTimeout(() => { reject(new Error("atlas Worker did not finish in 20 s")); }, 20_000);
    worker.addEventListener("message", (event: MessageEvent<AtlasWorkerResponse>) => {
      seen.push(event.data);
      onMessage?.(event.data);
      if (event.data.type !== "progress") {
        window.clearTimeout(timeout);
        resolve(seen);
      }
    });
    worker.addEventListener("error", (event) => {
      window.clearTimeout(timeout);
      reject(new Error(event.message));
    });
    worker.postMessage(request);
  });
}

async function cacheEntries(cacheName: string): Promise<string[]> {
  const root = await navigator.storage.getDirectory();
  const names: string[] = [];
  try {
    const cache = await root.getDirectoryHandle(cacheName);
    for await (const [name] of cache.entries()) names.push(name);
  } catch {
    // no cache directory at all is also "no partial entry"
  }
  return names;
}

test("the Worker builds the atlas with progress, caches it in OPFS and makes no network requests", async () => {
  const content = await syntheticContent("build", 12);
  const cacheName = `${content.name}-cache`;
  created.push(cacheName);
  const worker = startWorker();
  try {
    const first = await run(worker, { type: "build", contentDir: content.handle, cacheName });
    expect(first.some((m) => m.type === "progress")).toBe(true);
    const done = first.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;
    expect(done.result.fromCache).toBe(false);
    expect(done.result.atlas.index.entries).toHaveLength(12);
    expect(done.networkRequests).toBe(0);
    expect(await cacheEntries(cacheName)).not.toEqual([]);

    const second = await run(worker, { type: "build", contentDir: content.handle, cacheName });
    const again = second.at(-1);
    expect(again?.type).toBe("done");
    if (again?.type !== "done") return;
    expect(again.result.fromCache).toBe(true);
    expect(again.result.fingerprint).toBe(done.result.fingerprint);
    expect(again.networkRequests).toBe(0);
  } finally {
    worker.terminate();
  }
}, 30_000);

test("cancelling the Worker build leaves no partial cache entry", async () => {
  const content = await syntheticContent("cancel", 150);
  const cacheName = `${content.name}-cache`;
  created.push(cacheName);
  const worker = startWorker();
  try {
    let cancelSent = false;
    const messages = await run(worker, { type: "build", contentDir: content.handle, cacheName }, (message) => {
      if (message.type === "progress" && !cancelSent) {
        cancelSent = true;
        worker.postMessage({ type: "cancel" } satisfies AtlasWorkerRequest);
      }
    });
    expect(messages.at(-1)?.type).toBe("cancelled");
    expect(await cacheEntries(cacheName)).toEqual([]);
  } finally {
    worker.terminate();
  }
}, 30_000);

test("cancelling the Worker build while the cache is being written leaves no partial cache entry", async () => {
  const content = await syntheticContent("cancel-store", 12);
  const cacheName = `${content.name}-cache`;
  created.push(cacheName);
  const worker = startWorker();
  try {
    let cancelSent = false;
    const messages = await run(worker, { type: "build", contentDir: content.handle, cacheName }, (message) => {
      if (message.type === "progress" && message.progress.phase === "store" && !cancelSent) {
        cancelSent = true;
        worker.postMessage({ type: "cancel" } satisfies AtlasWorkerRequest);
      }
    });
    expect(cancelSent).toBe(true);
    expect(messages.at(-1)?.type).toBe("cancelled");
    expect(await cacheEntries(cacheName)).toEqual([]);
  } finally {
    worker.terminate();
  }
}, 30_000);

test("the Worker builds from picked files (the folder-input fallback) and transfers the atlas pages", async () => {
  // Constructed files have no webkitRelativePath, so they count as the top level of a picked Images folder.
  const files = [0, 1, 2].map((id) => new File(
    [wrapUncompressed(buildTexturePayload(36, 36, patternRgba(36, 36))).slice()],
    `${id === 2 ? "Wall" : "Tiles"}_${String(id)}.xnb`,
  ));
  const cacheName = `atlas-test-files-${String(Date.now())}-cache`;
  created.push(cacheName);
  const worker = startWorker();
  try {
    const done = (await run(worker, { type: "build", contentDir: files, cacheName })).at(-1);
    expect(done?.type).toBe("done");
    if (done?.type !== "done") return;
    expect(done.result.atlas.index.entries.map((e) => `${e.kind}:${String(e.id)}`).sort()).toEqual(["tile:0", "tile:1", "wall:2"]);
    expect(done.result.atlas.pages[0]?.byteLength).toBe(done.result.atlas.index.pageSize ** 2 * 4);
    expect(done.networkRequests).toBe(0);
  } finally {
    worker.terminate();
  }
}, 30_000);

test("the Worker loads a cached atlas by fingerprint without its source files, and reports an unknown one", async () => {
  const content = await syntheticContent("load", 4);
  const cacheName = `${content.name}-cache`;
  created.push(cacheName);
  const worker = startWorker();
  try {
    const built = (await run(worker, { type: "build", contentDir: content.handle, cacheName })).at(-1);
    if (built?.type !== "done") throw new Error("build failed");
    const loaded = (await run(worker, { type: "load", fingerprint: built.result.fingerprint, cacheName })).at(-1);
    expect(loaded?.type).toBe("done");
    if (loaded?.type !== "done") return;
    expect(loaded.result.fromCache).toBe(true);
    expect(loaded.result.atlas.index.entries).toHaveLength(4);
    expect((await run(worker, { type: "load", fingerprint: "not-a-fingerprint", cacheName })).at(-1)?.type).toBe("notCached");
  } finally {
    worker.terminate();
  }
}, 30_000);
