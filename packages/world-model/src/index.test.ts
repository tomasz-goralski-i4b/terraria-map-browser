import { describe, expect, it } from "vitest";
import { isModContent, type ContentRef } from "./index.js";

describe("isModContent", () => {
  it("recognises mod content", () => {
    const ref: ContentRef = { kind: "mod", mod: "Calamity", internalName: "AstralDirt" };
    expect(isModContent(ref)).toBe(true);
  });

  it("does not treat vanilla as mod content", () => {
    expect(isModContent({ kind: "vanilla", id: 1 })).toBe(false);
  });
});
