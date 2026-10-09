// Temporary benchmark on the real GPU (scratchpad vitest.gpu-bench.config.ts). Not committed.
import { afterEach, beforeAll, test } from "vitest";
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
  { kind: "tile", id: 21, page: 0, x: 600, y: 0, width: 400, height: 280, frameWidth: 16, frameHeight: 16 },
  { kind: "wall", id: 1, page: 0, x: 0, y: 300, width: 468, height: 216, frameWidth: 32, frameHeight: 32 },
  { kind: "wall", id: 2, page: 0, x: 500, y: 300, width: 468, height: 216, frameWidth: 32, frameHeight: 32 },
];

function atlas(): SpriteAtlasSource {
  const page = new Uint8Array(PAGE * PAGE * 4);
  for (let i = 0; i < page.length; i += 4) page.set([(i >> 2) % 251, (i >> 3) % 241, (i >> 4) % 239, (i >> 2) % 7 === 0 ? 0 : 255], i);
  return { pages: [page], index: { pageSize: PAGE, entries: SHEETS } };
}

function terrain(): CanonicalWorld {
  const world = createWorld(1200, 800);
  world.setTile(0, 0, { block: { kind: "vanilla", id: 0 }, wall: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  world.setTile(1, 0, { block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 2 }, wires: 0, actuator: false });
  world.setTile(2, 0, { block: { kind: "vanilla", id: 21 }, wires: 0, actuator: false });
  const { block, wall, frameX, frameY } = world.planes;
  for (let x = 0; x < world.width; x++) {
    for (let y = 0; y < world.height; y++) {
      const i = x * world.height + y;
      const hash = Math.imul(x, 73856093) ^ Math.imul(y, 19349663);
      // Sky above 400, then walls with blocks and some framed chests.
      wall[i] = y < 420 ? 0xffff : (hash >>> 5) % 2;
      block[i] = y < 460 || (hash >>> 3) % 5 === 0 ? 0xffff : (hash >>> 7) % 2;
      if (y >= 460 && (hash >>> 9) % 11 === 0) {
        block[i] = 2;
        frameX[i] = ((x % 2) * 18) + 36 * ((hash >>> 12) % 8);
        frameY[i] = (y % 2) * 18;
      }
    }
  }
  return world;
}

function frameTime(renderer: MapRenderer, gl: WebGL2RenderingContext, frames = 15): number {
  const pixel = new Uint8Array(4);
  for (let k = 0; k < 3; k++) {
    renderer.render();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
  }
  const times: number[] = [];
  for (let k = 0; k < frames; k++) {
    const start = performance.now();
    renderer.render();
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    times.push(performance.now() - start);
  }
  return times.sort((a, b) => a - b)[Math.floor(frames / 2)] ?? 0;
}

test("frames while linking", { timeout: 600_000 }, async () => {
  const world = terrain();
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const renderer = createMapRenderer(canvas);
  created.push(renderer);
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("no webgl2 context");
  console.log("parallel compile", gl.getExtension("KHR_parallel_shader_compile") !== null);
  renderer.setWorld({ width: world.width, height: world.height, surfaceY: 400, planes: world.planes, palette: world.palette });
  renderer.setFraming(framing);
  renderer.setSpriteMode(true);
  renderer.setCamera({ x: 100, y: 480, zoom: 5 });
  const t0 = performance.now();
  renderer.setAtlas(atlas());
  let last = performance.now();
  let worst = 0;
  let frames = 0;
  const pixel = new Uint8Array(4);
  // Until a frame's centre pixel changes from the map colour frame (sprites drawn), at most 20 s.
  let first: string | null = null;
  while (performance.now() - t0 < 20_000) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const now = performance.now();
    worst = Math.max(worst, now - last);
    last = now;
    frames++;
    void pixel;
    first ??= "";
    if (renderer.stats().framedTiles > 0) break;
  }
  console.log(`sprites after ${(performance.now() - t0).toFixed(0)} ms, ${String(frames)} frames, worst gap ${worst.toFixed(0)} ms`);
});

test("gpu cost", { timeout: 600_000 }, () => {
  const world = terrain();
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const renderer = createMapRenderer(canvas);
  created.push(renderer);
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("no webgl2 context");
  const lines: string[] = [];
  let start = performance.now();
  const lap = (label: string): void => {
    gl.finish();
    lines.push(`${label} ${(performance.now() - start).toFixed(0)} ms`);
    start = performance.now();
  };
  renderer.setWorld({ width: world.width, height: world.height, surfaceY: 400, planes: world.planes, palette: world.palette });
  lap("setWorld");
  const source = atlas();
  lap("atlas()");
  renderer.setAtlas(source);
  lap("setAtlas");
  renderer.setFraming(framing);
  renderer.setSpriteMode(true);
  lap("framing+mode");
  renderer.setCamera({ x: 100, y: 480, zoom: 5 });
  renderer.render();
  lap("first render");
  for (const [label, y] of [["underground", 480], ["sky", 0]] as const) {
    for (const zoom of [5, 6, 8, 12, 16]) {
      renderer.setCamera({ x: 100, y, zoom });
      // Upload everything first (several frames: the upload budget).
      for (let k = 0; k < 60; k++) renderer.render();
      renderer.setLayers({ background: true, walls: false, blocks: true, liquids: true });
      const without = frameTime(renderer, gl);
      renderer.setLayers({ background: true, walls: true, blocks: true, liquids: true });
      const withWalls = frameTime(renderer, gl);
      lines.push(`${label} zoom ${String(zoom)}: blocks ${without.toFixed(2)} ms, +walls ${withWalls.toFixed(2)} ms`);
    }
  }
  // CPU: framing walls of fresh chunks.
  const fresh = createMapRenderer(document.createElement("canvas"));
  created.push(fresh);
  const t0 = performance.now();
  const walls = framing.walls;
  let sink = 0;
  for (let x = 0; x < 512; x++) for (let y = 420; y < 800; y++) sink += walls.cellAt(world, x, y);
  lines.push(`cellAt over ${String(512 * 380)} tiles: ${(performance.now() - t0).toFixed(1)} ms (${String(sink % 7)})`);
  const out = new Uint16Array(130 * 130);
  const t1 = performance.now();
  for (let k = 0; k < 12; k++) walls.frameRegion(world, { left: k * 130, top: 420, width: 130, height: 130 }, out);
  lines.push(`frameRegion 12 chunks: ${(performance.now() - t1).toFixed(1)} ms`);
  console.log(lines.join("\n"));
});
