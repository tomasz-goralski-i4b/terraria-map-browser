import { expect, test } from "vitest";
import { contentName, describeTile, LIQUID_NAMES } from "../src/world/content-names.js";

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

test("keeps palette keys for unknown, modded and unnamed vanilla content", () => {
  expect(contentName({ kind: "unknown", runtimeId: 900 }, "wall")).toBe("unknown:900");
  expect(contentName({ kind: "mod", mod: "CalamityMod", internalName: "AstralStone" }, "block")).toBe("CalamityMod:AstralStone");
  expect(contentName({ kind: "vanilla", id: 5000 }, "block")).toBe("vanilla:5000");
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
