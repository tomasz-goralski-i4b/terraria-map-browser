import { createBlockFraming, loadFramingDatabase, terrariaFramingData } from "@studio/renderer";
import type { BlockFraming } from "@studio/renderer";

let framing: Promise<BlockFraming> | null = null;

/**
 * The block framing of the shipped framing database (docs/assets.md, "The framing database"), inflated once on first
 * use: sprite mode draws self-framed blocks with the cells it gives them.
 */
export function getBlockFraming(): Promise<BlockFraming> {
  framing ??= loadFramingDatabase(terrariaFramingData).then(createBlockFraming);
  return framing;
}
