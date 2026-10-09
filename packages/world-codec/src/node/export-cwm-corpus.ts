import { link, lstat, mkdtemp, readFile, realpath, rm, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { serializeCwm } from "../cwm-binary.js";
import { readWorldTiles } from "../tiles.js";

class ExportArgumentError extends Error {}

function inside(directory: string, path: string): boolean {
  const suffix = relative(directory, path);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith("../") && !suffix.startsWith("..\\"));
}

function manifestFiles(value: unknown): string[] {
  if (typeof value !== "object" || value === null || !("schemaVersion" in value) || value.schemaVersion !== 1
    || !("worlds" in value) || !Array.isArray(value.worlds) || value.worlds.length === 0) {
    throw new ExportArgumentError("Expected a nonempty schema version 1 fixture manifest");
  }
  const files: string[] = [];
  const seen = new Set<string>();
  for (const entry of value.worlds as unknown[]) {
    if (typeof entry !== "object" || entry === null || !("file" in entry) || typeof entry.file !== "string"
      || !/^[A-Za-z0-9_-]+\.wld$/.test(entry.file)) {
      throw new ExportArgumentError("Manifest file must be a plain .wld filename");
    }
    const key = entry.file.toLowerCase();
    if (seen.has(key)) throw new ExportArgumentError(`Duplicate manifest file: ${entry.file}`);
    seen.add(key);
    files.push(entry.file);
  }
  return files;
}

async function requireNewDestination(path: string): Promise<void> {
  try {
    await lstat(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  throw new ExportArgumentError(`Output already exists: ${path}`);
}

/** Export the generated manifest corpus into an existing artifact directory using only TypeScript. */
export async function exportCwmCorpus(fixtureDirectory: string, outputDirectory: string): Promise<void> {
  const source = await realpath(fixtureDirectory);
  const destination = await realpath(outputDirectory);
  const protectedFixtures = await realpath(fileURLToPath(new URL("../../../test-fixtures/", import.meta.url)));
  if (inside(source, destination) || inside(protectedFixtures, destination)) {
    throw new ExportArgumentError("Destination must be outside fixture sources and goldens");
  }
  const files = manifestFiles(JSON.parse(await readFile(join(source, "manifest.json"), "utf8")) as unknown);
  for (const file of files) await requireNewDestination(join(destination, file.replace(/\.wld$/, ".cwm")));
  const staging = await mkdtemp(join(destination, ".cwm-stage-"));
  const published: string[] = [];
  try {
    // Stage the complete corpus first: a malformed fixture cannot leave earlier completed exports.
    for (const file of files) {
      const world = readWorldTiles(await readFile(join(source, file)));
      await writeFile(join(staging, file.replace(/\.wld$/, ".cwm")), serializeCwm(world), { flag: "wx" });
    }
    for (const file of files) {
      const name = file.replace(/\.wld$/, ".cwm");
      const target = join(destination, name);
      // Exclusive publication; unlike rename, link never replaces an existing destination.
      await link(join(staging, name), target);
      published.push(target);
    }
  } catch (error) {
    for (const target of published) await unlink(target);
    throw error;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

/** CLI status: 0 success, 2 arguments, 1 format/I/O failure; diagnostics go to stderr. */
export async function runExportCwmCorpus(args: readonly string[]): Promise<number> {
  const [source, destination] = args;
  if (args.length !== 2 || source === undefined || destination === undefined || source === "" || destination === "") {
    console.error("Usage: export-cwm-corpus.js <fixture-worlds-directory> <existing-output-directory>");
    return 2;
  }
  try {
    await exportCwmCorpus(source, destination);
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return error instanceof ExportArgumentError ? 2 : 1;
  }
}

if (import.meta.main) process.exitCode = await runExportCwmCorpus(process.argv.slice(2));
