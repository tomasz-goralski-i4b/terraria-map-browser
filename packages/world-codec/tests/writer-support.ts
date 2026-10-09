import { readWorldTiles, type WorldTilesResult } from "../src/index.js";
import { buildMetadata, wrapMetadata } from "../src/metadata-fixture.js";

/** Independent empty-column records, split at the contract's maximum run. */
export function emptyColumns(width: number, height: number): number[] {
  const bytes: number[] = [];
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height;) {
      const run = Math.min(height - y - 1, 32767);
      bytes.push(...(run === 0 ? [0] : run <= 255 ? [0x40, run] : [0x80, run & 255, run >> 8]));
      y += run + 1;
    }
  }
  return bytes;
}

/** Complete synthetic source with a valid name/id footer; no production encoding helpers. */
export function writerSource(width = 2, height = 4, tiles = emptyColumns(width, height), version = 326): Uint8Array<ArrayBuffer> {
  // Released layouts are selected independently of the production profile registry.
  const layout = version < 315 ? "1.4.4" : version < 325 ? "1.4.5" : "1.4.5-lightning";
  const metadata = buildMetadata({ width, height, layout }).bytes;
  const wrapped = wrapMetadata(metadata, tiles.length, version);
  const bytes = new Uint8Array(wrapped.length + 5);
  bytes.set(wrapped);
  const view = new DataView(bytes.buffer);
  bytes.set(tiles, view.getInt32(30, true));
  // The two RLE exclusions are explicitly framed in the synthetic header.
  bytes[72 + (423 >> 3)] = 1 << (423 & 7);
  bytes[72 + (520 >> 3)] = 1 << (520 & 7);
  const footer = view.getInt32(66, true);
  bytes.set([1, 5, 0x53, 0x43, 0x43, 0x52, 0x31], footer);
  view.setInt32(footer + 7, 1743427911, true);
  return bytes;
}

export function writerWorld(width = 2, height = 4): WorldTilesResult {
  return readWorldTiles(writerSource(width, height));
}
