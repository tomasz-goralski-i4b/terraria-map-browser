import { afterEach, beforeAll, describe, expect, test } from "vitest";
import { createWorld, type CanonicalWorld } from "@studio/world-model";
import { createBlockFraming, createMapRenderer, loadFramingDatabase, terrariaFramingData } from "../src/index.js";
import type { BlockFraming, MapRenderer, SpriteAtlasSource, SpriteSheetEntry } from "../src/index.js";

let framing: BlockFraming;
beforeAll(async () => {
  framing = createBlockFraming(await loadFramingDatabase(terrariaFramingData));
});

const created: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of created.splice(0)) renderer.dispose();
});

const PAGE = 1024;
const SHEETS: readonly SpriteSheetEntry[] = [
  { kind: "tile", id: 0, page: 0, x: 0, y: 0, width: 288, height: 270, frameWidth: 16, frameHeight: 16 },
  { kind: "tile", id: 1, page: 0, x: 300, y: 0, width: 288, height: 270, frameWidth: 16, frameHeight: 16 },
  { kind: "wall", id: 1, page: 0, x: 0, y: 300, width: 468, height: 216, frameWidth: 32, frameHeight: 32 },
  { kind: "wall", id: 2, page: 0, x: 500, y: 300, width: 468, height: 216, frameWidth: 32, frameHeight: 32 },
];

/** Every page pixel distinct-ish, one in seven transparent, so block sprites leave the walls behind them visible. */
function atlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  for (let i = 0; i < page.length; i += 4) page.set([(i >> 2) % 251, (i >> 3) % 241, (i >> 4) % 239, (i >> 2) % 7 === 0 ? 0 : 255], i);
  return { pages: [page], index: { pageSize: PAGE, entries: SHEETS } };
}

/** Walls under the surface, then dirt and stone with gaps over them: what an underground view shows. */
function terrain(): CanonicalWorld {
  const world = createWorld(600, 300);
  world.setTile(0, 0, { block: { kind: "vanilla", id: 0 }, wall: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  world.setTile(1, 0, { block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 2 }, wires: 0, actuator: false });
  const { block, wall } = world.planes;
  for (let x = 0; x < world.width; x++) {
    for (let y = 0; y < world.height; y++) {
      const i = x * world.height + y;
      const hash = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
      wall[i] = y < 20 ? 0xffff : (hash >>> 5) % 2;
      block[i] = y < 60 || (hash >>> 3) % 5 === 0 ? 0xffff : (hash >>> 7) % 2;
    }
  }
  return world;
}

/** The median time of `frames` synchronous frames, each waited for on the GPU (a 1-pixel read-back). */
function frameTime(renderer: MapRenderer, gl: WebGL2RenderingContext, frames = 5): number {
  const pixel = new Uint8Array(4);
  renderer.render();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  const times: number[] = [];
  for (let k = 0; k < frames; k++) {
    const start = performance.now();
    renderer.render();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[Math.floor(frames / 2)] ?? 0;
}

describe("cost of walls in sprite mode", () => {
  // The wall layer reads up to four walls per sprite sample, sixteen samples at 5 pixels per tile. Its first version
  // indexed an array of the nine walls around a tile by a computed index and composited in integers: about 9 times the
  // frame time without walls here in software GL (about 3 now), and 10–25 times on an Intel Arc GPU (D3D11). Relative
  // to the same frames without walls, so the bound does not depend on the machine; generous, so a busy one passes.
  test.each([[5, 5]])(
    "at %s pixels per tile, sprite frames with walls take at most %s times those without",
    { tags: ["perf"], timeout: 120_000 },
    (zoom, bound) => {
      const world = terrain();
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 270;
      const renderer = createMapRenderer(canvas);
      created.push(renderer);
      const gl = canvas.getContext("webgl2");
      if (gl === null) throw new Error("no webgl2 context");
      renderer.setWorld({ width: world.width, height: world.height, surfaceY: 20, planes: world.planes, palette: world.palette });
      renderer.setAtlas(atlas());
      renderer.setFraming(framing);
      renderer.setSpriteMode(true);
      renderer.setCamera({ x: 50, y: 40, zoom });
      renderer.setLayers({ background: true, walls: false, blocks: true, liquids: true });
      const without = frameTime(renderer, gl);
      renderer.setLayers({ background: true, walls: true, blocks: true, liquids: true });
      const withWalls = frameTime(renderer, gl);
      expect(withWalls / without, `${withWalls.toFixed(1)} ms with walls, ${without.toFixed(1)} ms without`).toBeLessThanOrEqual(bound);
    },
  );
});
