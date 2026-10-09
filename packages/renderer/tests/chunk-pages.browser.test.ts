import { afterEach, describe, expect, test, vi } from "vitest";
import { CHUNK_SIZE, createMapRenderer, fitWorld, mapOption, renderChunk, terrariaMapPalette } from "../src/index.js";
import type {
  ChunkLayers, MapOptionRule, MapPalette, MapRenderer, MapRendererOptions, RenderableWorld,
} from "../src/index.js";
import { syntheticMapPalette } from "./map-palette.fixture.js";

const created: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of created.splice(0)) renderer.dispose();
  vi.restoreAllMocks();
});

function setup(width: number, height: number, options?: MapRendererOptions, reuse?: HTMLCanvasElement) {
  const canvas = reuse ?? document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const renderer = createMapRenderer(canvas, options);
  created.push(renderer);
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("WebGL2 unavailable");
  /** The canvas top-down, as renderChunk lays out its pixels. */
  const pixels = (): Uint8Array => {
    const out = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, out);
    const flipped = new Uint8Array(out.length);
    const row = width * 4;
    for (let y = 0; y < height; y++) flipped.set(out.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return flipped;
  };
  return { canvas, renderer, gl, pixels };
}

/** The CPU reference for a whole world at one pixel per tile, stitched from renderChunk. */
function cpuReference(world: RenderableWorld, layers: ChunkLayers, mapPalette?: MapPalette): Uint8Array {
  const out = new Uint8Array(world.width * world.height * 4);
  for (let cy = 0; cy < Math.ceil(world.height / CHUNK_SIZE); cy++) {
    for (let cx = 0; cx < Math.ceil(world.width / CHUNK_SIZE); cx++) {
      const chunk = renderChunk(world as never, cx, cy, {
        surfaceY: world.surfaceY, layers, ...(mapPalette === undefined ? {} : { mapPalette }),
      });
      for (let y = 0; y < chunk.height; y++) {
        const dest = ((cy * CHUNK_SIZE + y) * world.width + cx * CHUNK_SIZE) * 4;
        out.set(chunk.pixels.subarray(y * chunk.width * 4, (y + 1) * chunk.width * 4), dest);
      }
    }
  }
  return out;
}

/** Pixels that differ, as "(x, y): actual vs expected", for a readable failure (a diff of two canvases is not). */
function differing(actual: Uint8Array, expected: Uint8Array, width: number): string[] {
  const out: string[] = [];
  for (let index = 0; index < actual.length; index += 4) {
    const got = [...actual.subarray(index, index + 4)];
    const want = [...expected.subarray(index, index + 4)];
    if (got.some((value, channel) => value !== want[channel])) {
      out.push(`(${String((index / 4) % width)}, ${String(Math.floor(index / 4 / width))}): ${String(got)} vs ${String(want)}`);
    }
  }
  return out;
}

const allLayers: ChunkLayers = { background: true, walls: true, blocks: true, liquids: true, wires: 31 };

/** Every plane present and non-trivial, so that a misplaced or missing upload shows in the pixels. */
function fullWorld(width: number, height: number): RenderableWorld {
  const count = width * height;
  const planes = {
    block: new Uint16Array(count), wall: new Uint16Array(count), liquid: new Uint8Array(count),
    liquidAmount: new Uint8Array(count), paint: new Uint8Array(count), wallPaint: new Uint8Array(count),
    frameX: new Int16Array(count), frameY: new Int16Array(count), flags: new Uint16Array(count),
    shape: new Uint8Array(count),
  };
  for (let i = 0; i < count; i++) {
    const hash = (i * 2654435761) >>> 0;
    planes.block[i] = hash % 7 < 4 ? hash % 4 : 0xffff;
    planes.wall[i] = (hash >>> 3) % 3 === 0 ? 0xffff : 1;
    planes.liquid[i] = (hash >>> 5) % 5;
    planes.liquidAmount[i] = (hash >>> 8) & 0xff;
    planes.paint[i] = (hash >>> 11) % 32;
    planes.wallPaint[i] = (hash >>> 13) % 32;
    planes.frameX[i] = ((hash >>> 16) % 6) * 9;
    planes.frameY[i] = ((hash >>> 19) % 7) * 18;
    planes.flags[i] = (hash >>> 22) & 0xff;
    planes.shape[i] = (hash >>> 25) % 6;
  }
  return {
    width, height, surfaceY: Math.floor(height / 3), planes,
    palette: [{ kind: "vanilla", id: 0 }, { kind: "vanilla", id: 1 }, { kind: "vanilla", id: 2 }, { kind: "vanilla", id: 3 }],
  };
}

/**
 * The same world with every plane a view at a non-zero byte offset into a larger buffer, as planes sliced out of one
 * allocation would be.
 */
function offsetViews(world: RenderableWorld): RenderableWorld {
  const view = <T extends Uint8Array | Uint16Array | Int16Array>(plane: T): T => {
    const Type = plane.constructor as new (buffer: ArrayBuffer, offset: number, length: number) => T;
    const offset = 8 * plane.BYTES_PER_ELEMENT;
    const copy = new Type(new ArrayBuffer(offset + plane.byteLength + 16), offset, plane.length);
    copy.set(plane);
    return copy;
  };
  const planes = Object.fromEntries(Object.entries(world.planes).map(([name, plane]) => [name, view(plane)]));
  return { ...world, planes: planes as unknown as RenderableWorld["planes"] };
}

type PlaneName = keyof RenderableWorld["planes"];

/**
 * Plane order in the page layers (packages/renderer/README.md, chunk pages). The 16-bit page holds two more layers per
 * chunk after the world's planes: the framed block and wall cells, computed by the renderer and uploaded only in sprite
 * mode.
 */
const PLANES_16: readonly PlaneName[] = ["block", "wall", "flags", "frameX", "frameY"];
const PLANES_8: readonly PlaneName[] = ["liquid", "liquidAmount", "paint", "wallPaint", "shape"];
const LAYERS_16 = PLANES_16.length + 2;
const LAYERS_8 = PLANES_8.length;

interface Upload {
  readonly plane: PlaneName;
  readonly layer: number;
  readonly offset: readonly [number, number];
  readonly size: readonly [number, number, number];
  readonly rowLength: number;
  readonly skipPixels: number;
  readonly skipRows: number;
  readonly alignment: number;
  readonly imageHeight: number;
}

/** Records every texSubImage3D call with the unpack state it ran under; `passThrough` false skips the real upload. */
function recordUploads(gl: WebGL2RenderingContext, world: RenderableWorld, passThrough: boolean): Upload[] {
  const uploads: Upload[] = [];
  const unpack = new Map<number, number>();
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the real receiver below
  const pixelStorei = gl.pixelStorei;
  vi.spyOn(gl, "pixelStorei").mockImplementation((name, value) => {
    unpack.set(name, Number(value));
    pixelStorei.call(gl, name, value);
  });
  // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the real receiver below
  const texSubImage3D = gl.texSubImage3D;
  vi.spyOn(gl, "texSubImage3D").mockImplementation((...args: unknown[]) => {
    const [, , x, y, layer, width, height, depth, , , source] = args as [
      number, number, number, number, number, number, number, number, number, number, ArrayBufferView,
    ];
    const plane = (Object.keys(world.planes) as PlaneName[]).find((name) => {
      const data = world.planes[name];
      return data?.buffer === source.buffer && data.byteOffset === source.byteOffset;
    });
    if (plane === undefined) throw new Error("texSubImage3D read something other than a world plane");
    uploads.push({
      plane, layer, offset: [x, y], size: [width, height, depth],
      rowLength: unpack.get(gl.UNPACK_ROW_LENGTH) ?? 0, skipPixels: unpack.get(gl.UNPACK_SKIP_PIXELS) ?? 0,
      skipRows: unpack.get(gl.UNPACK_SKIP_ROWS) ?? 0, alignment: unpack.get(gl.UNPACK_ALIGNMENT) ?? 4,
      imageHeight: unpack.get(gl.UNPACK_IMAGE_HEIGHT) ?? 0,
    });
    if (passThrough) (texSubImage3D as (...rest: unknown[]) => void).apply(gl, args);
  });
  return uploads;
}

describe("chunk uploads read the world planes in place", () => {
  test("uploading chunks reads no plane element in JavaScript", () => {
    const world = fullWorld(300, 200);
    let reads = 0;
    /** A plane whose integer-indexed reads are counted; everything else is forwarded to the typed array. */
    const counted = <T extends object>(plane: T): T => new Proxy(plane, {
      get: (target, property) => {
        if (typeof property === "string" && /^\d+$/.test(property)) reads++;
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const planes = Object.fromEntries(Object.entries(world.planes).map(([name, plane]) => [name, counted(plane)]));
    const watched: RenderableWorld = { ...world, planes: planes as unknown as RenderableWorld["planes"] };
    const { renderer, gl } = setup(300, 200, { mapPalette: syntheticMapPalette });
    // A proxy is not an ArrayBufferView, so the GL call itself is skipped: only the renderer's own reads count.
    recordUploads(gl, watched, false);
    renderer.setWorld(watched);
    renderer.setLayers(allLayers);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect(renderer.stats().residentChunks).toBe(6);
    expect(reads).toBe(0);
  });

  test.each([
    // 300 × 200 is not a multiple of 128: the right and bottom chunks are partial, and every chunk touches an edge.
    ["every plane", fullWorld(300, 200)],
    ["no optional planes", (() => {
      const world = fullWorld(300, 200);
      const { block, wall, liquid, liquidAmount, paint, wallPaint } = world.planes;
      return { ...world, planes: { block, wall, liquid, liquidAmount, paint, wallPaint } };
    })()],
    // An odd height (rows are not 4-byte aligned), 3 × 3 chunks with a fully interior one, planes at byte offsets.
    ["odd height, 3 × 3 chunks, offset views", offsetViews(fullWorld(300, 301))],
  ])("one texSubImage3D per present plane and chunk, selecting the chunk and its apron (%s)", (_name, world: RenderableWorld) => {
    const { renderer, gl, pixels } = setup(world.width, world.height, { mapPalette: syntheticMapPalette });
    const uploads = recordUploads(gl, world, true);
    renderer.setWorld(world);
    renderer.setLayers(allLayers);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect(gl.getError()).toBe(gl.NO_ERROR);
    const wrong = differing(pixels(), cpuReference(world, allLayers, syntheticMapPalette), world.width);
    expect(wrong.slice(0, 5), `${String(wrong.length)} pixels differ`).toEqual([]);

    const present = [...PLANES_16, ...PLANES_8].filter((plane) => world.planes[plane] !== undefined);
    const byChunk = Map.groupBy(uploads, (upload) => `${String(upload.skipRows)},${String(upload.skipPixels)}`);
    const chunksX = Math.ceil(world.width / CHUNK_SIZE);
    const chunksY = Math.ceil(world.height / CHUNK_SIZE);
    expect(byChunk.size).toBe(chunksX * chunksY);
    for (let cx = 0; cx < chunksX; cx++) {
      for (let cy = 0; cy < chunksY; cy++) {
        const originX = cx * CHUNK_SIZE;
        const originY = cy * CHUNK_SIZE;
        // The apron of one tile, cut at the world's edges.
        const firstX = Math.max(originX - 1, 0);
        const endX = Math.min(originX + CHUNK_SIZE + 1, world.width);
        const firstY = Math.max(originY - 1, 0);
        const endY = Math.min(originY + CHUNK_SIZE + 1, world.height);
        const calls = byChunk.get(`${String(firstX)},${String(firstY)}`) ?? [];
        expect(calls.map((call) => call.plane).sort()).toEqual([...present].sort());
        const slots = new Set<number>();
        for (const call of calls) {
          // Texel (s, t) of a layer is tile (y, x) of the chunk, offset by the apron.
          expect(call.offset).toEqual([firstY - originY + 1, firstX - originX + 1]);
          expect(call.size).toEqual([endY - firstY, endX - firstX, 1]);
          expect(call.rowLength).toBe(world.height);
          expect(call.alignment).toBe(1);
          expect(call.imageHeight).toBe(world.width);
          const wide = PLANES_16.includes(call.plane);
          const layers = wide ? LAYERS_16 : LAYERS_8;
          expect(call.layer % layers).toBe((wide ? PLANES_16 : PLANES_8).indexOf(call.plane));
          slots.add(Math.floor(call.layer / layers));
        }
        // All planes of one chunk share its slot.
        expect(slots.size).toBe(1);
      }
    }
  });
});

describe("map options are resolved on the GPU", () => {
  /** One column per frame value, on both axes, for tiles whose rules select an option by those exact values. */
  test("frames of -1, 0, 18, 32767 and -32768 keep their sign", () => {
    const values = [-32768, -1, 0, 18, 32767];
    const ranges = values.map((value, index) => [value, value, index + 1] as const);
    const signPalette: MapPalette = {
      ...syntheticMapPalette,
      tiles: [[0x010101], [0x100000, 0x200000, 0x300000, 0x400000, 0x500000, 0x600000], [0x001000, 0x002000, 0x003000, 0x004000, 0x005000, 0x006000]],
      tileOptions: { 1: { axis: "frameX", ranges }, 2: { axis: "frameY", ranges } },
    };
    const width = values.length * values.length;
    const height = 2;
    const count = width * height;
    const block = new Uint16Array(count);
    const frameX = new Int16Array(count);
    const frameY = new Int16Array(count);
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        block[x * height + y] = 1 + y;
        frameX[x * height + y] = values[x % values.length] ?? 0;
        frameY[x * height + y] = values[Math.floor(x / values.length)] ?? 0;
      }
    }
    const world: RenderableWorld = {
      width, height, surfaceY: 0, palette: [{ kind: "vanilla", id: 0 }, { kind: "vanilla", id: 1 }, { kind: "vanilla", id: 2 }],
      planes: {
        block, wall: new Uint16Array(count).fill(0xffff), liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count),
        paint: new Uint8Array(count), wallPaint: new Uint8Array(count), frameX, frameY,
      },
    };
    const { renderer, pixels } = setup(width, height, { mapPalette: signPalette });
    renderer.setWorld(world);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    const actual = pixels();
    expect(actual).toEqual(cpuReference(world, { background: true, walls: true, blocks: true, liquids: true }, signPalette));
    // Each frame value selected its own option: row 0 (frameX) and row 1 (frameY) both show all five colours.
    for (const row of [0, 1]) {
      const reds = new Set<number>();
      for (let x = 0; x < values.length; x++) reds.add(actual[(row * width + x * (row === 0 ? 1 : values.length)) * 4 + row] ?? 0);
      expect(reds.size).toBe(values.length);
    }
  });

  test("every vanilla rule of the shipped palette, at frames around each range boundary, matches mapOption", () => {
    const rules = Object.entries(terrariaMapPalette.tileOptions ?? {});
    const int16 = (value: number): number => Math.max(-32768, Math.min(32767, value));
    const tiles: { id: number; frameX: number; frameY: number }[] = [];
    for (const [id, rule] of rules) {
      const frames = new Set([0, -1, 1]);
      for (const [from, to] of rule.ranges) for (const frame of [from - 1, from, to, to + 1]) frames.add(int16(frame));
      for (const frame of frames) {
        // The other axis gets an unrelated frame: it must not influence the option.
        const other = 18 * (tiles.length % 5);
        tiles.push({ id: Number(id), frameX: rule.axis === "frameX" ? frame : other, frameY: rule.axis === "frameY" ? frame : other });
      }
    }
    const ids = [...new Set(tiles.map((tile) => tile.id))];
    const height = 64;
    const width = Math.ceil(tiles.length / height);
    const count = width * height;
    const block = new Uint16Array(count).fill(0xffff);
    const frameX = new Int16Array(count);
    const frameY = new Int16Array(count);
    tiles.forEach((tile, index) => {
      block[index] = ids.indexOf(tile.id);
      frameX[index] = tile.frameX;
      frameY[index] = tile.frameY;
    });
    const world: RenderableWorld = {
      width, height, surfaceY: 0, palette: ids.map((id) => ({ kind: "vanilla", id }) as const),
      planes: {
        block, wall: new Uint16Array(count).fill(0xffff), liquid: new Uint8Array(count), liquidAmount: new Uint8Array(count),
        paint: new Uint8Array(count), wallPaint: new Uint8Array(count), frameX, frameY,
      },
    };
    expect(tiles.length).toBeGreaterThan(500);
    const layers = { background: false, walls: false, blocks: true, liquids: false };
    const { renderer, pixels } = setup(width, height, { mapPalette: terrariaMapPalette });
    renderer.setWorld(world);
    renderer.setLayers(layers);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect(pixels()).toEqual(cpuReference(world, layers, terrariaMapPalette));
  });
});

describe("map option rules across the renderer's lifecycle", () => {
  const layers = allLayers;

  /** Asserts the canvas equals the CPU reference of `world`, with no GL error. */
  function expectReference(gl: WebGL2RenderingContext, pixels: () => Uint8Array, world: RenderableWorld): void {
    expect(gl.getError()).toBe(gl.NO_ERROR);
    const wrong = differing(pixels(), cpuReference(world, layers, syntheticMapPalette), world.width);
    expect(wrong.slice(0, 5), `${String(wrong.length)} pixels differ`).toEqual([]);
  }

  test("a renderer created on the canvas of a disposed one draws ruled content exactly", { tags: ["perf"] }, () => {
    const first = setup(300, 200, { mapPalette: syntheticMapPalette });
    first.renderer.setWorld(fullWorld(300, 200));
    first.renderer.setLayers(layers);
    first.renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    first.renderer.render();
    first.renderer.dispose();
    // The canvas keeps its GL context: dispose leaves it with GL's default unpack state.
    const { gl } = first;
    expect([
      gl.UNPACK_ALIGNMENT, gl.UNPACK_ROW_LENGTH, gl.UNPACK_IMAGE_HEIGHT, gl.UNPACK_SKIP_PIXELS, gl.UNPACK_SKIP_ROWS,
      gl.UNPACK_SKIP_IMAGES,
    ].map((name) => gl.getParameter(name) as number)).toEqual([4, 0, 0, 0, 0, 0]);
    const world = offsetViews(fullWorld(300, 200));
    const second = setup(300, 200, { mapPalette: syntheticMapPalette }, first.canvas);
    second.renderer.setWorld(world);
    second.renderer.setLayers(layers);
    second.renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    second.renderer.render();
    expectReference(second.gl, second.pixels, world);
  });

  test("a lost and restored context draws ruled content exactly", async () => {
    const world = fullWorld(300, 200);
    const { renderer, canvas, gl, pixels } = setup(300, 200, { mapPalette: syntheticMapPalette });
    renderer.setWorld(world);
    renderer.setLayers(layers);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose === null) throw new Error("WEBGL_lose_context unavailable");
    const restored = new Promise<void>((resolve) => {
      canvas.addEventListener("webglcontextrestored", () => { resolve(); });
    });
    lose.loseContext();
    lose.restoreContext();
    await restored;
    renderer.render();
    expectReference(gl, pixels, world);
  });

  test("palette entries with rules appended after the first upload are drawn by their rules", () => {
    const world = fullWorld(300, 200);
    const growing: RenderableWorld = { ...world, palette: world.palette.slice(0, 2) };
    const { renderer, gl, pixels } = setup(300, 200, { mapPalette: syntheticMapPalette });
    renderer.setWorld(growing);
    renderer.setLayers(layers);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    // Vanilla tile 3 has a frameY rule in the synthetic palette.
    (growing.palette as unknown[]).push(...world.palette.slice(2));
    renderer.setWorld(growing);
    renderer.render();
    expectReference(gl, pixels, world);
  });

  test("switching to a shorter palette of unknown and mod content leaves no rule of the previous world behind", () => {
    const { renderer, gl, pixels } = setup(300, 200, { mapPalette: syntheticMapPalette });
    renderer.setWorld(fullWorld(300, 200));
    renderer.setLayers(layers);
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    // Index 1 was vanilla tile 1 (ruled by frameX); now it is mod content, and indices 2 and 3 are past the palette.
    const next: RenderableWorld = {
      ...fullWorld(300, 200),
      palette: [
        { kind: "unknown", runtimeId: 400 },
        { kind: "mod", mod: "Calamity", internalName: "AstralDirt", runtimeId: 900, modVersion: "2.0.4" },
      ],
    };
    renderer.setWorld(next);
    renderer.render();
    expectReference(gl, pixels, next);
  });
});

describe("GPU limits", () => {
  const SAMPLERS = new Set<number>([
    WebGL2RenderingContext.SAMPLER_2D, WebGL2RenderingContext.SAMPLER_2D_ARRAY, WebGL2RenderingContext.INT_SAMPLER_2D,
    WebGL2RenderingContext.INT_SAMPLER_2D_ARRAY, WebGL2RenderingContext.UNSIGNED_INT_SAMPLER_2D,
    WebGL2RenderingContext.UNSIGNED_INT_SAMPLER_2D_ARRAY,
  ]);
  const ARRAYS = new Set<number>([
    WebGL2RenderingContext.SAMPLER_2D_ARRAY, WebGL2RenderingContext.INT_SAMPLER_2D_ARRAY,
    WebGL2RenderingContext.UNSIGNED_INT_SAMPLER_2D_ARRAY,
  ]);

  test("the map passes bind at most 10 texture units, at most 2 of them for chunk pages", () => {
    const programs = new Set<WebGLProgram>();
    const proto = WebGL2RenderingContext.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the real receiver below
    const useProgram = proto.useProgram;
    vi.spyOn(proto, "useProgram").mockImplementation(function (this: WebGL2RenderingContext, program) {
      if (program !== null) programs.add(program);
      useProgram.call(this, program);
    });
    const world = fullWorld(300, 200);
    const { renderer, gl } = setup(300, 200, { mapPalette: syntheticMapPalette });
    renderer.setWorld(world);
    renderer.setLayers(allLayers);
    // Zoomed out (overview build and display), then at one pixel per tile with the overview under loading chunks.
    renderer.setCamera(fitWorld({ width: 300, height: 200 }, { width: 3000, height: 2000 }));
    renderer.render();
    renderer.setCamera({ x: 0, y: 0, zoom: 1 });
    renderer.render();
    expect(programs.size).toBe(3);
    const units = new Set<number>();
    const pageUnits = new Set<number>();
    for (const program of programs) {
      const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS) as number;
      for (let index = 0; index < count; index++) {
        const info = gl.getActiveUniform(program, index);
        if (info === null || !SAMPLERS.has(info.type)) continue;
        const location = gl.getUniformLocation(program, info.name);
        if (location === null) throw new Error(`no location for ${info.name}`);
        const unit = gl.getUniform(program, location) as number;
        units.add(unit);
        // The sprite atlas (uAtlas) is an array texture too, but not a chunk page.
        if (ARRAYS.has(info.type) && info.name !== "uAtlas") pageUnits.add(unit);
      }
    }
    expect(units.size).toBeLessThanOrEqual(10);
    expect(pageUnits.size).toBeLessThanOrEqual(2);
  });

  test.each([
    ["texture units", "MAX_TEXTURE_IMAGE_UNITS", 4, /texture units/],
    ["array texture layers", "MAX_ARRAY_TEXTURE_LAYERS", 64, /array texture layers/],
  ] as const)("creation fails with a clear error when the GPU offers too few %s", (_name, parameter, offered, message) => {
    const proto = WebGL2RenderingContext.prototype;
    // eslint-disable-next-line @typescript-eslint/unbound-method -- called with the real receiver below
    const getParameter = proto.getParameter;
    vi.spyOn(proto, "getParameter").mockImplementation(function (this: WebGL2RenderingContext, name: number) {
      return name === this[parameter] ? offered : getParameter.call(this, name) as unknown;
    });
    expect(() => setup(16, 16)).toThrow(message);
  });
});

describe("cost of a layer toggle", () => {
  /** Texels per side of a page layer: a chunk and its apron. */
  const PAGE = CHUNK_SIZE + 2;

  /**
   * Main's chunk preparation before #203, kept as the baseline: it read every plane of the chunk and its apron (the
   * frame planes only for blocks with a map option rule), interleaved them into RGBA staging arrays and resolved each
   * ruled block's option per tile. Columns [x0, x1) and rows [y0, y1) are world tiles. Returns the elements it read.
   */
  function mainPreparation(
    world: RenderableWorld, rules: readonly (MapOptionRule | undefined)[], x0: number, x1: number, y0: number, y1: number,
    wide: Uint16Array, narrow: Uint8Array,
  ): number {
    const { block, wall, flags, frameX, frameY, liquid, liquidAmount, paint, wallPaint } = world.planes;
    let reads = 0;
    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        const index = x * world.height + y;
        const texel = ((x - x0) * PAGE + (y - y0)) * 4;
        const id = block[index] ?? 0xffff;
        wide[texel] = id;
        wide[texel + 1] = wall[index] ?? 0xffff;
        const rule = rules[id];
        wide[texel + 2] = rule === undefined ? 0 : mapOption(rule, frameX?.[index] ?? 0, frameY?.[index] ?? 0);
        wide[texel + 3] = (flags?.[index] ?? 0) & 31;
        narrow[texel] = liquid[index] ?? 0;
        narrow[texel + 1] = liquidAmount[index] ?? 0;
        narrow[texel + 2] = paint[index] ?? 0;
        narrow[texel + 3] = wallPaint[index] ?? 0;
        reads += rule === undefined ? 7 : 9;
      }
    }
    return reads;
  }

  /**
   * A machine-independent cost model, charged to a fake `performance.now` instead of wall time. A texSubImage3D call
   * costs a fixed overhead plus its bytes (from PR #201: main's two calls for all 4,000 chunks of a 16000 × 4000
   * world took about 0.1 s together, 25 µs per chunk of about 200 KB); JavaScript costs `perRead` per plane element
   * read. Draws come after a frame's uploads and are charged in neither run.
   */
  const CALL_OVERHEAD = 0.004;
  const PER_BYTE = (0.025 - 2 * CALL_OVERHEAD) / (PAGE * PAGE * 12);

  /**
   * Frames a layer toggle takes at Fit world under the default budget, from the same scheduler, sweep and budget.
   * `current`: this renderer, its planes wrapped so that every element it reads is charged. `main`: each chunk upload
   * is charged as main's was instead (its preparation, by the elements it reads, and its two interleaved uploads);
   * the renderer's own nine uploads are then free. Nothing is sent to the GPU.
   */
  function toggleFrames(world: RenderableWorld, mode: "current" | "main", perRead: number, rules: readonly (MapOptionRule | undefined)[]): number {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    let nextId = 1;
    const pending = new Map<number, FrameRequestCallback>();
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      pending.set(nextId, callback);
      return nextId++;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => { pending.delete(id); });
    const charged = <T extends object>(plane: T): T => new Proxy(plane, {
      get: (target, property) => {
        if (typeof property === "string" && /^\d+$/.test(property)) now += perRead;
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      },
    });
    const planes = Object.fromEntries(Object.entries(world.planes).map(([name, plane]) => [name, charged(plane)]));
    const watched: RenderableWorld = { ...world, planes: planes as unknown as RenderableWorld["planes"] };
    const viewport = { width: 1600, height: 400 };
    const { renderer, gl } = setup(viewport.width, viewport.height, { mapPalette: terrariaMapPalette });
    const unpack = new Map<number, number>();
    vi.spyOn(gl, "pixelStorei").mockImplementation((name, value) => { unpack.set(name, Number(value)); });
    const wide = new Uint16Array(PAGE * PAGE * 4);
    const narrow = new Uint8Array(PAGE * PAGE * 4);
    vi.spyOn(gl, "texSubImage3D").mockImplementation((...args: unknown[]) => {
      const [, , , , , width, height, , format, type] = args as number[];
      const texels = (width ?? 0) * (height ?? 0);
      if (mode === "current") {
        now += CALL_OVERHEAD + texels * (type === gl.UNSIGNED_SHORT ? 2 : 1) * PER_BYTE;
        return;
      }
      // Main: one charge per chunk, at the block plane's upload (16-bit, layer slot * LAYERS_16 + 0).
      if (format !== gl.RED_INTEGER || type !== gl.UNSIGNED_SHORT || (args[4] as number) % LAYERS_16 !== 0) return;
      const y0 = unpack.get(gl.UNPACK_SKIP_PIXELS) ?? 0;
      const x0 = unpack.get(gl.UNPACK_SKIP_ROWS) ?? 0;
      const reads = mainPreparation(world, rules, x0, x0 + (height ?? 0), y0, y0 + (width ?? 0), wide, narrow);
      // Main uploaded whole layer rows: PAGE texels by the chunk's columns, 8 + 4 bytes each, in two calls.
      now += 2 * CALL_OVERHEAD + PAGE * (height ?? 0) * 12 * PER_BYTE + reads * perRead;
    });
    // Only frames are counted: the overview build's draws and mipmaps are skipped to keep the test fast.
    vi.spyOn(gl, "drawArraysInstanced").mockImplementation(() => undefined);
    vi.spyOn(gl, "generateMipmap").mockImplementation(() => undefined);
    renderer.setWorld(mode === "current" ? watched : world);
    renderer.setCamera(fitWorld(viewport, world));
    renderer.render();
    renderer.setLayers({ background: true, walls: false, blocks: true, liquids: true });
    let frames = 0;
    for (; pending.size > 0 && frames < 1000; frames++) {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback(0);
    }
    expect(pending.size).toBe(0);
    renderer.dispose();
    vi.restoreAllMocks();
    return frames;
  }

  test("a 16000 × 4000 world at Fit world takes at most a third of the frames of main's chunk preparation", { tags: ["perf"], timeout: 120_000 }, () => {
    // Plane contents only matter to main's preparation: alternate rows of plain and ruled blocks (a chest, tile 21),
    // over planes sharing one buffer.
    const width = 16000;
    const height = 4000;
    const count = width * height;
    const buffer = new ArrayBuffer(count * 2);
    const sixteen = new Uint16Array(buffer);
    for (let index = 1; index < count; index += 2) sixteen[index] = 1;
    const eight = new Uint8Array(buffer, 0, count);
    const world: RenderableWorld = {
      width, height, surfaceY: 1000, palette: [{ kind: "vanilla", id: 0 }, { kind: "vanilla", id: 21 }],
      planes: {
        block: sixteen, wall: sixteen, flags: sixteen, frameX: new Int16Array(buffer), frameY: new Int16Array(buffer),
        liquid: eight, liquidAmount: eight, paint: eight, wallPaint: eight,
      },
    };
    const rules = world.palette.map((ref) => (ref.kind === "vanilla" ? terrariaMapPalette.tileOptions?.[ref.id] : undefined));
    expect(rules[1]).toBeDefined();
    // Calibration: main prepared a full chunk of frame-selected content in about 0.26 ms (PR #201).
    const fullChunkReads = mainPreparation(world, rules, 1000, 1000 + PAGE, 1000, 1000 + PAGE, new Uint16Array(PAGE * PAGE * 4), new Uint8Array(PAGE * PAGE * 4));
    const perRead = 0.26 / fullChunkReads;
    const current = toggleFrames(world, "current", perRead, rules);
    const main = toggleFrames(world, "main", perRead, rules);
    // Main's measured toggle on such a world was about 139 frames.
    expect(main).toBeGreaterThan(100);
    expect(main).toBeLessThan(170);
    expect(current * 3).toBeLessThanOrEqual(main);
  });
});
