import { describe, expect, it } from "vitest";
import { isModContent, type ContentRef } from "./index.js";

describe("isModContent", () => {
  it("rozpoznaje treść moda", () => {
    const ref: ContentRef = { kind: "mod", mod: "Calamity", internalName: "AstralDirt" };
    expect(isModContent(ref)).toBe(true);
  });

  it("nie traktuje vanilla jako moda", () => {
    expect(isModContent({ kind: "vanilla", id: 1 })).toBe(false);
  });
});
