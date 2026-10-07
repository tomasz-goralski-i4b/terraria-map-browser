import { describe, expect, it } from "vitest";
import { WorldFormatError } from "./world-format-error.js";

describe("WorldFormatError", () => {
  it("preserves diagnostics for existing callers without a field", () => {
    const error = new WorldFormatError("UnsupportedVersion", 0, "format 327 is not supported");
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: "WorldFormatError", kind: "UnsupportedVersion", offset: 0,
      reason: "format 327 is not supported",
      message: "UnsupportedVersion at offset 0: format 327 is not supported",
    });
    expect(error.field).toBeUndefined();
  });

  it("retains a supplied metadata field independently of the reason text", () => {
    const error = new WorldFormatError("MalformedMetadata", 64, "must be positive", { field: "height" });
    expect(error).toMatchObject({
      kind: "MalformedMetadata", offset: 64, reason: "must be positive", field: "height",
      message: "MalformedMetadata at offset 64: must be positive",
    });
  });

  it("preserves tile coordinates without introducing a metadata field", () => {
    const error = new WorldFormatError("MalformedTiles", 728, "RLE exceeds column height", { x: 12, y: 47 });
    expect(error).toMatchObject({ kind: "MalformedTiles", offset: 728, x: 12, y: 47 });
    expect(error.field).toBeUndefined();
  });
});
