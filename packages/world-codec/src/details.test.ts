import { describe, expect, it } from "vitest";
import { readWorldMetadata, readWorldTiles, SUPPORTED_VANILLA_FORMATS, WorldFormatError } from "./index.js";
import { buildMetadata, wrapMetadata, type MetadataSpec } from "./metadata-fixture.js";

function fieldOffset(field: string): number {
  const offset = buildMetadata().offsets[field];
  if (offset === undefined) throw new Error(`Missing synthetic metadata field ${field}`);
  return offset;
}

function read(spec: MetadataSpec = {}) {
  return readWorldMetadata(wrapMetadata(buildMetadata(spec).bytes)).details;
}

const flags = (group: string, names: string): string[] => names.split(" ").map((name) => `${group}.${name}`);
// Independent row order from metadata.md; every neighbouring flag is exercised separately.
const flagPaths = [
  ...flags("generation.specialSeeds", "drunk forTheWorthy tenthAnniversary dontStarve notTheBees remix noTraps zenith skyblock"),
  ...flags("timeAndWeather", "dayTime bloodMoon eclipse"),
  "evil",
  ...flags("progression.bosses", "eyeOfCthulhu eaterOfWorldsOrBrainOfCthulhu skeletron queenBee destroyer twins skeletronPrime anyMechanicalBoss plantera golem kingSlime"),
  ...flags("progression.savedNpcs", "goblinTinkerer wizard mechanic"),
  ...flags("progression.defeatedInvasions", "goblins clown frostLegion pirates"),
  ...flags("progression", "orbSmashed spawnMeteor hardmode partyOfDoom"),
  "timeAndWeather.rain.active", "progression.savedNpcs.angler",
  ...flags("progression.savedNpcs", "stylist taxCollector golfer"),
  "timeAndWeather.fastForwardTime", "progression.bosses.dukeFishron", "progression.defeatedInvasions.martians",
  ...flags("progression.bosses", "lunaticCultist moonLord pumpking mourningWood iceQueen santaNk1 everscream"),
  ...flags("progression.defeatedPillars", "solar vortex nebula stardust"),
  ...flags("progression.activePillars", "solar vortex nebula stardust"),
  "progression.apocalypse", ...flags("timeAndWeather.party", "manual genuine"), "timeAndWeather.sandstorm.active",
  "progression.savedNpcs.tavernkeep", ...flags("progression.defeatedInvasions", "oldOnesArmyTier1 oldOnesArmyTier2 oldOnesArmyTier3"),
  "progression.combatBookUsed", ...flags("timeAndWeather.lanternNight", "genuine manual nextIsGenuine"),
  ...flags("timeAndWeather.holidays", "halloweenToday christmasToday"),
  ...flags("progression.boughtPets", "cat dog bunny"),
  ...flags("progression.bosses", "empressOfLight queenSlime deerclops"),
  ...flags("progression.unlockedNpcs", "blueSlime merchant demolitionist partyGirl dyeTrader truffle armsDealer nurse princess"),
  ...flags("progression", "combatBookVolumeTwoUsed peddlersSatchelUsed"),
  ...flags("progression.unlockedNpcs", "greenSlime oldSlime purpleSlime rainbowSlime redSlime yellowSlime copperSlime"),
  "timeAndWeather.fastForwardToDusk", ...flags("timeAndWeather.holidays", "halloweenForever christmasForever"),
  ...flags("generation.specialSeeds", "vampire infected teamSpawns dualDungeons moreLightning noLightning"),
];

function property(value: unknown, path: string): unknown {
  for (const part of path.split(".")) {
    if (typeof value !== "object" || value === null) throw new Error(`Missing detail group in ${path}`);
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}

describe("WorldDetails", () => {
  it("accounts for every stored Bool in the complete section", () => {
    expect(flagPaths).toHaveLength(buildMetadata().booleans.length);
  });

  it.each(flagPaths.map((path, index) => [path, index] as const))("preserves the stored false/true flag %s", (path, index) => {
    const fixture = buildMetadata();
    const offset = fixture.booleans[index];
    if (offset === undefined) throw new Error(`Missing Bool for ${path}`);
    for (const active of [false, true]) {
      fixture.bytes[offset] = active ? 1 : 0;
      const result = readWorldMetadata(wrapMetadata(fixture.bytes));
      expect(path === "evil" ? result.metadata.evil === "crimson" : property(result.details, path)).toBe(active);
    }
  });

  it("decodes realistic generation, landmarks, ores, invasion and event settings in row order", () => {
    const fixture = buildMetadata();
    const view = new DataView(fixture.bytes.buffer);
    let cursor = fieldOffset("lastPlayed") + 8;
    const byte = (value: number): void => { view.setUint8(cursor++, value); };
    const int = (value: number): void => { view.setInt32(cursor, value, true); cursor += 4; };
    const double = (value: number): void => { view.setFloat64(cursor, value, true); cursor += 8; };
    const single = (value: number): void => { view.setFloat32(cursor, value, true); cursor += 4; };
    byte(2);
    [1200, 2400, 3200, 0, 1, 2, 3, 1000, 2200, 3300, 1, 2, 3, 4, 2, 3, 1, 2100, 295].forEach(int);
    double(300); double(420.5); double(16200.5);
    byte(0); int(6); byte(1); byte(0); int(450); int(215);
    cursor++; // evil
    cursor += 18; byte(1); byte(0); byte(3); int(12); byte(1); byte(0);
    [60, 120, 3].forEach(int); double(450.5); double(1800); byte(2);
    byte(1); int(3600); single(0.75); [107, 108, 111].forEach(int);
    [0, 1, 2, 3, 4, 5, 6, 7].forEach(byte); int(1);
    view.setInt16(cursor, 100, true); cursor += 2; single(-0.5);
    expect(cursor).toBe(fieldOffset("anglerFinishers"));
    cursor = fieldOffset("killCounts") - 16;
    byte(1); int(24); byte(1); byte(0); byte(1); int(200); int(86400);
    expect(cursor).toBe(fieldOffset("killCounts"));
    cursor = fieldOffset("partyingNpcs") - 4; int(5);
    cursor = fieldOffset("partyingNpcs") + 4 + 12;
    byte(1); int(1200); single(0.5); single(0.75);
    cursor += 4; [2, 1, 3, 4, 5].forEach(byte); byte(1); int(7); cursor += 3;
    expect(cursor).toBe(fieldOffset("treeTopVariations"));
    cursor = fieldOffset("treeTopVariations") + 4 + 52 + 2;
    [7, 6, 9, 8].forEach(int);
    cursor += 3 + 12 + 9 + 1; byte(3); cursor += 2 + 2;
    int(2); int(1);
    expect(cursor).toBe(fieldOffset("teamSpawns") - 1);
    const details = readWorldMetadata(wrapMetadata(fixture.bytes)).details;
    expect(details.generation).toMatchObject({
      moonType: 2, treeX: [1200, 2400, 3200], treeStyles: [0, 1, 2, 3], caveBackX: [1000, 2200, 3300],
      caveBackStyles: [1, 2, 3, 4], iceBackStyle: 2, jungleBackStyle: 3, hellBackStyle: 1,
      backgrounds: { tree: 0, corruption: 1, jungle: 2, snow: 3, hallow: 4, crimson: 5, desert: 6, ocean: 7 },
      additionalTreeBackgrounds: [3, 4, 5],
    });
    expect(details.spawnAndLandmarks).toMatchObject({ spawn: { x: 2100, y: 295 }, dungeon: { x: 450, y: 215 } });
    expect(details.timeAndWeather).toMatchObject({ time: 16200.5, dayTime: false, moonPhase: 6, bloodMoon: true,
      eclipse: false, slimeRainTime: 1800, sundialCooldown: 2, rain: { active: true, time: 3600, maximum: 0.75 },
      cloudBackground: 1, cloudCount: 100, windSpeed: -0.5, party: { cooldown: 5 },
      sandstorm: { time: 1200, severity: 0.5, intendedSeverity: 0.75 }, lanternNight: { cooldown: 7 },
      moondialCooldown: 3, meteorShowerCount: 2, coinRain: 1 });
    expect(details.progression).toMatchObject({ hardmode: true, orbSmashed: true, spawnMeteor: false,
      orbCount: 3, altarCount: 12, partyOfDoom: false, invasion: { delay: 60, size: 120, type: 3, x: 450.5, startSize: 200 },
      hardmodeOres: { cobalt: 107, mythril: 108, adamantite: 111 }, preHardmodeOres: { copper: 7, iron: 6, silver: 9, gold: 8 },
      anglerQuest: 24, cultistDelay: 86400 });
    expect(details.generation.backgrounds).toMatchObject({ mushroom: 2, underworld: 1 });
  });
  it.each(SUPPORTED_VANILLA_FORMATS)("exposes only fields stored by admitted format %i", (version) => {
    const layout = version < 284 ? "1.4.4" : version < 323 ? "1.4.5" : "1.4.5-lightning";
    const details = readWorldMetadata(wrapMetadata(buildMetadata({ layout }).bytes, 2, version)).details;
    expect(details.generation.lastPlayed === undefined).toBe(version < 284);
    expect(details.generation.specialSeeds.skyblock === undefined).toBe(version < 302);
    expect(details.generation.specialSeeds.vampire === undefined).toBe(version < 288);
    expect(details.generation.specialSeeds.infected === undefined).toBe(version < 296);
    expect(details.generation.specialSeeds.teamSpawns === undefined).toBe(version < 297);
    expect(details.generation.specialSeeds.dualDungeons === undefined).toBe(version < 304);
    expect(details.generation.specialSeeds.moreLightning === undefined).toBe(version < 323);
    expect(details.generation.specialSeeds.noLightning === undefined).toBe(version < 323);
    expect(details.generation.worldGenManifest === undefined).toBe(version < 299);
    expect(details.spawnAndLandmarks.teamSpawns === undefined).toBe(version < 297);
    expect(details.timeAndWeather.holidays.halloweenForever === undefined).toBe(version < 287);
    expect(details.timeAndWeather.holidays.christmasForever === undefined).toBe(version < 287);
    expect(details.timeAndWeather.meteorShowerCount === undefined).toBe(version < 291);
    expect(details.timeAndWeather.coinRain === undefined).toBe(version < 291);
    expect(details.other.claimableBannerLength === undefined).toBe(version < 289);
    expect(details.other.killCountLength).toBe(3);
    expect(details.timeAndWeather.time).toBe(13500.25);
  });

  it("keeps exact UInt64 world generation versions as decimal text", () => {
    expect(read({ worldGenVersion: 0xffffffffffffffffn }).generation.worldGenVersion).toBe("18446744073709551615");
  });

  it.each([
    [621355968000000000n, "1970-01-01T00:00:00.000"],
    [621355968001234567n | (1n << 62n), "1970-01-01T00:00:00.123Z"],
    [621355968001234567n | (2n << 62n), "1970-01-01T00:00:00.123Z"],
    [0n, "0001-01-01T00:00:00.000"],
    [3155378975999999999n | (1n << 62n), "9999-12-31T23:59:59.999Z"],
  ] as const)("normalizes DateTime binary %s without assigning a timezone to unspecified dates", (creationTime, expected) => {
    expect(read({ creationTime, lastPlayed: creationTime }).generation).toMatchObject({ creationTime: expected, lastPlayed: expected });
  });

  it("does not newly reject previously opaque invalid dates", () => {
    const generation = read({ creationTime: -9223372036854775808n, lastPlayed: 9223372036854775807n }).generation;
    expect(generation.creationTime).toBeDefined();
    expect(generation.lastPlayed).toBeUndefined();
  });

  it("decodes weather floats, variable lists and team coordinates without changing the input", () => {
    const file = wrapMetadata(buildMetadata().bytes);
    const before = file.slice();
    const { details } = readWorldMetadata(file);
    expect(details.timeAndWeather).toMatchObject({
      rain: { maximum: 0.75 }, windSpeed: -0.5, cloudCount: 291,
      sandstorm: { severity: 0.125, intendedSeverity: 0.25 }, party: { npcs: [17, 18, 19] },
    });
    expect(details.progression.anglerFinishers).toEqual(["Ålice", "Guide Andrew"]);
    expect(details.generation.treeTopVariations).toEqual(Array.from({ length: 13 }, (_, index) => index));
    expect(details.spawnAndLandmarks.teamSpawns).toEqual([{ x: 10, y: 20 }, { x: -1, y: 32767 }]);
    expect(details.generation.worldGenManifest).toBe('{"passes":["Terrain","Caves","Corruption"]}');
    expect(details.other).toEqual({ killCountLength: 3, claimableBannerLength: 2 });
    expect(file).toEqual(before);
    const backing = new Uint8Array(file.length + 23);
    backing.set(file, 23);
    expect(readWorldMetadata(backing.subarray(23)).details).toEqual(details);
  });

  it("preserves detail groups through tile decoding without per-tile objects", () => {
    const file = wrapMetadata(buildMetadata({ height: 1 }).bytes);
    const { sections, details } = readWorldMetadata(file);
    file.fill(0, sections.tiles.start, sections.tiles.end);
    expect(readWorldTiles(file).details).toEqual(details);
  });

  it.each(["lastPlayed", "treeTopVariations", "teamSpawns"])("cannot read a truncated %s from following tile bytes", (field) => {
    const fixture = buildMetadata();
    const offset = fieldOffset(field);
    expect(() => readWorldMetadata(wrapMetadata(fixture.bytes.subarray(0, offset + 1), 4096)))
      .toThrow(WorldFormatError);
  });
});
