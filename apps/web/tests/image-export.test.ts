import { inflateSync } from "node:zlib";
import { expect, test } from "vitest";
import { createWorld } from "@studio/world-model";
import { renderChunk, terrariaMapPalette, CHUNK_SIZE, type ChunkRenderOptions } from "@studio/renderer";
import { encodeMapImage, imageExportProblem, imageBands, MAX_JXL_PIXELS } from "../src/world/image-export.js";

const LAYERS = { background: true, walls: true, blocks: true, liquids: true, wires: 31, paint: true };
const options = (layers = LAYERS): ChunkRenderOptions => ({ surfaceY: 40, rockY: 90, layers, mapPalette: terrariaMapPalette });

/** A world with blocks, walls and wires on both sides of the chunk boundary at x = 128. */
function world() {
  const result = createWorld(300, 160);
  for (let y = 30; y < 60; y++) {
    for (let x = 110; x < 150; x++) {
      result.setTile(x, y, {
        ...((x + y) % 3 === 0 ? {} : { block: { kind: "vanilla", id: (x * 7 + y) % 2 === 0 ? 1 : 0 } }),
        wall: { kind: "vanilla", id: 2 }, wires: x % 5 === 0 ? 1 : 0, actuator: false,
      });
    }
  }
  return result;
}

/** Straight RGBA of an 8-bit RGBA PNG with filter 0 rows (what the encoder writes). */
async function decodePng(blob: Blob): Promise<{ width: number; height: number; pixels: Uint8Array }> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  let width = 0, height = 0;
  const data: Uint8Array[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const body = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = view.getUint32(offset + 8);
      height = view.getUint32(offset + 12);
      expect([...body.subarray(8)]).toEqual([8, 6, 0, 0, 0]);
    }
    if (type === "IDAT") data.push(body);
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(data));
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    expect(raw[y * (width * 4 + 1)]).toBe(0);
    pixels.set(raw.subarray(y * (width * 4 + 1) + 1, (y + 1) * (width * 4 + 1)), y * width * 4);
  }
  return { width, height, pixels };
}

/** The CPU reference renderer's pixels of an area (chunks rendered whole, then cropped). */
function reference(source: ReturnType<typeof world>, area: { x: number; y: number; width: number; height: number }, layers = LAYERS): Uint8Array {
  const out = new Uint8Array(area.width * area.height * 4);
  for (let y = 0; y < area.height; y++) {
    for (let x = 0; x < area.width; x++) {
      const tileX = area.x + x, tileY = area.y + y;
      const chunk = renderChunk(source, Math.floor(tileX / CHUNK_SIZE), Math.floor(tileY / CHUNK_SIZE), options(layers));
      const at = ((tileY % CHUNK_SIZE) * chunk.width + tileX % CHUNK_SIZE) * 4;
      out.set(chunk.pixels.subarray(at, at + 4), (y * area.width + x) * 4);
    }
  }
  return out;
}

test("a 10 × 10 selection across a chunk boundary at 1 px per tile is a 10 × 10 PNG of the reference renderer's pixels", async () => {
  const source = world();
  const area = { x: 123, y: 35, width: 10, height: 10 };
  const png = await decodePng(await encodeMapImage("png", area.width, area.height, imageBands(source, area, 1, options())));
  expect(png.width).toBe(10);
  expect(png.height).toBe(10);
  expect(png.pixels).toEqual(reference(source, area));
});

test("hidden layers are absent from the export", async () => {
  const source = world();
  const area = { x: 105, y: 25, width: 50, height: 40 };
  const hidden = { ...LAYERS, blocks: false, wires: 0 };
  const png = await decodePng(await encodeMapImage("png", area.width, area.height, imageBands(source, area, 1, options(hidden))));
  expect(png.pixels).toEqual(reference(source, area, hidden));
  expect(png.pixels).not.toEqual(reference(source, area));
});

test("a scale draws every tile as a square of that many pixels, band after band", async () => {
  const source = world();
  const area = { x: 120, y: 120, width: 12, height: 20 };
  const one = reference(source, area);
  const bands = [...imageBands(source, area, 3, options(), 7)];
  expect(bands.map((band) => band.rows)).toEqual([21, 21, 18]);
  const png = await decodePng(await encodeMapImage("png", 36, 60, bands));
  for (const [x, y] of [[0, 0], [35, 59], [17, 31]] as const) {
    const tile = (Math.floor(y / 3) * area.width + Math.floor(x / 3)) * 4;
    expect([...png.pixels.subarray((y * 36 + x) * 4, (y * 36 + x) * 4 + 4)]).toEqual([...one.subarray(tile, tile + 4)]);
  }
});

test("an export says why it cannot run: no area, scale out of range, or too large for JPEG XL", () => {
  expect(imageExportProblem({ x: 0, y: 0, width: 0, height: 5 }, 1, "png")).toBe("The area is empty");
  expect(imageExportProblem({ x: 0, y: 0, width: 10, height: 10 }, 17, "png")).toBe("Choose 1 to 16 pixels per block");
  expect(imageExportProblem({ x: 0, y: 0, width: 8400, height: 2400 }, 16, "png")).toBeNull();
  const side = Math.ceil(Math.sqrt(MAX_JXL_PIXELS));
  expect(imageExportProblem({ x: 0, y: 0, width: side, height: side }, 1, "jxl")).toMatch(/too large for JPEG XL/);
});
