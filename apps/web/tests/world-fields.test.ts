import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readWorldMetadata, type WorldDetails } from "@studio/world-codec";
import { WORLD_GROUP_IDS, clockTime, formatBytes, formatDate, sizeClass, worldFieldGroups, type WorldField, type WorldFieldGroup } from "../src/panels/world-fields.js";

const fixture = new URL("../../../packages/test-fixtures/worlds/SCCO1.wld", import.meta.url);
const bytes = new Uint8Array(readFileSync(fixture));
const world = readWorldMetadata(bytes);

function group(groups: readonly WorldFieldGroup[], id: string): WorldFieldGroup {
  const found = groups.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no group ${id}`);
  return found;
}

function labels(fields: readonly WorldField[]): string[] {
  return fields.map((field) => field.label);
}

function value(fields: readonly WorldField[], label: string): unknown {
  const field = fields.find((candidate) => candidate.label === label);
  if (field === undefined) throw new Error(`no field ${label}`);
  return field.kind === "point" ? field.point : field.kind === "points" ? field.points : field.value;
}

test("identity and size show exactly the decoded header fields", () => {
  const groups = worldFieldGroups({ ...world, fileSize: bytes.length });
  const identity = group(groups, "identity").fields;
  expect(labels(identity)).toEqual(["Name", "Seed", "GUID", "World ID", "Format version", "Save revision", "Favorite", "File size"]);
  expect(value(identity, "Name")).toBe("SCCR1");
  expect(value(identity, "Seed")).toBe("948580918");
  expect(value(identity, "GUID")).toBe(world.metadata.guid);
  expect(value(identity, "World ID")).toBe(String(world.metadata.worldId));
  expect(value(identity, "Format version")).toBe("326");
  expect(value(identity, "File size")).toBe(formatBytes(bytes.length));

  const size = group(groups, "size").fields;
  expect(value(size, "Size")).toBe("4200 × 1200 tiles");
  expect(value(size, "Size class")).toBe("Small");
  expect(value(size, "Surface level")).toBe(String(world.metadata.surfaceLevel));
  expect(value(size, "Rock level")).toBe(String(world.metadata.rockLevel));
});

test("generation, progression and landmarks come from the decoded details", () => {
  const groups = worldFieldGroups(world);
  const generation = group(groups, "generation").fields;
  expect(value(generation, "Game mode")).toBe("Classic");
  expect(value(generation, "Evil")).toBe("Corruption");
  expect(value(generation, "World-gen version")).toBe(world.details.generation.worldGenVersion);
  expect(value(group(groups, "landmarks").fields, "Spawn")).toEqual(world.details.spawnAndLandmarks.spawn);
  expect(value(group(groups, "landmarks").fields, "Dungeon")).toEqual(world.details.spawnAndLandmarks.dungeon);
  expect(value(group(groups, "bosses").fields, "Moon Lord")).toBe(world.details.progression.bosses.moonLord);
  expect(group(groups, "bosses").fields).toHaveLength(Object.keys(world.details.progression.bosses).length);
  expect(value(group(groups, "progression").fields, "Hardmode")).toBe(world.details.progression.hardmode);
});

/** Every decoded value as a dotted path; arrays are one value; `undefined` (not stored in this version) is none. */
function leafPaths(value: unknown, path: string): string[] {
  if (value === undefined) return [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [path];
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, `${path}.${key}`));
}

test("every decoded metadata and details value has exactly one row", () => {
  const decoded = ["header.version", "header.revision", "header.isFavorite", ...leafPaths(world.metadata, "metadata"), ...leafPaths(world.details, "details")];
  const shown = worldFieldGroups(world).flatMap((candidate) => candidate.fields.flatMap((field) => field.paths));
  expect(new Set(shown)).toEqual(new Set(decoded));
  expect(shown).toHaveLength(new Set(shown).size);
});

test("distinct stored values keep distinct rows", () => {
  const groups = worldFieldGroups(world);
  const time = group(groups, "time").fields;
  const { party, lanternNight, rain, sandstorm } = world.details.timeAndWeather;
  expect(value(time, "Party (manual)")).toBe(party.manual);
  expect(value(time, "Party (genuine)")).toBe(party.genuine);
  expect(value(time, "Lantern night (manual)")).toBe(lanternNight.manual);
  expect(value(time, "Lantern night (genuine)")).toBe(lanternNight.genuine);
  expect(value(time, "Rain time left")).toBe(rain.time.toLocaleString("en-US"));
  expect(value(time, "Sandstorm time left")).toBe(sandstorm.time.toLocaleString("en-US"));
  const events = group(groups, "events").fields;
  expect(value(events, "Pillar active: Solar")).toBe(world.details.progression.activePillars.solar);
  const npcs = group(groups, "npcs").fields;
  expect(value(npcs, "Unlocked: Merchant")).toBe(world.details.progression.unlockedNpcs.merchant);
  expect(value(npcs, "Pet bought: Cat")).toBe(world.details.progression.boughtPets.cat);
});

test("the group ids for Expand all / Collapse all cover every group", () => {
  expect(worldFieldGroups(world).map((candidate) => candidate.id)).toEqual([...WORLD_GROUP_IDS]);
});

test("fields the file's version does not store get no row", () => {
  const details: WorldDetails = {
    ...world.details,
    generation: { ...world.details.generation, lastPlayed: undefined, worldGenManifest: undefined },
    timeAndWeather: {
      ...world.details.timeAndWeather, meteorShowerCount: undefined, coinRain: undefined,
      holidays: { ...world.details.timeAndWeather.holidays, halloweenForever: undefined, christmasForever: undefined },
    },
    spawnAndLandmarks: { ...world.details.spawnAndLandmarks, teamSpawns: undefined },
  };
  const all = worldFieldGroups({ ...world, details }).flatMap((candidate) => labels(candidate.fields));
  for (const absent of ["Last played", "World-gen manifest", "Meteor showers", "Coin rains", "Halloween always", "Christmas always", "Team spawn points"]) {
    expect(all).not.toContain(absent);
  }
  expect(labels(group(worldFieldGroups({ ...world, details: undefined }), "identity").fields)).not.toContain("File size");
});

test("without decoded details only the header groups are shown", () => {
  const groups = worldFieldGroups({ metadata: world.metadata, header: world.header });
  expect(groups.map((candidate) => candidate.id)).toEqual(["identity", "size", "generation"]);
  expect(labels(group(groups, "generation").fields)).toEqual(["Game mode", "Evil"]);
});

test.each([
  [0, true, "4:30 AM"],
  [27000, true, "12:00 PM"],
  [0, false, "7:30 PM"],
  [16200, false, "12:00 AM"],
] as const)("clock time of %i ticks (day %s) is %s", (time, day, expected) => {
  expect(clockTime(time, day)).toBe(expected);
});

test("dates show minutes and their zone", () => {
  expect(formatDate("2026-10-06T09:30:19.905Z")).toBe("2026-10-06 09:30 UTC");
  expect(formatDate("2026-10-06T09:30:19.905")).toBe("2026-10-06 09:30");
});

test("size classes and byte sizes", () => {
  expect(sizeClass(6400, 1800)).toBe("Medium");
  expect(sizeClass(8400, 2400)).toBe("Large");
  expect(sizeClass(4200, 1800)).toBe("Custom");
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(2994409)).toBe("2.86 MiB");
});
