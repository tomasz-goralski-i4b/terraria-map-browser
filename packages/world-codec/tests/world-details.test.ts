import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWorldMetadata } from "@studio/world-codec";

const worldsDir = new URL("../../test-fixtures/worlds/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", worldsDir), "utf8")) as {
  worlds: { file: string }[];
};
const oracle = JSON.parse(readFileSync(new URL("fixtures/world-details.json", import.meta.url), "utf8")) as {
  worlds: { file: string; spawn: { x: number; y: number }; dungeon: { x: number; y: number }; time: number; creationTime: string; lastPlayed: string }[];
};

describe("WorldDetails — independent .NET fixture cross-check", () => {
  it("matches an independently decoded .NET progression overlay with both defeated and undefeated bosses", () => {
    const oracle = JSON.parse(readFileSync(new URL("fixtures/world-details-progressed.json", import.meta.url), "utf8")) as {
      file: string; bossOffsets: Record<string, number>; hardmodeOffset: number;
      progression: { hardmode: boolean; bosses: Record<string, boolean> };
      generation: Record<string, unknown>; spawnAndLandmarks: Record<string, unknown>;
      timeAndWeather: Record<string, unknown>; other: Record<string, unknown>;
    };
    const bytes = new Uint8Array(readFileSync(new URL(oracle.file, worldsDir)));
    for (const [boss, offset] of Object.entries(oracle.bossOffsets)) {
      const defeated = oracle.progression.bosses[boss];
      if (defeated === undefined) throw new Error(`Missing synthetic progression state for ${boss}`);
      bytes[offset] = defeated ? 1 : 0;
    }
    bytes[oracle.hardmodeOffset] = 1;
    const { generation, spawnAndLandmarks, timeAndWeather, progression, other } = oracle;
    const { details } = readWorldMetadata(bytes);
    expect(details).toMatchObject({ generation, spawnAndLandmarks, timeAndWeather, progression, other });
    expect(details.progression.bosses).toEqual(oracle.progression.bosses);
    expect(details.progression.hardmode).toBe(true);
    expect(details.progression.bosses.plantera).toBe(true);
    expect(details.progression.bosses.golem).toBe(false);
  });

  it.each(manifest.worlds)("matches metadata rows consumed by the reference reader in $file", ({ file }) => {
    const expected = oracle.worlds.find((world) => world.file === file);
    expect(expected, "Every manifest fixture needs independent expectations").toBeDefined();
    if (expected === undefined) throw new Error(`Missing .NET expectations for ${file}`);
    const bytes = new Uint8Array(readFileSync(new URL(file, worldsDir)));
    const { details } = readWorldMetadata(bytes);
    expect(details.generation).toMatchObject({
      worldGenVersion: "1400159338497", creationTime: expected.creationTime, lastPlayed: expected.lastPlayed,
    });
    expect(details.spawnAndLandmarks).toMatchObject({ spawn: expected.spawn, dungeon: expected.dungeon });
    expect(details.timeAndWeather).toMatchObject({ time: expected.time, dayTime: true, moonPhase: 0, bloodMoon: false, eclipse: false });
    expect(details.progression.hardmode).toBe(false);
    expect(Object.keys(details.progression.bosses)).toHaveLength(22);
    expect(Object.values(details.progression.bosses)).toEqual(Array<boolean>(22).fill(false));
    expect(details.other).toMatchObject({ killCountLength: 293, claimableBannerLength: 293 });
    expect(details.other.killCounts).toHaveLength(293);
    expect(details.other.claimableBanners).toHaveLength(293);
  });
});
