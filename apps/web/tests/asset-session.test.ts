import { afterEach, describe, expect, test, vi } from "vitest";
import type { BuildProgress, BuildResult, MissingSheet, SpriteAtlas } from "@studio/assets";
import {
  createAssetSession,
  useAssetStore,
  type AtlasBuilder,
  type ContentFolder,
  type ContentSource,
  type RememberedContent,
  type RememberedSource,
} from "../src/assets/asset-session.js";

afterEach(() => {
  useAssetStore.setState({ status: { kind: "none" }, notice: null });
});

function atlas(tiles: number, walls: number, pages = 1): SpriteAtlas {
  const entry = (kind: "tile" | "wall", id: number) => ({
    kind, id, page: 0, x: 0, y: 0, width: 16, height: 16, frameWidth: 16, frameHeight: 16, gapX: 2, gapY: 2,
  });
  return {
    pages: Array.from({ length: pages }, () => new Uint8Array(4)),
    index: {
      formatVersion: 1, pageSize: 1, padding: 2, pageCount: pages, metrics: {
        tile: { cell: 16, gap: 2 }, wall: { cell: 32, gap: 4 }, treeTop: { cell: 80, gap: 2 }, treeBranch: { cell: 40, gap: 2 },
        shroomTop: { cell: 60, gap: 2 }, wire: { cell: 16, gap: 2 }, actuator: { cell: 16, gap: 0 },
      },
      entries: [...Array.from({ length: tiles }, (_, id) => entry("tile", id)), ...Array.from({ length: walls }, (_, id) => entry("wall", id + 1))],
    },
  };
}

function result(tiles = 3, walls = 2, missing: readonly MissingSheet[] = [], fromCache = false): BuildResult {
  return { atlas: atlas(tiles, walls), missing, fromCache, fingerprint: "f" };
}

/** A builder whose builds the test settles by hand. */
class ManualBuilder implements AtlasBuilder {
  readonly cached = new Map<string, BuildResult>();

  readonly calls: { source: ContentSource; onProgress: (p: BuildProgress) => void; signal: AbortSignal; resolve: (r: BuildResult) => void; reject: (e: unknown) => void }[] = [];

  build(source: ContentSource, options: { onProgress: (p: BuildProgress) => void; signal: AbortSignal }): Promise<BuildResult> {
    return new Promise((resolve, reject) => {
      this.calls.push({ source, ...options, resolve, reject });
      options.signal.addEventListener("abort", () => {
        reject(new DOMException("aborted", "AbortError"));
      });
    });
  }

  cacheCleared = 0;

  clearCache(): Promise<void> {
    this.cached.clear();
    this.cacheCleared++;
    return Promise.resolve();
  }

  loadCached(fingerprint: string): Promise<BuildResult | null> {
    return Promise.resolve(this.cached.get(fingerprint) ?? null);
  }

  last(): ManualBuilder["calls"][number] {
    const call = this.calls.at(-1);
    if (call === undefined) throw new Error("no build started");
    return call;
  }
}

class MemoryRemembered implements RememberedContent {
  source: RememberedSource | null;
  constructor(source: ContentFolder | RememberedSource | null = null) {
    // Test folders are the only sources with permission calls.
    this.source = source !== null && "queryPermission" in source ? { kind: "folder", folder: source } : source;
  }
  /** The remembered folder handle, if a folder is remembered. */
  get folder(): ContentFolder | null {
    return this.source?.kind === "folder" ? this.source.folder : null;
  }
  load(): Promise<RememberedSource | null> {
    return Promise.resolve(this.source);
  }
  save(source: RememberedSource): Promise<void> {
    this.source = source;
    return Promise.resolve();
  }
  forget(): Promise<void> {
    this.source = null;
    return Promise.resolve();
  }
}

function folder(name: string, permission: PermissionState = "granted", afterRequest: PermissionState = "granted"): ContentFolder {
  return {
    name,
    queryPermission: vi.fn(() => Promise.resolve(permission)),
    requestPermission: vi.fn(() => Promise.resolve(afterRequest)),
  } as unknown as ContentFolder;
}

const status = () => useAssetStore.getState().status;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("connecting a Content folder", () => {
  test("the picked folder is remembered and built, with progress, into a ready atlas", async () => {
    const builder = new ManualBuilder();
    const remembered = new MemoryRemembered();
    const content = folder("Content");
    const session = createAssetSession({ builder, remembered, pickDirectory: () => Promise.resolve(content), openFolderInput: vi.fn() });

    const connecting = session.connect();
    await settle();
    expect(builder.last().source).toBe(content);
    expect(remembered.source).toBeNull();
    expect(status()).toEqual({ kind: "building", folderName: "Content", progress: null });

    builder.last().onProgress({ phase: "decode", done: 5, total: 10 });
    expect(status()).toEqual({ kind: "building", folderName: "Content", progress: { phase: "decode", done: 5, total: 10 } });

    const missing = [{ kind: "tile", id: 9, name: "Tiles_9.xnb", reason: "bad magic" }] as const;
    const built = result(3, 2, missing);
    builder.last().resolve(built);
    await connecting;
    expect(status()).toEqual({ kind: "ready", folderName: "Content", tileSheets: 3, wallSheets: 2, pages: 1, fromCache: false, missing });
    expect(session.getAtlas()).toBe(built.atlas);
    expect(remembered.folder).toBe(content);
  });

  test("closing the picker changes nothing", async () => {
    const builder = new ManualBuilder();
    const session = createAssetSession({ builder, remembered: new MemoryRemembered(), pickDirectory: () => Promise.resolve(null), openFolderInput: vi.fn() });
    await session.connect();
    expect(builder.calls).toHaveLength(0);
    expect(status()).toEqual({ kind: "none" });
  });

  test("without a directory picker the folder input opens, and only the built atlas's fingerprint is remembered", async () => {
    const builder = new ManualBuilder();
    const remembered = new MemoryRemembered();
    const openFolderInput = vi.fn();
    const session = createAssetSession({ builder, remembered, pickDirectory: null, openFolderInput });
    await session.connect();
    expect(openFolderInput).toHaveBeenCalledOnce();

    const sheet = new File([], "Tiles_0.xnb");
    const other = new File([], "Font.xnb");
    for (const file of [sheet, other]) Object.defineProperty(file, "webkitRelativePath", { value: `Content/Images/${file.name}` });
    const files = [sheet, other];
    const connecting = session.connectFiles(files);
    await settle();
    // Only the sheets are sent to the Worker.
    expect(builder.last().source).toEqual([sheet]);
    builder.last().resolve(result());
    await connecting;
    expect(status()).toMatchObject({ kind: "ready", folderName: "Content" });
    expect(remembered.source).toEqual({ kind: "files", folderName: "Content", fingerprint: "f" });
  });

  test("the folder input sends every sheet the atlas holds: tree tops and branches, mushroom caps, wires and the actuator", async () => {
    const builder = new ManualBuilder();
    const session = createAssetSession({ builder, remembered: new MemoryRemembered(), pickDirectory: null, openFolderInput: vi.fn() });
    const names = [
      "Tiles_5.xnb", "Wall_1.xnb", "Tree_Tops_0.xnb", "Tree_Branches_31.xnb", "Shroom_Tops.xnb", "WiresNew.xnb", "Actuator.xnb",
      "Wires.xnb", "Wall_Outline.xnb", "Tiles_5_0.xnb",
    ];
    const files = names.map((name) => {
      const file = new File([], name);
      Object.defineProperty(file, "webkitRelativePath", { value: `Content/Images/${name}` });
      return file;
    });
    const connecting = session.connectFiles(files);
    await settle();
    expect((builder.last().source as readonly File[]).map((file) => file.name)).toEqual(names.slice(0, 7));
    builder.last().resolve(result());
    await connecting;
  });

  test("Select folder opens the folder input even where there is a directory picker (Chrome refuses Program Files)", () => {
    const openFolderInput = vi.fn();
    const pickDirectory = vi.fn();
    const session = createAssetSession({ builder: new ManualBuilder(), remembered: new MemoryRemembered(), pickDirectory, openFolderInput });
    expect(session.hasDirectoryPicker).toBe(true);
    session.chooseFiles();
    expect(openFolderInput).toHaveBeenCalledOnce();
    expect(pickDirectory).not.toHaveBeenCalled();
  });

  test("a folder with no tile or wall sheets is reported over the map and the button comes back; nothing is remembered", async () => {
    const builder = new ManualBuilder();
    const remembered = new MemoryRemembered();
    const session = createAssetSession({ builder, remembered, pickDirectory: () => Promise.resolve(folder("Desktop")), openFolderInput: vi.fn() });
    const connecting = session.connect();
    await settle();
    builder.last().resolve(result(0, 0));
    await connecting;
    expect(status()).toEqual({ kind: "none" });
    expect(useAssetStore.getState().notice).toContain("“Desktop” has no Tiles_<id>.xnb");
    expect(remembered.source).toBeNull();
    expect(session.getAtlas()).toBeNull();
  });

  test("a failed connect keeps the atlas that was loaded before it", async () => {
    const builder = new ManualBuilder();
    const remembered = new MemoryRemembered();
    const content = folder("Content");
    let next = content;
    const session = createAssetSession({ builder, remembered, pickDirectory: () => Promise.resolve(next), openFolderInput: vi.fn() });
    const first = session.connect();
    await settle();
    const ready = result(2, 2);
    builder.last().resolve(ready);
    await first;
    const readyStatus = status();

    next = folder("Desktop");
    const second = session.connect();
    await settle();
    builder.last().reject(new Error("disk on fire"));
    await second;
    expect(status()).toEqual(readyStatus);
    expect(useAssetStore.getState().notice).toBe("Could not load sprites from “Desktop”: disk on fire");
    expect(session.getAtlas()).toBe(ready.atlas);
    expect(remembered.folder).toBe(content);
  });

  test("the folder input shows that it waits for the folder, and closing it without a choice goes back", async () => {
    const openFolderInput = vi.fn();
    const builder = new ManualBuilder();
    const session = createAssetSession({ builder, remembered: new MemoryRemembered(), pickDirectory: null, openFolderInput });
    await session.connect();
    expect(status()).toEqual({ kind: "choosing" });
    session.cancelChoosing();
    expect(status()).toEqual({ kind: "none" });

    await session.connect();
    const picked = new File([], "Tiles_0.xnb");
    Object.defineProperty(picked, "webkitRelativePath", { value: "Images/Tiles_0.xnb" });
    const connecting = session.connectFiles([picked]);
    await settle();
    expect(status()).toMatchObject({ kind: "building" });
    builder.last().reject(new Error("bad"));
    await connecting;
    expect(status()).toEqual({ kind: "none" });
  });

  test("cancelling returns to the previous atlas, and a newer connect supersedes an older build", async () => {
    const builder = new ManualBuilder();
    const remembered = new MemoryRemembered();
    let next = folder("First");
    const session = createAssetSession({ builder, remembered, pickDirectory: () => Promise.resolve(next), openFolderInput: vi.fn() });

    const first = session.connect();
    await settle();
    const ready = result(1, 1);
    builder.last().resolve(ready);
    await first;
    const readyStatus = status();

    next = folder("Second");
    const second = session.connect();
    await settle();
    expect(status()).toMatchObject({ kind: "building", folderName: "Second" });
    session.cancel();
    await second;
    expect(builder.calls[1]?.signal.aborted).toBe(true);
    expect(status()).toEqual(readyStatus);
    expect(session.getAtlas()).toBe(ready.atlas);

    next = folder("Third");
    const third = session.connect();
    await settle();
    next = folder("Fourth");
    const fourth = session.connect();
    await settle();
    expect(builder.calls[2]?.signal.aborted).toBe(true);
    builder.last().resolve(result(4, 4));
    await Promise.all([third, fourth]);
    expect(status()).toMatchObject({ kind: "ready", folderName: "Fourth", tileSheets: 4 });
  });
});

describe("disconnecting", () => {
  test("unloads the atlas, forgets the folder and clears the cache, so the next connect builds from scratch", async () => {
    const builder = new ManualBuilder();
    const remembered = new MemoryRemembered();
    const session = createAssetSession({ builder, remembered, pickDirectory: () => Promise.resolve(folder("Content")), openFolderInput: vi.fn() });
    const connecting = session.connect();
    await settle();
    builder.last().resolve(result());
    await connecting;
    expect(status().kind).toBe("ready");

    await session.disconnect();
    expect(status()).toEqual({ kind: "none" });
    expect(session.getAtlas()).toBeNull();
    expect(remembered.source).toBeNull();
    expect(builder.cacheCleared).toBe(1);
  });
});

describe("restoring the remembered folder on the next visit", () => {
  test("with permission still granted, the atlas is built (usually from the cache) without asking", async () => {
    const builder = new ManualBuilder();
    const content = folder("Content", "granted");
    const session = createAssetSession({ builder, remembered: new MemoryRemembered(content), pickDirectory: vi.fn(), openFolderInput: vi.fn() });
    const restoring = session.restore();
    await settle();
    expect(builder.last().source).toBe(content);
    builder.last().resolve(result(2, 2, [], true));
    await restoring;
    expect(status()).toMatchObject({ kind: "ready", fromCache: true });
  });

  test("when the browser wants to ask again, a reconnect button is offered and asks only when pressed", async () => {
    const builder = new ManualBuilder();
    const content = folder("Content", "prompt", "granted");
    const session = createAssetSession({ builder, remembered: new MemoryRemembered(content), pickDirectory: vi.fn(), openFolderInput: vi.fn() });
    await session.restore();
    expect(status()).toEqual({ kind: "reconnect", folderName: "Content" });
    expect(builder.calls).toHaveLength(0);

    const reconnecting = session.reconnect();
    await settle();
    expect(builder.last().source).toBe(content);
    builder.last().resolve(result());
    await reconnecting;
    expect(status()).toMatchObject({ kind: "ready" });
  });

  test("refused or revoked permission falls back to the connect button, without an error, and forgets the folder", async () => {
    const builder = new ManualBuilder();
    const denied = new MemoryRemembered(folder("Content", "denied"));
    await createAssetSession({ builder, remembered: denied, pickDirectory: vi.fn(), openFolderInput: vi.fn() }).restore();
    expect(status()).toEqual({ kind: "none" });
    expect(denied.folder).toBeNull();

    const refused = new MemoryRemembered(folder("Content", "prompt", "denied"));
    const session = createAssetSession({ builder, remembered: refused, pickDirectory: vi.fn(), openFolderInput: vi.fn() });
    await session.restore();
    await session.reconnect();
    expect(status()).toEqual({ kind: "none" });
    expect(refused.folder).toBeNull();
    expect(builder.calls).toHaveLength(0);
  });

  test("a remembered folder that can no longer be read is forgotten", async () => {
    const builder = new ManualBuilder();
    const remembered = new MemoryRemembered(folder("Content"));
    const session = createAssetSession({ builder, remembered, pickDirectory: vi.fn(), openFolderInput: vi.fn() });
    const restoring = session.restore();
    await settle();
    builder.last().reject(new DOMException("gone", "NotFoundError"));
    await restoring;
    expect(status()).toEqual({ kind: "none" });
    expect(useAssetStore.getState().notice).toContain("gone");
    expect(remembered.folder).toBeNull();
  });

  test("restore runs once, and storage that cannot be read means no remembered folder", async () => {
    const builder = new ManualBuilder();
    const broken: RememberedContent = {
      load: () => Promise.reject(new Error("no IndexedDB")), save: () => Promise.resolve(), forget: () => Promise.resolve(),
    };
    const session = createAssetSession({ builder, remembered: broken, pickDirectory: vi.fn(), openFolderInput: vi.fn() });
    await Promise.all([session.restore(), session.restore()]);
    expect(status()).toEqual({ kind: "none" });
  });

  test("files picked with the folder input come back from the atlas cache, without reading them again", async () => {
    const builder = new ManualBuilder();
    const cached = result(5, 4, [], true);
    builder.cached.set("abc", cached);
    const session = createAssetSession({
      builder, remembered: new MemoryRemembered({ kind: "files", folderName: "Images", fingerprint: "abc" }), pickDirectory: vi.fn(), openFolderInput: vi.fn(),
    });
    await session.restore();
    expect(builder.calls).toHaveLength(0);
    expect(status()).toMatchObject({ kind: "ready", folderName: "Images", tileSheets: 5, wallSheets: 4, fromCache: true });
    expect(session.getAtlas()).toBe(cached.atlas);
  });

  test("a remembered fingerprint that is no longer cached is forgotten without an error", async () => {
    const remembered = new MemoryRemembered({ kind: "files", folderName: "Images", fingerprint: "gone" });
    await createAssetSession({ builder: new ManualBuilder(), remembered, pickDirectory: vi.fn(), openFolderInput: vi.fn() }).restore();
    expect(status()).toEqual({ kind: "none" });
    expect(remembered.source).toBeNull();
  });
});
