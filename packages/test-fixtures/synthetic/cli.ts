import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSyntheticWorld, type WorkloadProfile } from "./generator.js";
import { fileHash, runLargeSmoke } from "./large-smoke.js";

// Always generate into the OS temporary directory; benchmarks must not add Large files to the repo.
async function main(): Promise<void> {
  const [command, profileArg = "mixed", seedArg = "20261008", widthArg = "8400", heightArg = "2400"] = process.argv.slice(2);
  if ((command !== "generate" && command !== "smoke") || process.argv.length > (command === "smoke" ? 5 : 7)) {
    throw new Error("usage: cli.js generate [profile] [seed] [width] [height] | smoke [profile] [seed]");
  }
  if (profileArg !== "mixed" && profileArg !== "sky-stone" && profileArg !== "dense") {
    throw new RangeError("profile must be sky-stone, dense or mixed");
  }
  const profile: WorkloadProfile = profileArg;
  const seed = Number(seedArg);
  if (command === "smoke") {
    console.log(JSON.stringify(await runLargeSmoke(profile, seed), null, 2));
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "terraria-synthetic-benchmark-"));
  try {
    const path = join(directory, `Synthetic-${profile}.wld`);
    const width = Number(widthArg);
    const height = Number(heightArg);
    const bytes = writeSyntheticWorld(path, { seed, profile, width, height });
    console.log(JSON.stringify({ path, profile, seed, width, height, bytes, sha256: await fileHash(path) }, null, 2));
    // Successful generate deliberately retains this temporary file for the benchmark caller.
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

await main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
