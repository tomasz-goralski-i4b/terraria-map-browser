import { buildMetadata, wrapMetadata } from "../../../../packages/world-codec/dist/metadata-fixture.js";

/** Uses the codec's existing synthetic metadata fixture with independently specified tile bytes. */
export function writerSource(width = 2, height = 4, tiles = [0x40, 3, 0x40, 3], version = 326): Uint8Array<ArrayBuffer> {
  const layout = version < 315 ? "1.4.4" : version < 325 ? "1.4.5" : "1.4.5-lightning";
  const metadata = buildMetadata({ width, height, layout }).bytes;
  const wrapped = wrapMetadata(metadata, tiles.length, version);
  const bytes = new Uint8Array(wrapped.length + 5);
  bytes.set(wrapped);
  const view = new DataView(bytes.buffer);
  bytes.set(tiles, view.getInt32(30, true));
  const footer = view.getInt32(66, true);
  bytes.set([1, 5, 0x53, 0x43, 0x43, 0x52, 0x31], footer);
  view.setInt32(footer + 7, 1743427911, true);
  return bytes;
}
