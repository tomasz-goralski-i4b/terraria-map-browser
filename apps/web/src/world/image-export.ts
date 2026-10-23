import { CHUNK_SIZE, renderChunk, type ChunkRenderOptions } from "@studio/renderer";
import type { CanonicalWorld } from "@studio/world-model";
import type { Area } from "./area-clipboard.js";

/**
 * File ▸ Export ▸ Map Image: the map colours of an area (the CPU reference renderer's pixels), each tile drawn as a
 * square of `scale` pixels. The image is produced in bands of rows, so a PNG of any size streams through the
 * compressor with one band in memory; JPEG XL needs the whole image at once and is limited to `MAX_JXL_PIXELS`.
 */
export type ImageFormat = "png" | "jxl";

export const MAX_IMAGE_SCALE = 16;
/** The JPEG XL encoder (WASM) holds the image and its working copies in a 32-bit address space. */
export const MAX_JXL_PIXELS = 1 << 25;
/** Pixel bytes of one band; it sets how many tile rows a band has at the chosen width and scale. */
const BAND_BYTES = 32 << 20;

export interface ImageBand {
  /** Straight RGBA, `rows` rows of the image's full width. */
  readonly pixels: Uint8ClampedArray;
  readonly rows: number;
}

/** Why the export cannot run, short enough for a disabled reason; null when it can. */
export function imageExportProblem(area: Area, scale: number, format: ImageFormat): string | null {
  if (area.width <= 0 || area.height <= 0) return "The area is empty";
  if (!Number.isInteger(scale) || scale < 1 || scale > MAX_IMAGE_SCALE) return `Choose 1 to ${String(MAX_IMAGE_SCALE)} pixels per block`;
  if (format === "jxl" && area.width * scale * area.height * scale > MAX_JXL_PIXELS) {
    return "The image is too large for JPEG XL: use PNG or a smaller scale";
  }
  return null;
}

/** The image of `area` from the top, `bandTiles` tile rows per band (by default as many as fit `BAND_BYTES`). */
export function* imageBands(
  world: CanonicalWorld, area: Area, scale: number, options: ChunkRenderOptions, bandTiles = defaultBandTiles(area.width, scale),
): Generator<ImageBand> {
  const rowBytes = area.width * scale * 4;
  // Chunks of the chunk rows the current band touches; a band rarely starts on a chunk boundary.
  const chunks = new Map<string, Uint8ClampedArray>();
  const chunkPixels = (cx: number, cy: number): Uint8ClampedArray => {
    const key = `${String(cx)},${String(cy)}`;
    let pixels = chunks.get(key);
    if (pixels === undefined) {
      pixels = renderChunk(world, cx, cy, options).pixels;
      chunks.set(key, pixels);
    }
    return pixels;
  };
  for (let top = 0; top < area.height; top += bandTiles) {
    const tiles = Math.min(bandTiles, area.height - top);
    const firstChunkRow = Math.floor((area.y + top) / CHUNK_SIZE);
    for (const key of chunks.keys()) if (Number(key.split(",")[1]) < firstChunkRow) chunks.delete(key);
    const pixels = new Uint8ClampedArray(rowBytes * tiles * scale);
    for (let row = 0; row < tiles; row++) {
      const tileY = area.y + top + row;
      const cy = Math.floor(tileY / CHUNK_SIZE);
      const out = row * scale * rowBytes;
      for (let column = 0; column < area.width; column++) {
        const tileX = area.x + column;
        const cx = Math.floor(tileX / CHUNK_SIZE);
        const chunkWidth = Math.min(CHUNK_SIZE, world.width - cx * CHUNK_SIZE);
        const at = ((tileY - cy * CHUNK_SIZE) * chunkWidth + tileX - cx * CHUNK_SIZE) * 4;
        const color = chunkPixels(cx, cy).subarray(at, at + 4);
        for (let i = 0; i < scale; i++) pixels.set(color, out + (column * scale + i) * 4);
      }
      for (let i = 1; i < scale; i++) pixels.copyWithin(out + i * rowBytes, out, out + rowBytes);
    }
    yield { pixels, rows: tiles * scale };
  }
}

function defaultBandTiles(width: number, scale: number): number {
  return Math.max(1, Math.min(CHUNK_SIZE, Math.floor(BAND_BYTES / (width * scale * 4 * scale))));
}

/** Encodes the bands of a `width` × `height` image; `onRows` reports the rows done after each band. */
export async function encodeMapImage(
  format: ImageFormat, width: number, height: number, bands: Iterable<ImageBand>, onRows: (rows: number) => void = () => undefined,
): Promise<Blob> {
  return format === "png" ? encodePng(width, height, bands, onRows) : encodeJxl(width, height, bands, onRows);
}

async function encodeJxl(width: number, height: number, bands: Iterable<ImageBand>, onRows: (rows: number) => void): Promise<Blob> {
  const image = new ImageData(width, height);
  let rows = 0;
  for (const band of bands) {
    image.data.set(band.pixels, rows * width * 4);
    rows += band.rows;
    onRows(rows);
  }
  const { default: encode } = await import("@jsquash/jxl/encode");
  return new Blob([await encode(image, { lossless: true })], { type: "image/jxl" });
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function pngChunk(type: string, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const chunk = new Uint8Array(body.length + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(body, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < body.length + 8; i++) crc = (CRC_TABLE[(crc ^ (chunk[i] ?? 0)) & 0xff] ?? 0) ^ (crc >>> 8);
  view.setUint32(body.length + 8, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

/** 8-bit RGBA, rows unfiltered, the zlib stream from `CompressionStream("deflate")` split into IDAT chunks as it comes. */
async function encodePng(width: number, height: number, bands: Iterable<ImageBand>, onRows: (rows: number) => void): Promise<Blob> {
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8);
  const parts: Uint8Array<ArrayBuffer>[] = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk("IHDR", header)];
  const compressor = new CompressionStream("deflate");
  const writer = compressor.writable.getWriter();
  const reading = (async () => {
    const reader = compressor.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      parts.push(pngChunk("IDAT", value));
    }
  })();
  const rowBytes = width * 4;
  let rows = 0;
  for (const band of bands) {
    const filtered = new Uint8Array(band.rows * (rowBytes + 1));
    for (let y = 0; y < band.rows; y++) filtered.set(band.pixels.subarray(y * rowBytes, (y + 1) * rowBytes), y * (rowBytes + 1) + 1);
    await writer.write(filtered);
    rows += band.rows;
    onRows(rows);
  }
  await writer.close();
  await reading;
  parts.push(pngChunk("IEND", new Uint8Array(0)));
  return new Blob(parts, { type: "image/png" });
}
