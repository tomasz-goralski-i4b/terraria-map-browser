import { afterEach, describe, expect, test, vi } from "vitest";
import { WebGl2UnavailableError, createMapRenderer, renderChunk, visibleChunks } from "../src/index.js";
import type { ChunkLayers, MapPalette, MapRenderer, MapRendererOptions, RenderableWorld } from "../src/index.js";
import { syntheticMapPalette } from "./map-palette.fixture.js";

const created: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of created.splice(0)) renderer.dispose();
});

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function makeRenderer(canvas: HTMLCanvasElement, options?: MapRendererOptions): MapRenderer {
  const renderer = createMapRenderer(canvas, options);
  created.push(renderer);
  return renderer;
}

const palette = [
  { kind: "vanilla", id: 0 }, { kind: "vanilla", id: 1 }, { kind: "vanilla", id: 2 }, { kind: "vanilla", id: 25 },
] as const;

/** Column-major planes with a deterministic mix of blocks, walls, liquids, partial amounts and paints. */
function syntheticWorld(width: number, height: number, depth?: { surfaceY: number; rockY: number }): RenderableWorld {
  const count = width * height;
  const block = new Uint16Array(count).fill(0xffff);
  const wall = new Uint16Array(count).fill(0xffff);
  const liquid = new Uint8Array(count);
  const liquidAmount = new Uint8Array(count);
  const paint = new Uint8Array(count);
  const wallPaint = new Uint8Array(count);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) {
      const i = x * height + y;
      const hash = (x * 7 + y * 13 + ((x * y) % 11)) % 17;
      if (hash < 4) block[i] = hash;
      if (hash % 3 === 0) wall[i] = (hash + 1) % 4;
      if (hash > 10) {
        liquid[i] = hash % 5;
        liquidAmount[i] = (hash * 37) % 256;
      }
      // Every paint ID 0–31, including shadow (29) and negative (30), on blocks and walls.
      paint[i] = (x * 5 + y * 3) % 32;
      wallPaint[i] = (x * 3 + y * 7) % 32;
    }
  }
  return {
    width, height, surfaceY: depth?.surfaceY ?? Math.floor(height / 2), ...(depth === undefined ? {} : { rockY: depth.rockY }),
    planes: { block, wall, liquid, liquidAmount, paint, wallPaint }, palette,
  };
}

function readCanvas(canvas: HTMLCanvasElement): Uint8Array {
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("no webgl2 context");
  const out = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, out);
  // readPixels is bottom-up; flip to the top-down order renderChunk uses.
  const flipped = new Uint8Array(out.length);
  const row = canvas.width * 4;
  for (let y = 0; y < canvas.height; y++) {
    flipped.set(out.subarray((canvas.height - 1 - y) * row, (canvas.height - y) * row), y * row);
  }
  return flipped;
}

/** The CPU reference for a whole world at 1 pixel per tile, stitched from renderChunk. */
function cpuReference(world: RenderableWorld, layers: ChunkLayers, mapPalette?: MapPalette): Uint8Array {
  const rockY = world.rockY === undefined ? {} : { rockY: world.rockY };
  const out = new Uint8Array(world.width * world.height * 4);
  for (let cy = 0; cy < Math.ceil(world.height / 128); cy++) {
    for (let cx = 0; cx < Math.ceil(world.width / 128); cx++) {
      const chunk = renderChunk(world as never, cx, cy, {
        surfaceY: world.surfaceY, ...rockY, layers, ...(mapPalette === undefined ? {} : { mapPalette }),
      });
      for (let y = 0; y < chunk.height; y++) {
        const dest = ((cy * 128 + y) * world.width + cx * 128) * 4;
        out.set(chunk.pixels.subarray(y * chunk.width * 4, (y + 1) * chunk.width * 4), dest);
      }
    }
  }
  return out;
}

const layerCombos: ChunkLayers[] = Array.from({ length: 16 }, (_, bits) => ({
  background: (bits & 1) !== 0, walls: (bits & 2) !== 0, blocks: (bits & 4) !== 0, liquids: (bits & 8) !== 0,
}));
const allLayers: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true };

describe("GPU output equals renderChunk", () => {
  // 300 × 200: a 3 × 2 chunk grid whose right and bottom chunks are partial.
  const world = syntheticWorld(300, 200);

  test.each(layerCombos)("layers %o at 1 pixel per tile", (layers) => {
    const canvas = makeCanvas(300, 200);
    const renderer = makeRenderer(canvas);
    renderer.setWorld(world);
    renderer.setLayers(layers);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect(readCanvas(canvas)).toEqual(cpuReference(world, layers));
  });

  test.each(layerCombos)("layers %o with a map palette (paint, sky gradient, depth layers) at 1 pixel per tile", (layers) => {
    // 300 × 400: sky above 90.5, dirt to 140.25, rock to the underworld at row 200 (height − 200).
    const layered = syntheticWorld(300, 400, { surfaceY: 90.5, rockY: 140.25 });
    const canvas = makeCanvas(300, 400);
    const renderer = makeRenderer(canvas, { mapPalette: syntheticMapPalette });
    renderer.setWorld(layered);
    renderer.setLayers(layers);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect(readCanvas(canvas)).toEqual(cpuReference(layered, layers, syntheticMapPalette));
  });

  test("a viewport covering only the partial edge chunk matches that chunk", () => {
    const canvas = makeCanvas(44, 72);
    const renderer = makeRenderer(canvas);
    renderer.setWorld(world);
    renderer.setLayers(allLayers);
    renderer.setCamera({ x: 256, y: 128, zoom: 1 });
    renderer.render();
    const chunk = renderChunk(world as never, 2, 1, { surfaceY: world.surfaceY, layers: allLayers });
    expect(chunk.width).toBe(44);
    expect(chunk.height).toBe(72);
    expect(readCanvas(canvas)).toEqual(new Uint8Array(chunk.pixels));
  });

  test("tileAt maps canvas pixels to integer tiles and null outside the world", () => {
    const renderer = makeRenderer(makeCanvas(400, 300));
    renderer.setWorld(world);
    renderer.setCamera({ x: 10, y: 20, zoom: 2 });
    expect(renderer.tileAt(0, 0)).toEqual({ x: 10, y: 20 });
    expect(renderer.tileAt(5, 7)).toEqual({ x: 12, y: 23 });
    expect(renderer.tileAt(399, 299)).toEqual({ x: 209, y: 169 });
    expect(renderer.tileAt(400, 0)).toBeNull();
    renderer.setCamera({ x: -50, y: 0, zoom: 1 });
    expect(renderer.tileAt(10, 10)).toBeNull();
  });

  test("appending palette entries after upload colours new content like the CPU reference", () => {
    const grown = syntheticWorld(128, 128);
    const growing: RenderableWorld = { ...grown, palette: [...palette].slice(0, 2) };
    const canvas = makeCanvas(128, 128);
    const renderer = makeRenderer(canvas);
    renderer.setWorld(growing);
    renderer.setLayers(allLayers);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    const before = renderer.stats().textureUploads;
    (growing.palette as unknown[]).push(...palette.slice(2));
    renderer.setWorld(growing);
    renderer.render();
    expect(renderer.stats().textureUploads - before).toBeLessThanOrEqual(1);
    expect(readCanvas(canvas)).toEqual(cpuReference(grown, allLayers));
  });

  /** Texels of the palette texture written by texSubImage2D while `action` runs, as "x,y" keys. */
  function paletteTexelsWritten(action: () => void): Set<string> {
    const texels = new Set<string>();
    const proto = WebGL2RenderingContext.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the real receiver below
    const original = proto.texSubImage2D;
    const spy = vi.spyOn(proto, "texSubImage2D").mockImplementation(function (this: WebGL2RenderingContext, ...args: unknown[]) {
      if (args[6] === this.RGBA_INTEGER) {
        const [, , x, y, w, h] = args as [unknown, unknown, number, number, number, number];
        for (let row = y; row < y + h; row++) {
          for (let column = x; column < x + w; column++) texels.add(`${String(column)},${String(row)}`);
        }
      }
      (original as unknown as (...rest: unknown[]) => void).apply(this, args);
    });
    try {
      action();
    } finally {
      spy.mockRestore();
    }
    return texels;
  }

  function appendUpload(from: number, to: number): { written: Set<string>; expected: Set<string> } {
    const base = syntheticWorld(128, 128);
    const entries = Array.from({ length: to }, (_, id) => ({ kind: "vanilla", id }) as const);
    const growing: RenderableWorld = { ...base, palette: entries.slice(0, from) };
    const renderer = makeRenderer(makeCanvas(128, 128));
    renderer.setWorld(growing);
    renderer.render();
    const written = paletteTexelsWritten(() => {
      (growing.palette as unknown[]).push(...entries.slice(from));
      renderer.setWorld(growing);
      renderer.render();
    });
    const expected = new Set<string>();
    for (let index = from; index < to; index++) {
      expected.add(`${String(index % 256)},${String(Math.floor(index / 256))}`);
      expected.add(`${String(256 + (index % 256))},${String(Math.floor(index / 256))}`);
    }
    return { written, expected };
  }

  test("appending palette entries within a row uploads only the new texels", () => {
    const { written, expected } = appendUpload(2, 4);
    expect([...written].sort()).toEqual([...expected].sort());
  });

  test("appending palette entries across the entry 255/256 row boundary uploads only the new texels", () => {
    const { written, expected } = appendUpload(255, 257);
    expect([...written].sort()).toEqual([...expected].sort());
  });
});

describe("uploads, cache and draw calls", () => {
  const world = syntheticWorld(1280, 256);

  test("layer toggles and camera moves upload no texture data", () => {
    const renderer = makeRenderer(makeCanvas(256, 256));
    renderer.setWorld(world);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    const uploads = renderer.stats().textureUploads;
    expect(uploads).toBeGreaterThan(0);
    renderer.setLayers({ background: true, walls: false, blocks: true, liquids: false });
    renderer.render();
    renderer.setLayers({ background: false, walls: true, blocks: false, liquids: true });
    renderer.render();
    renderer.setCamera({ x: 17, y: 3, zoom: 1.5 });
    renderer.render();
    expect(renderer.stats().textureUploads).toBe(uploads);
    expect(renderer.stats().drawCalls).toBeGreaterThan(0);
  });

  test("changed layers change the pixels without touching chunk textures", () => {
    const canvas = makeCanvas(128, 128);
    const renderer = makeRenderer(canvas);
    renderer.setWorld(world);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.setLayers(allLayers);
    renderer.render();
    const full = readCanvas(canvas);
    const uploads = renderer.stats().textureUploads;
    renderer.setLayers({ background: true, walls: false, blocks: false, liquids: false });
    renderer.render();
    expect(readCanvas(canvas)).not.toEqual(full);
    expect(renderer.stats().textureUploads).toBe(uploads);
  });

  test("the chunk texture cache stays within its bound and re-uploads evicted chunks identically", () => {
    const canvas = makeCanvas(256, 128);
    const renderer = makeRenderer(canvas, { maxCachedChunks: 4 });
    renderer.setWorld(world);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    const first = readCanvas(canvas);
    for (let x = 128; x <= 1024; x += 128) {
      renderer.setCamera({ x, y: 0, zoom: 1 });
      renderer.render();
      expect(renderer.stats().residentChunks).toBeLessThanOrEqual(4);
    }
    const uploadsBefore = renderer.stats().textureUploads;
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect(renderer.stats().textureUploads).toBeGreaterThan(uploadsBefore);
    expect(renderer.stats().residentChunks).toBeLessThanOrEqual(4);
    expect(readCanvas(canvas)).toEqual(first);
  });

  test("a lost and restored WebGL context re-creates textures and renders the same pixels", async () => {
    const canvas = makeCanvas(256, 128);
    const renderer = makeRenderer(canvas);
    renderer.setWorld(world);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    const before = readCanvas(canvas);
    const lose = canvas.getContext("webgl2")?.getExtension("WEBGL_lose_context");
    if (lose === null || lose === undefined) throw new Error("WEBGL_lose_context unavailable");
    const restored = new Promise<void>((resolve) => {
      canvas.addEventListener("webglcontextrestored", () => {
        resolve();
      });
    });
    lose.loseContext();
    lose.restoreContext();
    await restored;
    renderer.render();
    expect(readCanvas(canvas)).toEqual(before);
  });

  test("a pan frame over an 8400 × 2400 world uploads only newly visible chunks and draws only visible ones", () => {
    const count = 8400 * 2400;
    const big: RenderableWorld = {
      width: 8400, height: 2400, surfaceY: 800,
      planes: {
        block: new Uint16Array(count), wall: new Uint16Array(count),
        liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count),
        paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
      },
      palette,
    };
    const viewport = { width: 512, height: 512 };
    const renderer = makeRenderer(makeCanvas(viewport.width, viewport.height));
    renderer.setWorld(big);
    renderer.setCamera({ x: 1000, y: 0, zoom: 1 });
    renderer.render();
    const first = renderer.stats();
    const expected = visibleChunks({ x: 1000, y: 0, zoom: 1 }, viewport, big);
    expect(first.visibleChunks).toEqual(expected);
    expect(first.drawCalls).toBe(expected.length);
    expect(first.textureUploads).toBeLessThan(66 * 19);

    renderer.setCamera({ x: 1128, y: 0, zoom: 1 });
    renderer.render();
    const second = renderer.stats();
    const resident = new Set(expected.map((chunk: { x: number; y: number }) => `${String(chunk.x)},${String(chunk.y)}`));
    const entering = visibleChunks({ x: 1128, y: 0, zoom: 1 }, viewport, big)
      .filter((chunk: { x: number; y: number }) => !resident.has(`${String(chunk.x)},${String(chunk.y)}`)).length;
    expect(entering).toBeGreaterThan(0);
    expect(second.textureUploads - first.textureUploads).toBeLessThanOrEqual(entering);
    expect(second.drawCalls).toBe(second.visibleChunks.length);
    expect(second.drawCalls).toBeLessThan(66 * 19);
  });
});

describe("WebGL2 availability", () => {
  test("creation fails with a typed error when no WebGL2 context can be created", () => {
    const canvas = makeCanvas(10, 10);
    canvas.getContext = (() => null) as typeof canvas.getContext;
    expect(() => createMapRenderer(canvas)).toThrow(WebGl2UnavailableError);
  });
});
