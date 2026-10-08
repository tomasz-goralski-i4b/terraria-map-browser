import { describe, expect, test } from "vitest";
import { buildSpriteAtlas } from "./atlas-build.js";
import { filesToContentDirectory, type PickedFile } from "./content-files.js";
import { buildTexturePayload, patternRgba, wrapUncompressed } from "./xnb-fixture.js";

function picked(path: string, bytes: Uint8Array = new Uint8Array([1, 2, 3])): PickedFile {
  const name = path.split("/").at(-1) ?? path;
  return {
    name,
    webkitRelativePath: path,
    size: bytes.length,
    lastModified: 1000,
    arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
  };
}

async function names(files: readonly PickedFile[]): Promise<string[]> {
  const listed: string[] = [];
  for await (const [name, entry] of filesToContentDirectory(files).entries()) {
    expect(entry.kind).toBe("file");
    listed.push(name);
  }
  return listed;
}

describe("filesToContentDirectory", () => {
  test("lists only the files directly inside an Images folder when the Content folder was picked", async () => {
    expect(await names([
      picked("Content/Images/Tiles_0.xnb"),
      picked("Content/images/Wall_1.xnb"),
      picked("Content/Images/UI/Tiles_9.xnb"),
      picked("Content/Fonts/Tiles_2.xnb"),
      picked("Content/Tiles_3.xnb"),
    ])).toEqual(["Tiles_0.xnb", "Wall_1.xnb"]);
  });

  test("lists the top-level files when the Images folder itself was picked", async () => {
    expect(await names([picked("Images/Tiles_0.xnb"), picked("Images/Sub/Wall_1.xnb")])).toEqual(["Tiles_0.xnb"]);
  });

  test("has no sub-directories, so the build reads the listed files as the Images folder", async () => {
    await expect(filesToContentDirectory([]).getDirectoryHandle("Images")).rejects.toThrow();
  });

  test("the atlas builds from picked files with their name, size and last-modified time", async () => {
    const bytes = new Uint8Array(wrapUncompressed(buildTexturePayload(36, 36, patternRgba(36, 36))));
    const result = await buildSpriteAtlas(filesToContentDirectory([
      picked("Content/Images/Tiles_7.xnb", bytes),
      picked("Content/Images/Wall_2.xnb", bytes),
    ]));
    expect(result.missing).toEqual([]);
    expect(result.atlas.index.entries.map((e) => `${e.kind}:${String(e.id)}`).sort()).toEqual(["tile:7", "wall:2"]);
  });
});
