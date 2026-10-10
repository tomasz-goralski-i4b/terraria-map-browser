import { readWorldHeader } from "@studio/world-codec";
import { writerSource } from "./export-source.js";

/** Empty readable entity lists, unlike writerSource's deliberately opaque later sections. */
export function brushSource(width = 2, height = 4, tiles?: number[], version = 326): Uint8Array<ArrayBuffer> {
  const source = writerSource(width, height, tiles, version);
  const { sections } = readWorldHeader(source);
  const sizes = [version < 315 ? 4 : 2, 2, 2, 4, 4, 4, 12, 2];
  const footer = source.subarray(sections.footer.start);
  const output = new Uint8Array(sections.chests.start + sizes.reduce((sum, length) => sum + length, 0) + footer.length);
  output.set(source.subarray(0, sections.chests.start));
  const view = new DataView(output.buffer);
  let offset = sections.chests.start;
  sizes.forEach((length, index) => {
    view.setInt32(26 + (index + 2) * 4, offset, true);
    offset += length;
  });
  view.setInt32(66, offset, true);
  output.set(footer, offset);
  return output;
}
