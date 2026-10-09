import { describe, expect, it, vi } from "vitest";
import {
  ATLAS_FORMAT_VERSION,
  AtlasSheetTooLargeError,
  buildSpriteAtlas,
  computeFingerprint,
  findSprite,
  loadCachedAtlas,
  packSheets,
  readSpritePixels,
  readXnbTexture,
  storeAtlas,
  type BuildProgress,
  type ContentDirectory,
  type PackableSheet,
  type XnbTexture,
} from "./index.js";
import { MemoryDirectory } from "./atlas-fakes.js";
import { buildTexturePayload, patternRgba, wrapUncompressed } from "./xnb-fixture.js";

function sheet(kind: "tile" | "wall", id: number, width: number, height: number): PackableSheet {
  const rgba = patternRgba(width, height);
  // Make every sheet distinct and never fully transparent.
  for (let i = 0; i < rgba.length; i += 4) rgba[i + 3] = 255;
  rgba[0] = id & 0xff;
  rgba[1] = kind === "tile" ? 1 : 2;
  return { kind, id, width, height, rgba };
}

const MIXED: PackableSheet[] = [
  sheet("tile", 0, 288, 270),
  sheet("tile", 1, 90, 40),
  sheet("tile", 4, 20, 440),
  sheet("wall", 1, 468, 180),
  sheet("wall", 2, 36, 36),
  sheet("tile", 21, 144, 108),
  sheet("wall", 3, 468, 180),
];

describe("packSheets", () => {
  it("packSheets_MixedSizes_PlacesEverySheetOnceInsidePageBounds", () => {
    const atlas = packSheets(MIXED, { pageSize: 512, padding: 2 });
    const { index } = atlas;
    expect(index.entries).toHaveLength(MIXED.length);
    for (const source of MIXED) {
      const matches = index.entries.filter((e) => e.kind === source.kind && e.id === source.id);
      expect(matches).toHaveLength(1);
      const entry = matches[0];
      expect(entry).toBeDefined();
      if (entry === undefined) continue;
      expect([entry.width, entry.height]).toEqual([source.width, source.height]);
      expect(entry.page).toBeGreaterThanOrEqual(0);
      expect(entry.page).toBeLessThan(index.pageCount);
      expect(entry.x).toBeGreaterThanOrEqual(0);
      expect(entry.y).toBeGreaterThanOrEqual(0);
      expect(entry.x + entry.width).toBeLessThanOrEqual(index.pageSize);
      expect(entry.y + entry.height).toBeLessThanOrEqual(index.pageSize);
    }
  });

  it("packSheets_MixedSizes_NoTwoRectanglesOverlapIncludingPadding", () => {
    const padding = 2;
    const { index } = packSheets(MIXED, { pageSize: 512, padding });
    for (const a of index.entries) {
      for (const b of index.entries) {
        if (a === b || a.page !== b.page) continue;
        const separated =
          a.x + a.width + padding <= b.x ||
          b.x + b.width + padding <= a.x ||
          a.y + a.height + padding <= b.y ||
          b.y + b.height + padding <= a.y;
        expect(separated, `${a.kind}${String(a.id)} vs ${b.kind}${String(b.id)}`).toBe(true);
      }
    }
  });

  it("packSheets_MixedSizes_ReadingARectangleBackYieldsTheOriginalPixels", { tags: ["perf"] }, () => {
    const atlas = packSheets(MIXED, { pageSize: 512, padding: 2 });
    for (const source of MIXED) {
      const entry = findSprite(atlas, source.kind, source.id);
      expect(entry).toBeDefined();
      if (entry === undefined) continue;
      expect(readSpritePixels(atlas, entry)).toEqual(source.rgba);
    }
  });

  it("packSheets_OddSizesAndPadding_PlacesEverySheetAtEvenPixels", () => {
    // The renderer's half-resolution atlas averages 2 × 2 pixels from even positions: a sheet at an odd position would
    // mix its cells with their gutters (packages/renderer, "Atlas").
    const odd = [sheet("tile", 1, 33, 17), sheet("tile", 2, 15, 15), sheet("wall", 1, 37, 9), sheet("tile", 3, 7, 31)];
    for (const padding of [1, 2, 3]) {
      const { index } = packSheets([...odd, ...MIXED], { pageSize: 512, padding });
      for (const entry of index.entries) {
        expect([entry.x % 2, entry.y % 2], `${entry.kind}${String(entry.id)}, padding ${String(padding)}`).toEqual([0, 0]);
      }
    }
  });

  it("packSheets_Pages_AreFullSizeRgbaAndMatchPageCount", () => {
    const atlas = packSheets(MIXED, { pageSize: 512, padding: 2 });
    expect(atlas.pages).toHaveLength(atlas.index.pageCount);
    expect(atlas.index.pageCount).toBeGreaterThan(1); // 7 sheets of 600+ KiB cannot share one 512² page
    for (const page of atlas.pages) expect(page.length).toBe(512 * 512 * 4);
  });

  it("packSheets_Padding_KeepsThePixelsAroundASheetTransparent", () => {
    const atlas = packSheets([sheet("tile", 7, 8, 8)], { pageSize: 64, padding: 2 });
    const entry = atlas.index.entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    const page = atlas.pages[entry.page];
    expect(page).toBeDefined();
    if (page === undefined) return;
    const alphaAt = (x: number, y: number): number => page[(y * 64 + x) * 4 + 3] ?? -1;
    expect(entry.x).toBeGreaterThanOrEqual(2);
    expect(entry.y).toBeGreaterThanOrEqual(2);
    expect(alphaAt(entry.x - 1, entry.y)).toBe(0);
    expect(alphaAt(entry.x, entry.y - 1)).toBe(0);
    expect(alphaAt(entry.x + entry.width, entry.y)).toBe(0);
    expect(alphaAt(entry.x, entry.y + entry.height)).toBe(0);
  });

  it("packSheets_SameIdDifferentKind_AreSeparateEntries", () => {
    const atlas = packSheets([sheet("tile", 1, 16, 16), sheet("wall", 1, 32, 32)], { pageSize: 128 });
    expect(findSprite(atlas, "tile", 1)?.width).toBe(16);
    expect(findSprite(atlas, "wall", 1)?.width).toBe(32);
  });

  it("packSheets_Index_CarriesFrameAndGutterMetricsFromAssetsDoc", () => {
    const { index } = packSheets([sheet("tile", 0, 18, 18)], { pageSize: 64 });
    expect(index.metrics.tile).toEqual({ cell: 16, gap: 2 });
    expect(index.metrics.wall).toEqual({ cell: 32, gap: 4 });
    expect(index.formatVersion).toBe(ATLAS_FORMAT_VERSION);
    expect(index.pageSize).toBe(64);
  });

  // Values: docs/assets.md "Blocks" (A12 textureGrid / gap per tile id) and "Walls" (32×32, gap 4).
  it.each([
    ["an ordinary tile", "tile", 0, { frameWidth: 16, frameHeight: 16, gapX: 2, gapY: 2 }],
    ["tile 4 (torches, 20×20 grid)", "tile", 4, { frameWidth: 20, frameHeight: 20, gapX: 2, gapY: 2 }],
    ["tile 3 (short plants, rectangular 16×20 grid)", "tile", 3, { frameWidth: 16, frameHeight: 20, gapX: 2, gapY: 2 }],
    ["tile 15 (chairs, asymmetric 2×4 gutter)", "tile", 15, { frameWidth: 16, frameHeight: 16, gapX: 2, gapY: 4 }],
    ["a wall", "wall", 1, { frameWidth: 32, frameHeight: 32, gapX: 4, gapY: 4 }],
    // Further families, restated from A12 (TEdit tiles.json @ 99928583, textureGrid/frameGap per id).
    ["tile 24 (corruption short plants, 16×20)", "tile", 24, { frameWidth: 16, frameHeight: 20, gapX: 2, gapY: 2 }],
    ["tile 703 (16×20 family)", "tile", 703, { frameWidth: 16, frameHeight: 20, gapX: 2, gapY: 2 }],
    ["tile 16 (16×18)", "tile", 16, { frameWidth: 16, frameHeight: 18, gapX: 2, gapY: 2 }],
    ["tile 73 (16×32)", "tile", 73, { frameWidth: 16, frameHeight: 32, gapX: 2, gapY: 2 }],
    ["tile 81 (24×26)", "tile", 81, { frameWidth: 24, frameHeight: 26, gapX: 2, gapY: 2 }],
    ["tile 184 (20×16)", "tile", 184, { frameWidth: 20, frameHeight: 16, gapX: 2, gapY: 2 }],
    ["tile 227 (32×38)", "tile", 227, { frameWidth: 32, frameHeight: 38, gapX: 2, gapY: 2 }],
    ["tile 476 (20×18)", "tile", 476, { frameWidth: 20, frameHeight: 18, gapX: 2, gapY: 2 }],
    ["tile 529 (16×15)", "tile", 529, { frameWidth: 16, frameHeight: 15, gapX: 2, gapY: 2 }],
    ["tile 567 (26×18)", "tile", 567, { frameWidth: 26, frameHeight: 18, gapX: 2, gapY: 2 }],
    ["tile 656 (24×34)", "tile", 656, { frameWidth: 24, frameHeight: 34, gapX: 2, gapY: 2 }],
    ["tile 442 (20×20 family)", "tile", 442, { frameWidth: 20, frameHeight: 20, gapX: 2, gapY: 2 }],
    ["tile 172 (sinks, 2×3 gutter)", "tile", 172, { frameWidth: 16, frameHeight: 16, gapX: 2, gapY: 3 }],
    ["tile 751 (18×18 grid, no gutter)", "tile", 751, { frameWidth: 18, frameHeight: 18, gapX: 0, gapY: 0 }],
  ] as const)("packSheets_%s_IndexesItsEffectiveFrameAndGutter", (_label, kind, id, expected) => {
    const atlas = packSheets([sheet(kind, id, 40, 40)], { pageSize: 128 });
    expect(findSprite(atlas, kind, id)).toMatchObject(expected);
  });

  it("packSheets_DefaultOptions_Use4096Pages", () => {
    const atlas = packSheets([sheet("tile", 0, 18, 18)]);
    expect(atlas.index.pageSize).toBe(4096);
    expect(atlas.pages[0]?.length).toBe(4096 * 4096 * 4);
  });

  it("packSheets_SheetLargerThanAPage_ThrowsAClearError", () => {
    const wide = sheet("wall", 9, 100, 10);
    const error = (() => {
      try {
        packSheets([wide], { pageSize: 64, padding: 0 });
      } catch (e) {
        return e;
      }
      return undefined;
    })();
    expect(error).toBeInstanceOf(AtlasSheetTooLargeError);
    const tooLarge = error as AtlasSheetTooLargeError;
    expect([tooLarge.kind, tooLarge.id]).toEqual(["wall", 9]);
    expect(tooLarge.message).toMatch(/100/);
    expect(tooLarge.message).toMatch(/64/);
  });

  it("packSheets_SheetFillingTheWholePageButForPadding_Fits", () => {
    const atlas = packSheets([sheet("tile", 1, 60, 60)], { pageSize: 64, padding: 2 });
    expect(atlas.index.entries).toHaveLength(1);
  });

  it("findSprite_UnknownSheet_ReturnsUndefined", () => {
    const atlas = packSheets([sheet("tile", 1, 16, 16)], { pageSize: 64 });
    expect(findSprite(atlas, "tile", 2)).toBeUndefined();
    expect(findSprite(atlas, "wall", 1)).toBeUndefined();
  });
});

describe("computeFingerprint", () => {
  const files = [
    { name: "Tiles_0.xnb", size: 100, lastModified: 5 },
    { name: "Wall_1.xnb", size: 200, lastModified: 6 },
  ];

  it("computeFingerprint_SameInput_IsStableAndOrderIndependent", () => {
    const a = computeFingerprint(files, 1);
    expect(computeFingerprint([...files].reverse(), 1)).toBe(a);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/); // usable as an OPFS directory name
  });

  it.each([
    ["size", [{ ...files[0], size: 101 }, files[1]]],
    ["lastModified", [files[0], { ...files[1], lastModified: 7 }]],
    ["name", [{ ...files[0], name: "Tiles_9.xnb" }, files[1]]],
    ["a removed file", [files[0]]],
  ])("computeFingerprint_Changed%s_DiffersFromTheOriginal", (_label, changed) => {
    expect(computeFingerprint(changed as typeof files, 1)).not.toBe(computeFingerprint(files, 1));
  });

  it("computeFingerprint_OtherFormatVersion_Differs", () => {
    expect(computeFingerprint(files, 2)).not.toBe(computeFingerprint(files, 1));
  });
});

describe("atlas cache", () => {
  const makeAtlas = (): ReturnType<typeof packSheets> =>
    packSheets([sheet("tile", 0, 30, 20), sheet("wall", 1, 64, 32)], { pageSize: 128, padding: 1 });

  it("storeAtlas_ThenLoad_RoundTripsPagesAndIndex", async () => {
    const root = new MemoryDirectory();
    const atlas = makeAtlas();
    await storeAtlas(root, "fp-a", atlas);
    const loaded = await loadCachedAtlas(root, "fp-a");
    expect(loaded).toBeDefined();
    expect(loaded?.index).toEqual(atlas.index);
    expect(loaded?.pages).toEqual(atlas.pages);
  });

  it("storeAtlas_ThenLoad_KeepsPerSheetFrameAndGutterMetrics", async () => {
    const root = new MemoryDirectory();
    await storeAtlas(root, "fp-a", packSheets([sheet("tile", 4, 40, 40), sheet("tile", 15, 40, 40), sheet("wall", 1, 64, 64)], { pageSize: 256 }));
    const loaded = await loadCachedAtlas(root, "fp-a");
    expect(loaded && findSprite(loaded, "tile", 4)).toMatchObject({ frameWidth: 20, frameHeight: 20, gapX: 2, gapY: 2 });
    expect(loaded && findSprite(loaded, "tile", 15)).toMatchObject({ frameWidth: 16, frameHeight: 16, gapX: 2, gapY: 4 });
    expect(loaded && findSprite(loaded, "wall", 1)).toMatchObject({ frameWidth: 32, frameHeight: 32, gapX: 4, gapY: 4 });
  });

  it("loadCachedAtlas_OtherFingerprint_ReturnsUndefined", async () => {
    const root = new MemoryDirectory();
    const atlas = makeAtlas();
    await storeAtlas(root, "fp-a", atlas);
    expect(await loadCachedAtlas(root, "fp-b")).toBeUndefined();
    expect(await loadCachedAtlas(new MemoryDirectory(), "fp-a")).toBeUndefined();
  });

  it("storeAtlas_NewFingerprint_ReplacesTheOldEntry", async () => {
    const root = new MemoryDirectory();
    const atlas = makeAtlas();
    await storeAtlas(root, "fp-a", atlas);
    await storeAtlas(root, "fp-b", atlas);
    expect(await loadCachedAtlas(root, "fp-a")).toBeUndefined();
    expect(await loadCachedAtlas(root, "fp-b")).toBeDefined();
  });
});

/** An `Images/` folder of uncompressed synthetic XNBs. */
function contentWith(sheets: readonly { name: string; width: number; height: number }[]): MemoryDirectory {
  const content = new MemoryDirectory();
  const images = new MemoryDirectory();
  for (const { name, width, height } of sheets) {
    images.putFile(`${name}.xnb`, wrapUncompressed(buildTexturePayload(width, height, patternRgba(width, height))));
  }
  content.putFile("unused.txt", new Uint8Array(1));
  content.putDirectory("Images", images);
  return content;
}

const SHEETS = [
  { name: "Tiles_0", width: 288, height: 270 },
  { name: "Tiles_1", width: 90, height: 40 },
  { name: "TIles_650", width: 20, height: 20 }, // case differs on a real install (docs/assets.md)
  { name: "Wall_1", width: 468, height: 180 },
  { name: "Wall_2", width: 36, height: 36 },
  { name: "Wall_Outline", width: 36, height: 36 }, // look-alike, not a wall sheet
  { name: "Tiles_5_0", width: 36, height: 36 }, // variant sheet, deferred
];

/** `content` where the `Images/<name>` entry is listed but `getFile()` rejects, like a file that vanished mid-scan. */
function withUnreadableSheet(content: MemoryDirectory, name: string): ContentDirectory {
  const unreadable = (images: MemoryDirectory): ContentDirectory => ({
    getDirectoryHandle: () => Promise.reject(new DOMException("no subdirectory", "NotFoundError")),
    async *entries() {
      for await (const [entryName, entry] of images.entries()) {
        yield entryName === name
          ? [entryName, { kind: "file", getFile: () => Promise.reject(new DOMException("gone", "NotFoundError")) }]
          : [entryName, entry];
      }
    },
  });
  return {
    getDirectoryHandle: async () => unreadable(await content.getDirectoryHandle("Images")),
    entries: () => content.entries(),
  };
}

/** Aborts `controller` as soon as the cache's first page file is being written, i.e. during an awaited write. */
function abortOnFirstWrite(cache: MemoryDirectory, controller: AbortController): void {
  const getDirectory = cache.getDirectoryHandle.bind(cache);
  cache.getDirectoryHandle = async (name, options) => {
    const directory = await getDirectory(name, options);
    const getFile = directory.getFileHandle.bind(directory);
    directory.getFileHandle = async (fileName, fileOptions) => {
      const handle = await getFile(fileName, fileOptions);
      const createWritable = handle.createWritable.bind(handle);
      handle.createWritable = async () => {
        const writable = await createWritable();
        return {
          ...writable,
          write: async (data) => {
            controller.abort();
            await writable.write(data);
          },
        };
      };
      return handle;
    };
    return directory;
  };
}

function countingDecoder(): { decode: (bytes: Uint8Array) => XnbTexture; calls: () => number } {
  let calls = 0;
  return {
    decode: (bytes) => {
      calls++;
      return readXnbTexture(bytes);
    },
    calls: () => calls,
  };
}

describe("buildSpriteAtlas", () => {
  it("buildSpriteAtlas_ContentFolder_IndexesTileAndWallSheetsOnly", async () => {
    const result = await buildSpriteAtlas(contentWith(SHEETS), { pageSize: 1024 });
    const keys = result.atlas.index.entries.map((e) => `${e.kind}:${String(e.id)}`).sort();
    expect(keys).toEqual(["tile:0", "tile:1", "tile:650", "wall:1", "wall:2"]);
    expect(result.fromCache).toBe(false);
    expect(result.missing).toEqual([]);
    const entry = findSprite(result.atlas, "tile", 1);
    expect(entry && readSpritePixels(result.atlas, entry)).toEqual(patternRgba(90, 40));
  });

  it("buildSpriteAtlas_SecondBuildWithSameFingerprint_ReadsCacheAndDecodesNothing", { tags: ["perf"] }, async () => {
    const content = contentWith(SHEETS);
    const cache = new MemoryDirectory();
    const counter = countingDecoder();
    const first = await buildSpriteAtlas(content, { cache, decode: counter.decode, pageSize: 1024 });
    expect(first.fromCache).toBe(false);
    expect(counter.calls()).toBe(5);

    const second = await buildSpriteAtlas(content, { cache, decode: counter.decode, pageSize: 1024 });
    expect(second.fromCache).toBe(true);
    expect(counter.calls()).toBe(5);
    expect(second.fingerprint).toBe(first.fingerprint);
    expect(second.atlas.index).toEqual(first.atlas.index);
    expect(second.atlas.pages).toEqual(first.atlas.pages);
  });

  it.each([
    ["size", (images: MemoryDirectory) => { images.putFile("Wall_2.xnb", wrapUncompressed(buildTexturePayload(40, 36, patternRgba(40, 36)))); }],
    ["last-modified time", (images: MemoryDirectory) => {
      const file = images.file("Wall_2.xnb");
      images.putFile("Wall_2.xnb", file?.bytes ?? new Uint8Array(0), 99_999);
    }],
  ])("buildSpriteAtlas_ChangedSource%s_Rebuilds", async (_label, change) => {
    const content = contentWith(SHEETS);
    const images = await content.getDirectoryHandle("Images");
    const cache = new MemoryDirectory();
    const counter = countingDecoder();
    await buildSpriteAtlas(content, { cache, decode: counter.decode, pageSize: 1024 });
    const before = counter.calls();
    change(images);
    const rebuilt = await buildSpriteAtlas(content, { cache, decode: counter.decode, pageSize: 1024 });
    expect(rebuilt.fromCache).toBe(false);
    expect(counter.calls()).toBe(before + 5);
  });

  it("buildSpriteAtlas_UndecodableSheet_IsListedAndTheRestIsBuilt", async () => {
    const content = contentWith(SHEETS);
    const images = await content.getDirectoryHandle("Images");
    images.putFile("Tiles_1.xnb", new Uint8Array([1, 2, 3, 4]));
    const result = await buildSpriteAtlas(content, { pageSize: 1024 });
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ kind: "tile", id: 1, name: "Tiles_1.xnb" });
    expect(result.missing[0]?.reason.length).toBeGreaterThan(0);
    expect(findSprite(result.atlas, "tile", 1)).toBeUndefined();
    expect(findSprite(result.atlas, "tile", 0)).toBeDefined();
  });

  it("buildSpriteAtlas_OversizedSheet_RejectsWithAClearError", async () => {
    const content = contentWith([{ name: "Tiles_0", width: 100, height: 10 }]);
    await expect(buildSpriteAtlas(content, { pageSize: 64 })).rejects.toBeInstanceOf(AtlasSheetTooLargeError);
  });

  it("buildSpriteAtlas_Progress_ReportsEveryDecodeStepUpToTheTotal", async () => {
    const events: BuildProgress[] = [];
    await buildSpriteAtlas(contentWith(SHEETS), { pageSize: 1024, onProgress: (p) => events.push(p) });
    const decode = events.filter((e) => e.phase === "decode");
    expect(decode).toHaveLength(5);
    expect(decode.map((e) => e.done)).toEqual([1, 2, 3, 4, 5]);
    expect(decode.every((e) => e.total === 5)).toBe(true);
    const phases = events.map((e) => e.phase);
    expect(phases.indexOf("pack")).toBeGreaterThan(phases.lastIndexOf("decode"));
  });

  it("buildSpriteAtlas_AbortedMidBuild_RejectsWithAbortErrorAndLeavesNoCacheEntry", async () => {
    const controller = new AbortController();
    const cache = new MemoryDirectory();
    const promise = buildSpriteAtlas(contentWith(SHEETS), {
      cache,
      pageSize: 1024,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === "decode" && p.done === 2) controller.abort();
      },
    });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.names()).toEqual([]);
  });

  it("buildSpriteAtlas_AlreadyAbortedSignal_RejectsWithoutDecoding", async () => {
    const controller = new AbortController();
    controller.abort();
    const counter = countingDecoder();
    await expect(
      buildSpriteAtlas(contentWith(SHEETS), { decode: counter.decode, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(counter.calls()).toBe(0);
  });

  it("buildSpriteAtlas_AbortedAtTheStoreBoundary_RejectsWithAbortErrorAndLeavesNoCacheEntry", async () => {
    const controller = new AbortController();
    const cache = new MemoryDirectory();
    const promise = buildSpriteAtlas(contentWith(SHEETS), {
      cache,
      pageSize: 1024,
      signal: controller.signal,
      onProgress: (p) => {
        if (p.phase === "store" && p.done === 0) controller.abort();
      },
    });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.names()).toEqual([]);
  });

  it("buildSpriteAtlas_AbortedDuringACacheWrite_RejectsWithAbortErrorAndRemovesTheUncommittedEntry", async () => {
    const controller = new AbortController();
    const cache = new MemoryDirectory();
    abortOnFirstWrite(cache, controller);
    const promise = buildSpriteAtlas(contentWith(SHEETS), { cache, pageSize: 1024, signal: controller.signal });
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.names()).toEqual([]);
  });

  it("buildSpriteAtlas_CacheHit_RestoresTheMissingSheetReportWithoutDecoding", async () => {
    const content = contentWith(SHEETS);
    const images = await content.getDirectoryHandle("Images");
    images.putFile("Tiles_1.xnb", new Uint8Array([1, 2, 3, 4]));
    const cache = new MemoryDirectory();
    const counter = countingDecoder();
    const first = await buildSpriteAtlas(content, { cache, decode: counter.decode, pageSize: 1024 });
    expect(first.missing.map((m) => `${m.kind}:${String(m.id)}`)).toEqual(["tile:1"]);
    const calls = counter.calls();

    const second = await buildSpriteAtlas(content, { cache, decode: counter.decode, pageSize: 1024 });
    expect(second.fromCache).toBe(true);
    expect(counter.calls()).toBe(calls);
    expect(second.missing).toEqual(first.missing);
  });

  it("buildSpriteAtlas_AbortedWhileCachedPagesLoad_RejectsWithAbortErrorAndKeepsTheCommittedEntry", async () => {
    const content = contentWith(SHEETS);
    const cache = new MemoryDirectory();
    await buildSpriteAtlas(content, { cache, pageSize: 1024 });
    const names = cache.names();
    expect(names).toHaveLength(1);

    const controller = new AbortController();
    const getDirectory = cache.getDirectoryHandle.bind(cache);
    cache.getDirectoryHandle = async (name, options) => {
      const directory = await getDirectory(name, options);
      const getFile = directory.getFileHandle.bind(directory);
      directory.getFileHandle = async (fileName, fileOptions) => {
        const handle = await getFile(fileName, fileOptions);
        if (!fileName.startsWith("page-")) return handle;
        const read = handle.getFile.bind(handle);
        handle.getFile = async () => {
          const file = await read();
          return {
            ...file,
            arrayBuffer: async () => {
              controller.abort();
              return file.arrayBuffer();
            },
          };
        };
        return handle;
      };
      return directory;
    };

    const counter = countingDecoder();
    await expect(
      buildSpriteAtlas(content, { cache, decode: counter.decode, pageSize: 1024, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(cache.names()).toEqual(names);
  });

  it("buildSpriteAtlas_UnreadableMatchedSheet_IsListedAsMissingAndTheRestIsBuilt", async () => {
    const content = withUnreadableSheet(contentWith(SHEETS), "Tiles_1.xnb");
    const result = await buildSpriteAtlas(content, { pageSize: 1024 });
    expect(result.missing).toHaveLength(1);
    expect(result.missing[0]).toMatchObject({ kind: "tile", id: 1, name: "Tiles_1.xnb" });
    expect(result.missing[0]?.reason.length).toBeGreaterThan(0);
    expect(findSprite(result.atlas, "tile", 1)).toBeUndefined();
    expect(findSprite(result.atlas, "tile", 0)).toBeDefined();
    expect(findSprite(result.atlas, "wall", 2)).toBeDefined();
  });

  it("buildSpriteAtlas_IncompleteScan_IsNeverTreatedAsAnUnchangedCacheHit", async () => {
    const content = withUnreadableSheet(contentWith(SHEETS), "Tiles_1.xnb");
    const cache = new MemoryDirectory();
    const first = await buildSpriteAtlas(content, { cache, pageSize: 1024 });
    const second = await buildSpriteAtlas(content, { cache, pageSize: 1024 });
    expect(second.fromCache).toBe(false);
    expect(second.missing).toEqual(first.missing);
    expect(second.missing.map((m) => m.id)).toEqual([1]);
  });

  it("buildSpriteAtlas_Build_MakesNoNetworkRequests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network is off limits"));
    try {
      await buildSpriteAtlas(contentWith(SHEETS), { cache: new MemoryDirectory(), pageSize: 1024 });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
