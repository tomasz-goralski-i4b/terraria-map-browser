import { MetadataReader, readMetadataSection, readWorldMetadata, type WorldMetadataResult } from "./metadata.js";
import { resolveWorldFormat } from "./world-format.js";
import { WorldFormatError } from "./world-format-error.js";

/** Bounded primitive encodings; invalid edits must never wrap or silently truncate. */
class MetadataWriter {
  private readonly chunks: Uint8Array[] = [];
  int(value: number, size = 4): void {
    const min = size === 1 ? 0 : -(2 ** (size * 8 - 1));
    const max = size === 1 ? 255 : 2 ** (size * 8 - 1) - 1;
    if (!Number.isInteger(value) || value < min || value > max) this.fail("integer out of range");
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    if (size === 1) view.setUint8(0, value);
    else if (size === 2) view.setInt16(0, value, true);
    else view.setInt32(0, value, true);
    this.raw(bytes);
  }
  float(value: number, size: 4 | 8 = 8): void {
    if (!Number.isFinite(value) || (size === 4 && !Number.isFinite(Math.fround(value)))) this.fail("non-finite number");
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    if (size === 4) view.setFloat32(0, value, true);
    else view.setFloat64(0, value, true);
    this.raw(bytes);
  }
  long(value: bigint): void {
    if (value < 0n || value > 0xffffffffffffffffn) this.fail("UInt64 out of range");
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, true);
    this.raw(bytes);
  }
  bool(value: boolean): void {
    if (typeof value !== "boolean") this.fail("invalid boolean");
    this.int(value ? 1 : 0, 1);
  }
  string(value: string, cap = 1048576): void {
    const bytes = new TextEncoder().encode(value);
    if (bytes.length > cap || new TextDecoder().decode(bytes) !== value) this.fail("invalid or oversized string");
    let length = bytes.length;
    do {
      this.int((length % 128) | (length >= 128 ? 128 : 0), 1);
      length = Math.floor(length / 128);
    } while (length > 0);
    this.raw(bytes);
  }
  ints(values: readonly number[], size = 4, count?: number): void {
    if (count !== undefined && values.length !== count) this.fail("invalid fixed array length");
    for (const value of values) this.int(value, size);
  }
  flags(values: Readonly<Record<string, boolean | undefined>>, keys: readonly string[]): void {
    for (const key of keys) {
      const value = values[key];
      if (value === undefined) this.fail(`missing flag ${key}`);
      this.bool(value);
    }
  }
  raw(bytes: Uint8Array): void { this.chunks.push(bytes); }
  finish(): Uint8Array {
    const output = new Uint8Array(this.chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of this.chunks) { output.set(chunk, offset); offset += chunk.length; }
    return output;
  }
  fail(reason: string): never { throw new WorldFormatError("UnsupportedWrite", 0, reason); }
}

/** Original DateTime binaries retain sub-millisecond ticks and kind unless explicitly edited. */
function dateBinary(value: string | undefined, original: string | undefined, raw: bigint, writer: MetadataWriter): bigint {
  if (value === original) return raw;
  if (value === undefined || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z?$/.test(value)) writer.fail("use an ISO date with millisecond precision");
  const milliseconds = Date.parse(value.endsWith("Z") ? value : `${value}Z`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== (value.endsWith("Z") ? value : `${value}Z`)) writer.fail("invalid date");
  const ticks = BigInt(milliseconds) * 10000n + 621355968000000000n;
  if (ticks < 0n || ticks > 3155378975999999999n) writer.fail("date out of range");
  return ticks | (value.endsWith("Z") ? 1n << 62n : 0n);
}

export function writeWorldMetadata(world: WorldMetadataResult, source: Uint8Array, original: WorldMetadataResult): Uint8Array {
  const writer = new MetadataWriter();
  const profile = resolveWorldFormat(world.header.version);
  if (profile === null) return writer.fail("unsupported format");
  const f = profile.metadata;
  const m = world.metadata;
  const { generation: g, timeAndWeather: w, progression: p, spawnAndLandmarks: l } = world.details;
  const reader = new MetadataReader(source, original.sections.metadata.start, original.sections.metadata.end);
  reader.string("name"); reader.string("seed"); reader.long(); reader.guid(); reader.skip(4 * 8);
  reader.skip(f.skyblockSeed ? 9 : 8);
  const creation = reader.long();
  const lastPlayed = f.lastPlayed ? reader.long() : 0n;
  writer.string(m.name, 4096); writer.string(m.seed, 4096); writer.long(BigInt(g.worldGenVersion));
  if (!/^[0-9a-f]{32}$/.test(m.guid)) writer.fail("GUID must contain 32 lowercase hexadecimal digits");
  writer.raw(Uint8Array.from(m.guid.match(/../g) ?? [], (pair) => parseInt(pair, 16)));
  writer.int(m.worldId);
  writer.ints([m.bounds.left, m.bounds.right, m.bounds.top, m.bounds.bottom, m.height, m.width]);
  const modes = ["classic", "expert", "master", "journey"];
  writer.int(typeof m.mode === "string" ? modes.indexOf(m.mode) : m.mode.raw);
  writer.flags(g.specialSeeds, ["drunk", "forTheWorthy", "tenthAnniversary", "dontStarve", "notTheBees", "remix", "noTraps", "zenith"]);
  if (f.skyblockSeed) writer.flags(g.specialSeeds, ["skyblock"]);
  writer.long(dateBinary(g.creationTime, original.details.generation.creationTime, creation, writer));
  if (f.lastPlayed) writer.long(dateBinary(g.lastPlayed, original.details.generation.lastPlayed, lastPlayed, writer));
  writer.int(g.moonType, 1);
  writer.ints(g.treeX, 4, 3); writer.ints(g.treeStyles, 4, 4); writer.ints(g.caveBackX, 4, 3); writer.ints(g.caveBackStyles, 4, 4);
  writer.ints([g.iceBackStyle, g.jungleBackStyle, g.hellBackStyle, l.spawn.x, l.spawn.y]);
  writer.float(m.surfaceLevel); writer.float(m.rockLevel); writer.float(w.time); writer.bool(w.dayTime); writer.int(w.moonPhase);
  writer.bool(w.bloodMoon); writer.bool(w.eclipse); writer.ints([l.dungeon.x, l.dungeon.y]); writer.bool(m.evil === "crimson");
  writer.flags(p.bosses, ["eyeOfCthulhu", "eaterOfWorldsOrBrainOfCthulhu", "skeletron", "queenBee", "destroyer", "twins", "skeletronPrime", "anyMechanicalBoss", "plantera", "golem", "kingSlime"]);
  writer.flags(p.savedNpcs, ["goblinTinkerer", "wizard", "mechanic"]);
  writer.flags(p.defeatedInvasions, ["goblins", "clown", "frostLegion", "pirates"]);
  writer.bool(p.orbSmashed); writer.bool(p.spawnMeteor); writer.int(p.orbCount, 1); writer.int(p.altarCount); writer.bool(p.hardmode); writer.bool(p.partyOfDoom);
  writer.ints([p.invasion.delay, p.invasion.size, p.invasion.type]); writer.float(p.invasion.x); writer.float(w.slimeRainTime); writer.int(w.sundialCooldown, 1);
  writer.bool(w.rain.active); writer.int(w.rain.time); writer.float(w.rain.maximum, 4);
  writer.ints([p.hardmodeOres.cobalt, p.hardmodeOres.mythril, p.hardmodeOres.adamantite]);
  for (const key of ["tree", "corruption", "jungle", "snow", "hallow", "crimson", "desert", "ocean"] as const) writer.int(g.backgrounds[key], 1);
  writer.int(w.cloudBackground); writer.int(w.cloudCount, 2); writer.float(w.windSpeed, 4);
  writer.int(p.anglerFinishers.length); for (const name of p.anglerFinishers) writer.string(name);
  writer.flags(p.savedNpcs, ["angler"]); writer.int(p.anglerQuest); writer.flags(p.savedNpcs, ["stylist", "taxCollector", "golfer"]);
  writer.ints([p.invasion.startSize, p.cultistDelay]);
  // These indexed records are independent of the display counts.
  writer.int(world.details.other.killCounts.length, 2); writer.ints(world.details.other.killCounts);
  if (f.claimableBanners) { const banners = world.details.other.claimableBanners; if (banners === undefined) return writer.fail("missing banners"); writer.int(banners.length, 2); writer.ints(banners, 2); }
  writer.bool(w.fastForwardTime); writer.flags(p.bosses, ["dukeFishron"]); writer.flags(p.defeatedInvasions, ["martians"]);
  writer.flags(p.bosses, ["lunaticCultist", "moonLord", "pumpking", "mourningWood", "iceQueen", "santaNk1", "everscream"]);
  writer.flags(p.defeatedPillars, ["solar", "vortex", "nebula", "stardust"]); writer.flags(p.activePillars, ["solar", "vortex", "nebula", "stardust"]); writer.bool(p.apocalypse);
  writer.bool(w.party.manual); writer.bool(w.party.genuine); writer.int(w.party.cooldown); writer.int(w.party.npcs.length); writer.ints(w.party.npcs);
  writer.bool(w.sandstorm.active); writer.int(w.sandstorm.time); writer.float(w.sandstorm.severity, 4); writer.float(w.sandstorm.intendedSeverity, 4);
  writer.flags(p.savedNpcs, ["tavernkeep"]); writer.flags(p.defeatedInvasions, ["oldOnesArmyTier1", "oldOnesArmyTier2", "oldOnesArmyTier3"]);
  writer.int(g.backgrounds.mushroom, 1); writer.int(g.backgrounds.underworld, 1); writer.ints(g.additionalTreeBackgrounds, 1, 3); writer.bool(p.combatBookUsed);
  writer.int(w.lanternNight.cooldown); writer.bool(w.lanternNight.genuine); writer.bool(w.lanternNight.manual); writer.bool(w.lanternNight.nextIsGenuine);
  writer.int(g.treeTopVariations.length); writer.ints(g.treeTopVariations);
  writer.bool(w.holidays.halloweenToday); writer.bool(w.holidays.christmasToday);
  writer.ints([p.preHardmodeOres.copper, p.preHardmodeOres.iron, p.preHardmodeOres.silver, p.preHardmodeOres.gold]);
  writer.flags(p.boughtPets, ["cat", "dog", "bunny"]); writer.flags(p.bosses, ["empressOfLight", "queenSlime", "deerclops"]);
  writer.flags(p.unlockedNpcs, ["blueSlime", "merchant", "demolitionist", "partyGirl", "dyeTrader", "truffle", "armsDealer", "nurse", "princess"]);
  writer.bool(p.combatBookVolumeTwoUsed); writer.bool(p.peddlersSatchelUsed);
  writer.flags(p.unlockedNpcs, ["greenSlime", "oldSlime", "purpleSlime", "rainbowSlime", "redSlime", "yellowSlime", "copperSlime"]);
  writer.bool(w.fastForwardToDusk); writer.int(w.moondialCooldown, 1);
  if (f.permanentHolidays) writer.flags(w.holidays, ["halloweenForever", "christmasForever"]);
  if (f.vampireSeed) writer.flags(g.specialSeeds, ["vampire"]);
  if (f.infectedSeed) writer.flags(g.specialSeeds, ["infected"]);
  if (f.eventCounts) { if (w.meteorShowerCount === undefined || w.coinRain === undefined) return writer.fail("missing event counts"); writer.ints([w.meteorShowerCount, w.coinRain]); }
  if (f.teamSpawns) {
    writer.flags(g.specialSeeds, ["teamSpawns"]);
    if (l.teamSpawns === undefined) return writer.fail("missing team spawns");
    writer.int(l.teamSpawns.length, 1); for (const point of l.teamSpawns) writer.ints([point.x, point.y], 2);
  }
  if (f.dualDungeonsSeed) writer.flags(g.specialSeeds, ["dualDungeons"]);
  if (f.lightningSeeds) writer.flags(g.specialSeeds, ["moreLightning", "noLightning"]);
  if (f.worldGenManifest) { if (g.worldGenManifest === undefined) return writer.fail("missing manifest"); writer.string(g.worldGenManifest); }
  return writer.finish();
}

export function writeWorldFooter(name: string, worldId: number): Uint8Array {
  const writer = new MetadataWriter();
  writer.bool(true); writer.string(name, 4096); writer.int(worldId);
  return writer.finish();
}

/** Validate and normalize small edited records (notably Singles) without re-encoding any tile plane. */
export function normalizeWorldMetadata(world: WorldMetadataResult, source: Uint8Array): Pick<WorldMetadataResult, "metadata" | "details"> {
  const original = readWorldMetadata(source);
  const metadata = writeWorldMetadata(world, source, original);
  const normalized = readMetadataSection(metadata, { ...original, sections: { ...original.sections, metadata: { start: 0, end: metadata.length } } });
  return { metadata: normalized.metadata, details: normalized.details };
}
