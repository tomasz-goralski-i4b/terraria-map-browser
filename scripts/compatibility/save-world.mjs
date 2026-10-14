import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { readWorldTiles, serializeCwm, writeWorld } from "../../packages/world-codec/dist/index.js";

/** Capture expectations from the in-memory world BEFORE writing: a self-consistent parser/writer bug must fail. */
async function saveWorld(source, directory) {
  const world = readWorldTiles(await readFile(source));
  await writeFile(join(directory, "original.cwm"), serializeCwm(world), { flag: "wx" });
  await writeFile(join(directory, "unchanged.wld"), new Uint8Array(writeWorld(world)), { flag: "wx" });
  // Cross a chunk boundary where the world is large enough. Wires are representable without palette churn.
  const x = Math.min(129, world.metadata.width - 1);
  const y = Math.min(128, world.metadata.height - 1);
  const index = x * world.metadata.height + y;
  world.planes.flags[index] ^= 1;
  await writeFile(join(directory, "edit.json"), JSON.stringify({ x, y, plane: "flags", mask: 1 }), { flag: "wx" });
  await writeFile(join(directory, "edited.cwm"), serializeCwm(world), { flag: "wx" });
  await writeFile(join(directory, "edited.wld"), new Uint8Array(writeWorld(world)), { flag: "wx" });
}

if (import.meta.main) {
  try {
    if (process.argv.length !== 4) throw new Error("Usage: save-world.mjs <fixture.wld> <fresh-output-directory>");
    await saveWorld(process.argv[2], process.argv[3]);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
