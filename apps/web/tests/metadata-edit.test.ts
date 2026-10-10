import { expect, test } from "vitest";
import { readWorldTiles, SUPPORTED_VANILLA_FORMATS, writeWorld } from "@studio/world-codec";
import { verifyWrittenWorld } from "../src/world/verify-written.js";
import { writerSource } from "./support/export-source.js";
import { createWorldSession } from "../src/world/world-session.js";
import { parseProperty, propertyOptions, propertyReadOnly, propertyValue } from "../src/world/world-properties.js";
import { worldFieldGroups } from "../src/panels/world-fields.js";
import { resizeWorld } from "../src/world/resize-world.js";
import { useAppStore } from "../src/store.js";

test.each(SUPPORTED_VANILLA_FORMATS)("format %i writes current identity, flags, weather, lists and landmarks", (version) => {
  const world = readWorldTiles(writerSource(2, 4, undefined, version));
  Object.assign(world.metadata, { name: "Copper Coast", seed: "celebrationmk10", worldId: 1743427922, mode: "expert", evil: "crimson" });
  Object.assign(world.details.generation, { moonType: 3 });
  Object.assign(world.details.progression, { hardmode: true, anglerFinishers: ["Guide Andrew", "Angler Finley"] });
  Object.assign(world.details.timeAndWeather, { time: 21600, dayTime: false, moonPhase: 4 });
  Object.assign(world.details.spawnAndLandmarks, { spawn: { x: 1, y: 2 } });
  expect(verifyWrittenWorld(world, writeWorld(world))).toBeNull();
});

test("invalid metadata cannot silently truncate a byte or change the source envelope", () => {
  const world = readWorldTiles(writerSource());
  const before = world.envelope.source.slice();
  Object.assign(world.details.generation, { moonType: 256 });
  expect(() => writeWorld(world)).toThrow();
  expect(world.envelope.source).toEqual(before);
});

test("every editable displayed path persists independently without changing its preserved baseline", async () => {
  const initial = readWorldTiles(writerSource());
  const paths = worldFieldGroups(initial).flatMap((group) => group.fields.flatMap((field) => field.paths)).filter((path) => !propertyReadOnly(path));
  for (const path of paths) {
    const world = readWorldTiles(writerSource());
    const session = createWorldSession({ parse: () => Promise.resolve(world) });
    await session.open(new File([writerSource()], "Copper Coast.wld"));
    const previous = propertyValue(world, path);
    const choices = propertyOptions(path, previous);
    let value: unknown = choices?.find((choice) => choice.value !== previous)?.value;
    if (value === undefined) {
      if (Array.isArray(previous)) value = path.endsWith(".teamSpawns") ? [{ x: 1, y: 2 }] : path.endsWith(".anglerFinishers") ? ["Guide Andrew"] : previous.map((entry: unknown) => typeof entry === "number" ? (entry === 1 ? 2 : 1) : entry);
      // The synthetic values (~16.8M) are outside many game ranges; 1 (or 2) fits all of them. Growing the canvas
      // avoids the entity check that shrinking needs.
      else if (typeof previous === "number") value = /^metadata\.(width|height)$/.test(path) ? previous + 1 : previous === 1 ? 2 : 1;
      else value = path.endsWith(".guid") ? "87e466e7853c3f48b75abc85e36d4b87" : /Time$|lastPlayed$/.test(path) ? "2026-10-10T12:30:00.000Z" : path.endsWith(".worldGenVersion") ? "1400159338498" : path.endsWith(".worldGenManifest") ? '{"passes":["Terrain","Caves"]}' : "Copper Coast";
    }
    const text = typeof value === "string" ? value : JSON.stringify(value);
    // Style arrays in the synthetic fixture intentionally contain unknown values: change only to observed choices.
    if (Array.isArray(previous) && Array.isArray(value)) {
      value = value.map((entry: unknown, index) => propertyOptions(`${path}.${String(index)}`, entry)?.[0]?.value ?? entry);
    }
    session.editProperty(path, parseProperty(path, Array.isArray(value) ? JSON.stringify(value) : text, previous));
    const current = session.getLoadedWorld();
    if (current === null) throw new Error("The edited world remains loaded.");
    expect(verifyWrittenWorld(current, writeWorld(current)), path).toBeNull();
    expect(world.envelope.original).toEqual(initial.envelope.original);
    session.reset();
  }
});

test("resizing preserves column-major tiles, initializes empty planes and saves new dimensions", () => {
  const world = readWorldTiles(writerSource(2, 4, [0x42, 1, 3, 0x42, 1, 3]));
  world.planes.paint[5] = 7;
  const resized = resizeWorld(world, 3, 6);
  expect(resized.planes.paint[7]).toBe(7);
  expect(resized.planes.block[4]).toBe(0xffff);
  expect(resized.planes.block[12]).toBe(0xffff);
  expect(resized.planes.frameX[12]).toBe(-1);
  expect(resized.metadata.bounds).toEqual({ left: 0, top: 0, right: 48, bottom: 96 });
  expect(verifyWrittenWorld(resized, writeWorld(resized))).toBeNull();
  expect(world.metadata.width).toBe(2);
  expect(world.planes.paint[5]).toBe(7);
  expect(() => resizeWorld(world, 0, 6)).toThrow();
  expect(() => resizeWorld(world, 65536, 65536)).toThrow();
});

test("an invalid edit is atomic and Singles are normalized before saving", async () => {
  const world = readWorldTiles(writerSource());
  const session = createWorldSession({ parse: () => Promise.resolve(world) });
  await session.open(new File([writerSource()], "Copper Coast.wld"));
  const before = structuredClone(world.metadata);
  expect(() => { session.editProperty("metadata.worldId", 1.5); }).toThrow();
  expect(world.metadata).toEqual(before);
  session.editProperty("details.timeAndWeather.rain.maximum", 0.1);
  expect(world.details.timeAndWeather.rain.maximum).toBe(Math.fround(0.1));
  expect(verifyWrittenWorld(world, writeWorld(world))).toBeNull();
  session.reset();
});

test("edits outside the game's range are refused with the allowed range", async () => {
  const world = readWorldTiles(writerSource());
  const session = createWorldSession({ parse: () => Promise.resolve(world) });
  await session.open(new File([writerSource()], "Copper Coast.wld"));
  const before = structuredClone(world.details);
  expect(() => { session.editProperty("details.timeAndWeather.slimeRainTime", -1.74942e50); }).toThrow(/between/);
  expect(() => { session.editProperty("details.timeAndWeather.windSpeed", 3); }).toThrow(/between -1 and 1/);
  expect(() => { session.editProperty("details.timeAndWeather.rain.time", -5); }).toThrow(/between/);
  expect(() => { session.editProperty("details.spawnAndLandmarks.spawn.x", world.metadata.width); }).toThrow(/between/);
  expect(() => { session.editProperty("metadata.bounds.right", 1); }).toThrow();
  expect(world.details).toEqual(before);
  session.editProperty("details.timeAndWeather.slimeRainTime", -86400);
  expect(world.details.timeAndWeather.slimeRainTime).toBe(-86400);
  session.reset();
});

test("a metadata edit keeps the world revision, so plane-built views are not rebuilt", async () => {
  const world = readWorldTiles(writerSource());
  const session = createWorldSession({ parse: () => Promise.resolve(world) });
  await session.open(new File([writerSource()], "Copper Coast.wld"));
  const revision = useAppStore.getState().worldRevision;
  session.editProperty("metadata.name", "Tin Coast");
  expect(useAppStore.getState().summary?.name).toBe("Tin Coast");
  expect(useAppStore.getState().worldRevision).toBe(revision);
  session.editProperty("metadata.surfaceLevel", 2);
  expect(useAppStore.getState().worldRevision).toBe(revision + 1);
  session.reset();
});
