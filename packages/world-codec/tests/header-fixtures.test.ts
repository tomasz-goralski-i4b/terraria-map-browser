import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isFrameImportant, readWorldHeader } from "@studio/world-codec";

// Cross-check against the vanilla 1.4.5.8 corpus (docs/file-format.md, "Cross-check on real fixtures").
const worldsDir = new URL("../../test-fixtures/worlds/", import.meta.url);

interface ManifestWorld {
  readonly file: string;
  readonly formatVersion: number;
  readonly fileRevision: number;
  readonly bytes: number;
}

const manifest = JSON.parse(readFileSync(new URL("manifest.json", worldsDir), "utf8")) as {
  readonly worlds: readonly ManifestWorld[];
};

describe("readWorldHeader — vanilla corpus", () => {
  it.each(manifest.worlds.map((world) => [world.file, world] as const))(
    "readWorldHeader_VanillaFixture_MatchesDocumentedLayout (%s)",
    (_, world) => {
      const bytes = new Uint8Array(readFileSync(new URL(world.file, worldsDir)));
      expect(bytes.length).toBe(world.bytes);
      const { header, sections } = readWorldHeader(bytes);
      expect(header.version).toBe(world.formatVersion);
      expect(header.signature).toBe("relogic");
      expect(header.fileType).toBe(2);
      expect(header.revision).toBe(world.fileRevision);
      expect(header.sectionCount).toBe(11);
      expect(sections.fileHeader).toEqual({ start: 0, end: 167 });
      expect(sections.frameImportantCount).toBe(754);
      const setCount = Array.from({ length: 754 }, (_unused, id) => id).filter((id) =>
        isFrameImportant(sections, id),
      ).length;
      expect(setCount).toBe(412);
      expect(sections.footer.end).toBe(bytes.length);
      expect(sections.footer.end - sections.footer.start).toBe(11);
    },
  );
});
