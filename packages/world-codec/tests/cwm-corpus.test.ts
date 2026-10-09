import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { exportCwmCorpus, runExportCwmCorpus } from "../src/node/export-cwm-corpus.js";

const fixtures = fileURLToPath(new URL("../../test-fixtures/worlds/", import.meta.url));
const snapshots = fileURLToPath(new URL("../../test-fixtures/snapshots/m1/", import.meta.url));
const manifest = JSON.parse(await readFile(join(fixtures, "manifest.json"), "utf8")) as {
  worlds: { file: string; sha256: string }[];
};
const hash = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

interface ChunkSnapshot {
  size: number;
  planes: string[];
  digests: ({ x: number; y: number; width: number; height: number } & Record<string, string | number>)[];
}

describe("TypeScript CWM corpus export", () => {
  it("exports every fixture twice with exact golden headers and plane digests, preserving sources and goldens", { tags: ["perf"], timeout: 120_000 }, async () => {
    const directory = await mkdtemp(join(tmpdir(), "terraria-cwm-corpus-"));
    const first = join(directory, "first");
    const second = join(directory, "second");
    await mkdir(first);
    await mkdir(second);
    const protectedFiles = [join(fixtures, "manifest.json"), ...manifest.worlds.flatMap(({ file }) => {
      const stem = file.slice(0, -4);
      return [join(fixtures, file), join(snapshots, `${stem}.meta.json`), join(snapshots, `${stem}.chunks.json`)];
    })];
    const before = await Promise.all(protectedFiles.map(async (file) => hash(await readFile(file))));
    try {
      await exportCwmCorpus(fixtures, first);
      // Exercise the compiled Node CLI separately from the in-process adapter.
      execFileSync(process.execPath, [fileURLToPath(new URL("../dist/node/export-cwm-corpus.js", import.meta.url)), fixtures, second]);
      expect((await readdir(first)).sort()).toEqual(manifest.worlds.map(({ file }) => file.replace(/\.wld$/, ".cwm")).sort());
      for (const { file, sha256 } of manifest.worlds) {
        expect(hash(await readFile(join(fixtures, file)))).toBe(sha256);
        const stem = file.slice(0, -4);
        const bytes = await readFile(join(first, `${stem}.cwm`));
        expect(bytes.equals(await readFile(join(second, `${stem}.cwm`)))).toBe(true);
        expect([...bytes.subarray(0, 8)]).toEqual([0x43, 0x57, 0x4d, 0, 1, 0, 0, 0]);
        const length = bytes.readUInt32LE(8);
        const golden = JSON.parse(await readFile(join(snapshots, `${stem}.meta.json`), "utf8")) as {
          schemaVersion: number; formatVersion: number; metadata: unknown;
          dimensions: { width: number; height: number }; palette: unknown;
        };
        const expectedHeader = JSON.stringify({
          schemaVersion: golden.schemaVersion, formatVersion: golden.formatVersion, metadata: golden.metadata,
          dimensions: golden.dimensions, palette: golden.palette,
        });
        expect(bytes.subarray(12, 12 + length).toString("utf8")).toBe(expectedHeader);
        expect(bytes.length).toBe(12 + length + 15 * golden.dimensions.width * golden.dimensions.height);
        const chunks = JSON.parse(await readFile(join(snapshots, `${stem}.chunks.json`), "utf8")) as ChunkSnapshot;
        let offset = 12 + length;
        for (const plane of chunks.planes) {
          const size = ["block", "wall", "frameX", "frameY", "flags"].includes(plane) ? 2 : 1;
          for (const chunk of chunks.digests) {
            const digest = createHash("sha256");
            for (let x = chunk.x * chunks.size; x < chunk.x * chunks.size + chunk.width; x++) {
              const start = offset + (x * golden.dimensions.height + chunk.y * chunks.size) * size;
              digest.update(bytes.subarray(start, start + chunk.height * size));
            }
            expect(digest.digest("hex").slice(0, 16), `${file}: ${plane} (${String(chunk.x)}, ${String(chunk.y)})`).toBe(chunk[plane]);
          }
          offset += golden.dimensions.width * golden.dimensions.height * size;
        }
      }
      expect(await Promise.all(protectedFiles.map(async (file) => hash(await readFile(file))))).toEqual(before);
      const saved = hash(await readFile(join(first, "SCCO1.cwm")));
      await expect(exportCwmCorpus(fixtures, first)).rejects.toThrow(/exist/i);
      expect(hash(await readFile(join(first, "SCCO1.cwm")))).toBe(saved);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects source-directory aliases before writing anything", async () => {
    await expect(exportCwmCorpus(fixtures, fixtures)).rejects.toThrow(/fixture|source|destination/i);
    await expect(exportCwmCorpus(fixtures, snapshots)).rejects.toThrow(/fixture|source|destination/i);
  });

  it.each([
    [{ schemaVersion: 2, worlds: [] }, "schema"],
    [{ schemaVersion: 1, worlds: [{ file: "../SCCO1.wld" }] }, "file"],
    [{ schemaVersion: 1, worlds: [{ file: "SCCO1.wld" }, { file: "SCCO1.wld" }] }, "duplicate"],
    [{ schemaVersion: 1, worlds: [{ file: "SCCO1.wld" }] }, "truncated"],
  ])("rejects malformed corpus input without completed output (%j)", async (content) => {
    const directory = await mkdtemp(join(tmpdir(), "terraria-cwm-invalid-"));
    const input = join(directory, "worlds");
    const output = join(directory, "exports");
    await mkdir(input);
    await mkdir(output);
    await writeFile(join(input, "manifest.json"), JSON.stringify(content));
    await writeFile(join(input, "SCCO1.wld"), new Uint8Array([0x46, 1]));
    try {
      await expect(exportCwmCorpus(input, output)).rejects.toThrow();
      expect(await readdir(output)).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([{ args: [] }, { args: [fixtures] }, { args: [fixtures, tmpdir(), "SCCO1"] }])("returns argument error for invalid CLI arguments ($args)", async ({ args }) => {
    expect(await runExportCwmCorpus(args)).toBe(2);
  });
});
