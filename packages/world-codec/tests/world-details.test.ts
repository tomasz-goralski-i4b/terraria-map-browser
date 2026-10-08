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
    expect(details.other).toEqual({ killCountLength: 293, claimableBannerLength: 293 });
  });
});
