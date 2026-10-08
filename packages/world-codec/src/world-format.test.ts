import { describe, expect, it } from "vitest";
import { resolveWorldFormat, SUPPORTED_VANILLA_FORMATS } from "./index.js";

describe("vanilla format resolution", () => {
  it("admits released groups without filling experimental/unreleased gaps", () => {
    expect(SUPPORTED_VANILLA_FORMATS).toEqual([
      269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 315, 316, 317, 318, 319, 325, 326,
    ]);
  });

  it.each([38, 87, 102, 194, 248, 268, 280, 284, 294, 299, 302, 314, 320, 321, 322, 323, 324, 327,
    -1, 0, 279.5, NaN, Infinity])("does not resolve an unadmitted version %s", (version) => {
    expect(resolveWorldFormat(version)).toBeNull();
  });

  it.each([269, 279])("resolves the shared 1.4.4 metadata and entity layout for %i", (version) => {
    const profile = resolveWorldFormat(version);
    expect(profile).toMatchObject({
      version, family: "terraria-1.4.4", evidence: "synthetic", sectionCount: 11,
      tileEncoding: "four-header-byte-rle",
      entities: { chestSlotCounts: "shared-int16", npcHomelessDespawn: false, displayDollPose: false, displayDollExtraSlots: false },
    });
    expect(Object.values(profile?.metadata ?? {})).toEqual(Array<boolean>(11).fill(false));
  });

  it.each([315, 319])("resolves new fields without lightning for %i", (version) => {
    const profile = resolveWorldFormat(version);
    expect(profile).toMatchObject({
      family: "terraria-1.4.5", evidence: "synthetic",
      entities: { chestSlotCounts: "per-chest-int32", npcHomelessDespawn: true, displayDollPose: true, displayDollExtraSlots: true },
    });
    expect(profile?.metadata).toEqual({
      lastPlayed: true, permanentHolidays: true, vampireSeed: true, claimableBanners: true,
      eventCounts: true, infectedSeed: true, teamSpawns: true, worldGenManifest: true,
      skyblockSeed: true, dualDungeonsSeed: true, lightningSeeds: false,
    });
  });

  it.each([325, 326])("resolves lightning fields and distinguishes fixture evidence for %i", (version) => {
    const profile = resolveWorldFormat(version);
    expect(Object.values(profile?.metadata ?? {})).toEqual(Array<boolean>(11).fill(true));
    expect(profile?.evidence).toBe(version === 326 ? "generated-world-fixtures" : "synthetic");
  });
});
