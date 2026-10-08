import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readWorldTiles, resolveWorldFormat } from "@studio/world-codec";

const NO_CONTENT = 0xffff; // "absent" in the block and wall planes (docs/cwm.md)

// Opt-in: STUDIO_LOCAL_WORLDS points at a local directory of .wld files (docs/file-format/compatibility.md,
// "Local world check"). CI never sets it; the suite is then reported as skipped. Worlds are only read —
// nothing derived from them is written or committed.
const dir = process.env["STUDIO_LOCAL_WORLDS"];
const worlds = dir !== undefined && existsSync(dir)
  ? readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".wld")).sort()
  : [];

describe.skipIf(worlds.length === 0)("local worlds (STUDIO_LOCAL_WORLDS)", () => {
  it.each(worlds)("readWorldTiles_%s_DecodesEveryTileWithinItsAdmittedProfile", (name) => {
    const bytes = new Uint8Array(readFileSync(join(dir ?? "", name)));
    const world = readWorldTiles(bytes);
    const { width, height } = world.metadata;
    expect(resolveWorldFormat(world.header.version)).not.toBeNull();
    const planes: readonly ArrayLike<number>[] = Object.values(world.planes);
    for (const plane of planes) expect(plane.length).toBe(width * height);

    // Every non-empty block/wall references the palette and every shape is defined.
    // Counted in a plain loop: one expect per tile would dominate the run time on large worlds.
    const { block, wall, shape } = world.planes;
    const paletteSize = world.palette.length;
    let invalid = 0;
    for (let index = 0; index < block.length; index++) {
      const id = block[index] ?? NO_CONTENT;
      const wallId = wall[index] ?? NO_CONTENT;
      if ((id !== NO_CONTENT && id >= paletteSize) || (wallId !== NO_CONTENT && wallId >= paletteSize)
        || (shape[index] ?? 0) > 5) invalid++;
    }
    expect(invalid).toBe(0);
  }, 120_000);
});
