import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWorldTiles, writeWorld, writeWorldTiles, WorldFormatError } from "../src/index.js";
import { writerSource } from "./writer-support.js";

// Released formats and content limits independently stated from compatibility.md (T1/T41).
const formats = [269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 315, 316, 317, 318, 319, 325, 326];
const vectors = JSON.parse(readFileSync(new URL("../../../contracts/vectors/entities.vectors.json", import.meta.url), "utf8")) as {
  vectors: { id: string; hex: string }[];
};

function entityBytes(id: string): Uint8Array {
  const vector = vectors.vectors.find((entry) => entry.id === id);
  if (vector === undefined) throw new Error(`Missing entity vector ${id}`);
  return Uint8Array.from(Buffer.from(vector.hex, "hex"));
}

/** Existing chest/NPC/display-doll vectors exercise both physical entity layouts. */
function source(version: number, tiles = [0x42, 1, 3, 0x40, 3]): Uint8Array {
  const original = writerSource(2, 4, tiles, version);
  const world = readWorldTiles(original);
  const spans = [
    entityBytes(version < 315 ? "E34" : "E01"), new Uint8Array(2),
    entityBytes(version < 315 ? "E36" : "E38"), entityBytes(version < 315 ? "E39" : "E40"),
    new Uint8Array(4), new Uint8Array(4), new Uint8Array(12), new Uint8Array(1), world.envelope.footer,
  ];
  let position = world.sections.chests.start;
  const output = new Uint8Array(position + spans.reduce((length, span) => length + span.length, 0));
  output.set(original.subarray(0, position));
  const view = new DataView(output.buffer);
  spans.forEach((span, index) => {
    view.setInt32(26 + (index + 2) * 4, position, true);
    output.set(span, position);
    position += span.length;
  });
  return output;
}

describe.each(formats)("source-format writer %i", (version) => {
  it("saves byte-identically with the original metadata and both entity layouts", () => {
    const bytes = source(version);
    const world = readWorldTiles(bytes);
    expect(Object.values(world.entities).every((section) => section.error === null)).toBe(true);
    const saved = new Uint8Array(writeWorld(world));
    expect(saved).toEqual(bytes);
    expect(readWorldTiles(saved)).toEqual(world);
  });

  it.each(["grow", "shrink"] as const)("preserves source version and opaque spans when tiles %s", (change) => {
    const bytes = source(version, change === "grow" ? undefined : [2, 1, 2, 1, 2, 1, 2, 1, 0, 0, 0, 0]);
    const world = readWorldTiles(bytes);
    if (change === "grow") {
      world.planes.wall[2] = 0;
      world.planes.liquid[2] = 4;
      world.planes.liquidAmount[2] = 0;
      world.planes.shape[2] = 3;
      world.planes.flags[2] = 0x3ff;
    }
    const before = structuredClone(world);
    const saved = readWorldTiles(new Uint8Array(writeWorld(world)));
    expect(world).toEqual(before);
    expect(saved.header).toEqual(world.header);
    expect(saved.metadata).toEqual(world.metadata);
    expect(saved.details).toEqual(world.details);
    expect(saved.planes).toEqual(world.planes);
    const delta = saved.envelope.tiles.length - world.envelope.tiles.length;
    expect(Math.sign(delta)).toBe(change === "grow" ? 1 : -1);
    expect(saved.sections.pointers).toEqual(world.sections.pointers.map((pointer, index) => pointer + (index < 2 ? 0 : delta)));
    expect(saved.envelope.metadata).toEqual(world.envelope.metadata);
    expect(saved.envelope.frameImportantBits).toEqual(world.envelope.frameImportantBits);
    expect(saved.envelope.footer).toEqual(world.envelope.footer);
    saved.envelope.opaqueSections.forEach((section, index) => {
      expect(section.bytes).toEqual(world.envelope.opaqueSections[index]?.bytes);
    });
    for (const name of Object.keys(world.entities) as (keyof typeof world.entities)[]) {
      expect(saved.entities[name].data).toEqual(world.entities[name].data);
    }
  });

  it("uses the source version's vanilla block and wall limits", () => {
    const maxBlock = version < 315 ? 692 : version < 325 ? 752 : 753;
    const maxWall = version < 315 ? 346 : 366;
    const world = { ...readWorldTiles(source(version)), palette: [
      { kind: "vanilla", id: maxBlock }, { kind: "vanilla", id: maxWall },
    ] as const };
    world.planes.block.fill(65535);
    world.planes.block[2] = 0;
    world.planes.wall[2] = 1;
    expect(readWorldTiles(new Uint8Array(writeWorld(world))).palette).toEqual(world.palette);
    expect(() => writeWorldTiles(world)).not.toThrow();
    for (const plane of ["block", "wall"] as const) {
      const edited = { ...world, palette: [{ kind: "vanilla", id: plane === "block" ? maxBlock + 1 : maxWall + 1 }] as const };
      edited.planes.block.fill(65535);
      edited.planes.wall.fill(65535);
      edited.planes[plane][2] = 0;
      expect(() => writeWorld(edited)).toThrow(WorldFormatError);
      expect(() => writeWorldTiles(edited)).toThrow(expect.objectContaining({ kind: "UnencodableTile", x: 0, y: 2 }));
    }
  });

  it("preserves all contract tile fields at a framed single-coordinate edit", () => {
    const world = { ...readWorldTiles(source(version)), palette: [
      { kind: "vanilla", id: 423 }, { kind: "vanilla", id: 256 },
    ] as const };
    world.planes.block.fill(65535);
    world.planes.block[5] = 0;
    world.planes.wall[5] = 1;
    world.planes.frameX[5] = -18;
    world.planes.frameY[5] = -1;
    world.planes.paint[5] = 255;
    world.planes.wallPaint[5] = 31;
    world.planes.liquid[5] = 4;
    world.planes.shape[5] = 5;
    world.planes.flags[5] = 0x3ff;
    const before = structuredClone(world);
    const saved = readWorldTiles(new Uint8Array(writeWorld(world)));
    expect(saved.header.version).toBe(version);
    expect(saved.planes).toEqual(world.planes);
    expect(world).toEqual(before);
  });

  it("refuses unknown content and unused references beyond this release's vanilla range", () => {
    const world = readWorldTiles(source(version));
    const before = structuredClone(world);
    const maxBlock = version < 315 ? 692 : version < 325 ? 752 : 753;
    for (const ref of [{ kind: "unknown", runtimeId: 900 }, { kind: "vanilla", id: maxBlock + 1 }]) {
      expect(() => writeWorld({ ...world, palette: [ref] } as typeof world)).toThrow(expect.objectContaining({ kind: "UnsupportedWrite" }));
    }
    expect(world).toEqual(before);
  });
});

it.each([268, 280, 314, 320, 324, 327])("refuses unadmitted write target %i", (version) => {
  const world = readWorldTiles(source(326));
  Object.assign(world.header, { version });
  expect(() => writeWorld(world)).toThrow(expect.objectContaining({ kind: "UnsupportedWrite" }));
  expect(() => writeWorldTiles(world)).toThrow(expect.objectContaining({ kind: "UnsupportedWrite" }));
});
