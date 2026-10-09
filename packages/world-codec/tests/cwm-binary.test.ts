import { describe, expect, it } from "vitest";
import { readWorldTiles, serializeCwm, SUPPORTED_VANILLA_FORMATS, type CwmBinaryWorld } from "@studio/world-codec";
import { buildMetadata, wrapMetadata } from "../src/metadata-fixture.js";

// Same independently specified eight coordinates as CanonicalWorldBinaryTests.cs.
function coastalWorld(): CwmBinaryWorld {
  return {
    header: { version: 326 },
    metadata: {
      name: "Forêt 海岸", seed: "948580918", guid: "00112233445566778899aabbccddeeff",
      worldId: 948580918, mode: "expert", evil: "corruption", width: 2, height: 4,
    },
    palette: [
      { kind: "vanilla", id: 1 }, { kind: "vanilla", id: 4 },
      { kind: "unknown", runtimeId: 500 }, { kind: "unknown", runtimeId: 800 }, { kind: "vanilla", id: 2 },
    ],
    planes: {
      block: new Uint16Array([0, 1, 3, 65535, 0, 4, 65535, 65535]),
      wall: new Uint16Array([0, 2, 0, 65535, 4, 65535, 65535, 65535]),
      frameX: new Int16Array([-1, -32768, -18, -1, 18, -1, -1, -1]),
      frameY: new Int16Array([-1, 32767, -44, -1, 44, -1, -1, -1]),
      paint: new Uint8Array([0, 255, 0, 0, 3, 0, 0, 0]),
      wallPaint: new Uint8Array([0, 7, 0, 0, 0, 0, 0, 0]),
      liquid: new Uint8Array([0, 1, 2, 3, 4, 0, 0, 0]),
      liquidAmount: new Uint8Array([0, 0, 64, 255, 16, 0, 0, 0]),
      shape: new Uint8Array([0, 1, 2, 0, 3, 4, 5, 0]),
      flags: new Uint16Array([0, 1023, 2, 0, 4, 8, 16, 32]),
    },
  };
}

const header = '{"schemaVersion":1,"formatVersion":326,"metadata":{"name":"Forêt 海岸","seed":"948580918","guid":"00112233445566778899aabbccddeeff","worldId":948580918,"gameMode":1,"evil":"corruption"},"dimensions":{"width":2,"height":4},"palette":[{"kind":"vanilla","id":1},{"kind":"vanilla","id":4},{"kind":"unknown","runtimeId":500},{"kind":"unknown","runtimeId":800},{"kind":"vanilla","id":2}]}';

function expectedBytes(json = header): Uint8Array {
  const encoded = new TextEncoder().encode(json);
  const payload = `
    00 00 01 00 03 00 ff ff 00 00 04 00 ff ff ff ff
    00 00 02 00 00 00 ff ff 04 00 ff ff ff ff ff ff
    ff ff 00 80 ee ff ff ff 12 00 ff ff ff ff ff ff
    ff ff ff 7f d4 ff ff ff 2c 00 ff ff ff ff ff ff
    00 ff 00 00 03 00 00 00
    00 07 00 00 00 00 00 00
    00 01 02 03 04 00 00 00
    00 00 40 ff 10 00 00 00
    00 01 02 00 03 04 05 00
    00 00 ff 03 02 00 00 00 04 00 08 00 10 00 20 00
  `.trim().split(/\s+/).map((value) => Number.parseInt(value, 16));
  const prefix = new Uint8Array(12);
  prefix.set([0x43, 0x57, 0x4d, 0]);
  new DataView(prefix.buffer).setUint32(4, 1, true);
  new DataView(prefix.buffer).setUint32(8, encoded.length, true);
  return new Uint8Array([...prefix, ...encoded, ...payload]);
}

describe("serializeCwm", () => {
  it.each(SUPPORTED_VANILLA_FORMATS)("exports parsed format %s through the same CWM v1 contract", (version) => {
    const layout = version < 284 ? "1.4.4" : version < 323 ? "1.4.5" : "1.4.5-lightning";
    const source = wrapMetadata(buildMetadata({ layout, name: "Forêt 海岸", width: 2, height: 4 }).bytes, 4, version);
    const view = new DataView(source.buffer);
    source.set([0x40, 3, 0x40, 3], view.getInt32(30, true));
    const parsed = readWorldTiles(source);
    const bytes = serializeCwm(parsed);
    const framing = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(framing.getUint32(4, true)).toBe(1);
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + framing.getUint32(8, true)))) as {
      schemaVersion: number; formatVersion: number; dimensions: { width: number; height: number };
    };
    expect(json).toMatchObject({ schemaVersion: 1, formatVersion: version, dimensions: { width: 2, height: 4 } });
    expect(bytes.length).toBe(12 + framing.getUint32(8, true) + 120);
    expect(serializeCwm(parsed)).toEqual(bytes);
  });
  it("matches every byte of the shared two by four contract example", () => {
    expect(serializeCwm(coastalWorld())).toEqual(expectedBytes());
  });

  it("uses exact control escapes and direct UTF-8 for every other scalar", () => {
    const world = coastalWorld();
    const name = 'Forêt 😀\uFEFF\u2028\u2029\u007F /"海岸"\\\b\t\n\f\r';
    const seed = "948580918" + String.fromCharCode(...[0, 1, 2, 3, 4, 5, 6, 7, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31]);
    const escapedName = 'Forêt 😀\uFEFF\u2028\u2029\u007F /\\"海岸\\"\\\\\\b\\t\\n\\f\\r';
    const escapedSeed = "948580918\\u0000\\u0001\\u0002\\u0003\\u0004\\u0005\\u0006\\u0007\\u000b\\u000e\\u000f\\u0010\\u0011\\u0012\\u0013\\u0014\\u0015\\u0016\\u0017\\u0018\\u0019\\u001a\\u001b\\u001c\\u001d\\u001e\\u001f";
    const json = header.replace("Forêt 海岸", escapedName).replace('"seed":"948580918"', `"seed":"${escapedSeed}"`);
    expect(serializeCwm({ ...world, metadata: { ...world.metadata, name, seed } })).toEqual(expectedBytes(json));
  });

  it.each(["\ud83d", "\ude00", "\ud83d\ud83d"])("replaces unpaired UTF-16 surrogates (%s)", (surrogates) => {
    const world = coastalWorld();
    const name = `Forêt ${surrogates} 海岸`;
    const json = header.replace("Forêt 海岸", `Forêt ${"�".repeat(surrogates.length)} 海岸`);
    expect(serializeCwm({ ...world, metadata: { ...world.metadata, name } })).toEqual(expectedBytes(json));
  });

  it.each([
    [null, "null"], ["classic", "0"], ["expert", "1"], ["master", "2"], ["journey", "3"],
    [{ mode: "unknown", raw: 7 }, "7"],
  ] as const)("normalizes game mode and nullable metadata (%j)", (mode, expectedMode) => {
    const world = coastalWorld();
    const metadata = { ...world.metadata, mode, seed: null, guid: null };
    const json = header.replace('"seed":"948580918"', '"seed":null')
      .replace('"guid":"00112233445566778899aabbccddeeff"', '"guid":null').replace('"gameMode":1', `"gameMode":${expectedMode}`);
    expect(serializeCwm({ ...world, metadata })).toEqual(expectedBytes(json));
  });

  it("orders palette properties independently of insertion order and omits absent mod fields", () => {
    const world = coastalWorld();
    const palette = [
      { id: 1, kind: "vanilla" as const },
      { modVersion: "2.0.4.6", runtimeId: 900, internalName: "AstralStone", mod: "CalamityMod", kind: "mod" as const },
      { kind: "mod" as const, mod: "CalamityMod", internalName: "AstralDirtWall" },
      { kind: "mod" as const, mod: "CalamityMod", internalName: "Navystone", runtimeId: 901 },
      { kind: "mod" as const, mod: "CalamityMod", internalName: "EutrophicSandWall", modVersion: "2.0.4.6" },
    ];
    const json = header.slice(0, header.indexOf('"palette":')) + '"palette":[{"kind":"vanilla","id":1},{"kind":"mod","mod":"CalamityMod","internalName":"AstralStone","runtimeId":900,"modVersion":"2.0.4.6"},{"kind":"mod","mod":"CalamityMod","internalName":"AstralDirtWall"},{"kind":"mod","mod":"CalamityMod","internalName":"Navystone","runtimeId":901},{"kind":"mod","mod":"CalamityMod","internalName":"EutrophicSandWall","modVersion":"2.0.4.6"}]}';
    expect(serializeCwm({ ...world, palette })).toEqual(expectedBytes(json));
  });

  it("respects sliced plane buffers, returns owned bytes and preserves inputs", () => {
    const world = coastalWorld();
    const storage = new Uint16Array(12).fill(42);
    storage.set(world.planes.block, 2);
    const block = storage.subarray(2, 10);
    const planes = { ...world.planes, block };
    const before = structuredClone({ ...world, planes });
    const bytes = serializeCwm({ ...world, planes });
    expect(bytes).toEqual(expectedBytes());
    bytes.fill(0);
    expect({ ...world, planes }).toEqual(before);
    expect(storage[0]).toBe(42);
    expect(serializeCwm({ ...world, planes })).toEqual(expectedBytes());
  });

  it.each([0, 2, -1, NaN, 1.5])("rejects schema version %s", (version) => {
    expect(() => serializeCwm(coastalWorld(), version)).toThrow(/schema/i);
  });

  it.each([0, -1, 2.5, NaN, Number.MAX_SAFE_INTEGER])("rejects invalid dimensions (%s)", (width) => {
    const world = coastalWorld();
    expect(() => serializeCwm({ ...world, metadata: { ...world.metadata, width } })).toThrow(/dimension|size/i);
  });

  it.each(["block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags"] as const)(
    "rejects inconsistent %s plane lengths", (name) => {
      const world = coastalWorld();
      const planes = { ...world.planes, [name]: world.planes[name].subarray(1) };
      expect(() => serializeCwm({ ...world, planes })).toThrow(new RegExp(name));
    },
  );

  it("rejects a signed frame plane with an incompatible element type", () => {
    const world = coastalWorld();
    const planes = { ...world.planes, frameX: new Uint16Array(8) as unknown as Int16Array };
    expect(() => serializeCwm({ ...world, planes })).toThrow(/frameX/);
  });
});
