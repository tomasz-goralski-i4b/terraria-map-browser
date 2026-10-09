import { expect, test } from "vitest";
import { terrariaMapNames } from "@studio/renderer";
import { contentName, describeTile, LIQUID_NAMES, paintName } from "../src/world/content-names.js";

test("names ordinary materials from the game's placement items and names map objects from its legend", () => {
  expect(contentName({ kind: "vanilla", id: 0 }, "block")).toBe("Dirt Block");
  expect(contentName({ kind: "vanilla", id: 1 }, "block")).toBe("Stone Block");
  expect(contentName({ kind: "vanilla", id: 1 }, "wall")).toBe("Stone Wall");
  expect(contentName({ kind: "vanilla", id: 2 }, "wall")).toBe("Natural Dirt Wall");
  expect(contentName({ kind: "vanilla", id: 16 }, "wall")).toBe("Dirt Wall");
  expect(contentName({ kind: "vanilla", id: 5 }, "block")).toBe("Tree");
});

test("uses the known frame axis for a map option and option zero without that axis", () => {
  const altar = { kind: "vanilla", id: 26 } as const;
  expect(contentName(altar, "block")).toBe("Demon Altar");
  expect(contentName(altar, "block", { frameX: 54 })).toBe("Crimson Altar");
  expect(contentName(altar, "block", { frameY: 18 })).toBe("Demon Altar");
  expect(contentName(altar, "block", { frameX: -1 })).toBe("Demon Altar");
  expect(contentName({ kind: "vanilla", id: 82 }, "block", { frameX: 18, frameY: 0 })).toBe("Moonglow");
  expect(contentName({ kind: "vanilla", id: 5 }, "block", { frameX: 22, frameY: 44 })).toBe("Tree");
});

test("names terrain, vegetation and objects even without a map colour", () => {
  expect(contentName({ kind: "vanilla", id: 2 }, "block")).toBe("Grass");
  expect(contentName({ kind: "vanilla", id: 3 }, "block")).toBe("Plants");
  expect(contentName({ kind: "vanilla", id: 61 }, "block")).toBe("Jungle Plants");
  expect(contentName({ kind: "vanilla", id: 135 }, "block")).toBe("Pressure Plates");
  expect(contentName({ kind: "vanilla", id: 541 }, "block")).toBe("Echo Block");
  for (const [id, name] of [[2, "Grass"], [3, "Plants"]] as const) {
    expect(describeTile({ block: { kind: "vanilla", id }, wires: 0, actuator: false })).toBe(name);
  }
});

test("every shipped vanilla block has a name while unknown and modded content keeps its key", () => {
  for (let id = 0; id < terrariaMapNames.tiles.length; id++) {
    expect(contentName({ kind: "vanilla", id }, "block"), `block ${String(id)}`).not.toBe(`vanilla:${String(id)}`);
  }
  expect(contentName({ kind: "unknown", runtimeId: 900 }, "wall")).toBe("unknown:900");
  expect(contentName({ kind: "mod", mod: "CalamityMod", internalName: "AstralStone" }, "block")).toBe("CalamityMod:AstralStone");
  expect(contentName({ kind: "vanilla", id: 5000 }, "block")).toBe("vanilla:5000");
});

test("wall names use option zero independently of the block's frame", () => {
  expect(contentName({ kind: "vanilla", id: 1 }, "wall")).toBe("Stone Wall");
  expect(describeTile({
    block: { kind: "vanilla", id: 26 }, frameX: 54, frameY: 18,
    wall: { kind: "vanilla", id: 1 }, wires: 0, actuator: false,
  })).toBe("Crimson Altar · Stone Wall");
  // The current game's only multi-option wall (27) uses the placement-item fallback.
  // Both options say Planked Wall, so current game data cannot distinguish option zero from one.
  expect(terrariaMapNames.walls[27]).toEqual(["Planked Wall", "Planked Wall"]);
  expect(contentName({ kind: "vanilla", id: 27 }, "wall")).toBe("Planked Wall");
  expect(describeTile({
    block: { kind: "vanilla", id: 26 }, frameX: 54, frameY: 18,
    wall: { kind: "vanilla", id: 27 }, wires: 0, actuator: false,
  })).toBe("Crimson Altar · Planked Wall");
});

test("describes the hovered block's map option, wall and every liquid with generated names", () => {
  expect(LIQUID_NAMES).toEqual(["", "Water", "Lava", "Honey", "Shimmer"]);
  for (const kind of ["water", "lava", "honey", "shimmer"] as const) {
    expect(describeTile({
      block: { kind: "vanilla", id: 26 }, frameX: 54,
      wall: { kind: "vanilla", id: 1 }, liquid: { kind, amount: 128 }, wires: 0, actuator: false,
    })).toBe(`Crimson Altar · Stone Wall · ${kind.charAt(0).toUpperCase() + kind.slice(1)} 128`);
  }
  expect(describeTile({ wires: 0, actuator: false })).toBe("Empty");
});

test("names paints from item metadata and describes independent block and wall paints", () => {
  expect(paintName(19)).toBe("Deep Cyan Paint");
  expect(paintName(7)).toBe("Cyan Paint");
  expect(paintName(29)).toBe("Shadow Paint");
  expect(paintName(30)).toBe("Negative Paint");
  expect(paintName(200)).toBe("paint:200");
  expect(paintName(31)).toBe("paint:31");
  expect(describeTile({
    block: { kind: "vanilla", id: 1 }, paint: 19,
    wall: { kind: "vanilla", id: 1 }, wallPaint: 7, wires: 0, actuator: false,
  })).toBe("Stone Block (Deep Cyan Paint) · Stone Wall (Cyan Paint)");
  expect(describeTile({ block: { kind: "vanilla", id: 0 }, paint: 0, wires: 0, actuator: false })).toBe("Dirt Block");
});
