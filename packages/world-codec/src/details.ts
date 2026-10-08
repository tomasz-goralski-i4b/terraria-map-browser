import type { MetadataReader } from "./metadata.js";
import type { WorldMetadataFeatures } from "./world-format.js";

/** Read-only display data; the writer continues to use the original metadata bytes. */
export interface WorldDetails {
  readonly generation: {
    /** Exact UInt64 represented as decimal text, safe for JSON and worker messages. */
    readonly worldGenVersion: string;
    readonly specialSeeds: Readonly<Record<
      "drunk" | "forTheWorthy" | "tenthAnniversary" | "dontStarve" | "notTheBees" | "remix" | "noTraps" | "zenith", boolean>> & {
      readonly skyblock: boolean | undefined;
      readonly vampire: boolean | undefined;
      readonly infected: boolean | undefined;
      readonly teamSpawns: boolean | undefined;
      readonly dualDungeons: boolean | undefined;
      readonly moreLightning: boolean | undefined;
      readonly noLightning: boolean | undefined;
    };
    readonly creationTime: string | undefined;
    readonly lastPlayed: string | undefined;
    readonly moonType: number;
    readonly treeX: readonly number[];
    readonly treeStyles: readonly number[];
    readonly caveBackX: readonly number[];
    readonly caveBackStyles: readonly number[];
    readonly iceBackStyle: number;
    readonly jungleBackStyle: number;
    readonly hellBackStyle: number;
    readonly backgrounds: Readonly<Record<"tree" | "corruption" | "jungle" | "snow" | "hallow" | "crimson" | "desert" | "ocean" | "mushroom" | "underworld", number>>;
    readonly additionalTreeBackgrounds: readonly number[];
    readonly treeTopVariations: readonly number[];
    readonly worldGenManifest: string | undefined;
  };
  readonly spawnAndLandmarks: {
    readonly spawn: WorldPoint;
    readonly dungeon: WorldPoint;
    readonly teamSpawns: readonly WorldPoint[] | undefined;
  };
  readonly timeAndWeather: {
    readonly time: number;
    readonly dayTime: boolean;
    readonly moonPhase: number;
    readonly bloodMoon: boolean;
    readonly eclipse: boolean;
    readonly slimeRainTime: number;
    readonly sundialCooldown: number;
    readonly fastForwardTime: boolean;
    readonly fastForwardToDusk: boolean;
    readonly moondialCooldown: number;
    readonly rain: { readonly active: boolean; readonly time: number; readonly maximum: number };
    readonly cloudBackground: number;
    readonly cloudCount: number;
    readonly windSpeed: number;
    readonly party: { readonly manual: boolean; readonly genuine: boolean; readonly cooldown: number; readonly npcs: readonly number[] };
    readonly sandstorm: { readonly active: boolean; readonly time: number; readonly severity: number; readonly intendedSeverity: number };
    readonly lanternNight: { readonly cooldown: number; readonly genuine: boolean; readonly manual: boolean; readonly nextIsGenuine: boolean };
    readonly holidays: { readonly halloweenToday: boolean; readonly christmasToday: boolean; readonly halloweenForever: boolean | undefined; readonly christmasForever: boolean | undefined };
    readonly meteorShowerCount: number | undefined;
    readonly coinRain: number | undefined;
  };
  readonly progression: {
    readonly hardmode: boolean;
    readonly bosses: Readonly<Record<
      "eyeOfCthulhu" | "eaterOfWorldsOrBrainOfCthulhu" | "skeletron" | "queenBee" | "destroyer" | "twins" | "skeletronPrime" | "anyMechanicalBoss" | "plantera" | "golem" | "kingSlime" |
      "dukeFishron" | "lunaticCultist" | "moonLord" | "pumpking" | "mourningWood" | "iceQueen" | "santaNk1" | "everscream" | "empressOfLight" | "queenSlime" | "deerclops", boolean>>;
    readonly savedNpcs: Readonly<Record<"goblinTinkerer" | "wizard" | "mechanic" | "angler" | "stylist" | "taxCollector" | "golfer" | "tavernkeep", boolean>>;
    readonly defeatedInvasions: Readonly<Record<"goblins" | "clown" | "frostLegion" | "pirates" | "martians" | "oldOnesArmyTier1" | "oldOnesArmyTier2" | "oldOnesArmyTier3", boolean>>;
    readonly defeatedPillars: Readonly<Record<"solar" | "vortex" | "nebula" | "stardust", boolean>>;
    readonly activePillars: Readonly<Record<"solar" | "vortex" | "nebula" | "stardust", boolean>>;
    readonly apocalypse: boolean;
    readonly orbSmashed: boolean;
    readonly spawnMeteor: boolean;
    readonly orbCount: number;
    readonly altarCount: number;
    readonly partyOfDoom: boolean;
    readonly invasion: { readonly delay: number; readonly size: number; readonly type: number; readonly x: number; readonly startSize: number };
    readonly cultistDelay: number;
    readonly hardmodeOres: Readonly<Record<"cobalt" | "mythril" | "adamantite", number>>;
    readonly preHardmodeOres: Readonly<Record<"copper" | "iron" | "silver" | "gold", number>>;
    readonly anglerQuest: number;
    readonly anglerFinishers: readonly string[];
    readonly combatBookUsed: boolean;
    readonly combatBookVolumeTwoUsed: boolean;
    readonly peddlersSatchelUsed: boolean;
    readonly boughtPets: Readonly<Record<"cat" | "dog" | "bunny", boolean>>;
    readonly unlockedNpcs: Readonly<Record<"blueSlime" | "merchant" | "demolitionist" | "partyGirl" | "dyeTrader" | "truffle" | "armsDealer" | "nurse" | "princess" | "greenSlime" | "oldSlime" | "purpleSlime" | "rainbowSlime" | "redSlime" | "yellowSlime" | "copperSlime", boolean>>;
  };
  readonly other: { readonly killCountLength: number; readonly claimableBannerLength: number | undefined };
}

export interface WorldPoint {
  readonly x: number;
  readonly y: number;
}

/** DateTime binary stores ticks in the low 62 bits; local kinds store UTC ticks, not wall-clock ticks.
 * Unspecified kinds retain their wall-clock value with no invented zone. Display precision is milliseconds.
 * Invalid dates were opaque before M4: leave their display undefined rather than changing file admission.
 */
function dateTime(binary: bigint): string | undefined {
  const kind = binary >> 62n;
  let ticks = binary & ((1n << 62n) - 1n);
  // DateTime.ToBinary wraps negative UTC ticks for local dates near year 1.
  if (kind >= 2n && ticks > (1n << 62n) - 864000000000n) ticks -= 1n << 62n;
  if (ticks < -864000000000n || ticks > 3155378975999999999n + (kind >= 2n ? 864000000000n : 0n)) return undefined;
  // bigint division truncates toward zero; negative UTC ticks need the preceding millisecond.
  const wholeMilliseconds = (ticks < 0n ? ticks - 9999n : ticks) / 10000n;
  const milliseconds = Number(wholeMilliseconds) - 62135596800000;
  const iso = new Date(milliseconds).toISOString();
  return kind === 0n ? iso.slice(0, -1) : iso;
}

function booleans<K extends string>(reader: MetadataReader, names: readonly K[]): Record<K, boolean> {
  const values = {} as Record<K, boolean>;
  for (const name of names) values[name] = reader.bool();
  return values;
}

function numbers<K extends string>(reader: MetadataReader, names: readonly K[], size = 4): Record<K, number> {
  const values = {} as Record<K, number>;
  for (const name of names) values[name] = reader.int(size);
  return values;
}

/** Rows 13–59, using the same bounded cursor as the identity/dimension fields.
 * All admitted versions are >=269, so earlier gates are already satisfied; newer gates use the resolver.
 * Flag meanings independently restated from T11, World.FileV2.cs:2059-2107,2150-2182,2204-2209,2319-2365
 * at revision 182031b83ce825719f857a6db4ecb6967118abd3 (docs/file-format.md source register).
 */
export function readWorldDetails(reader: MetadataReader, features: WorldMetadataFeatures, worldGenVersion: string): {
  details: WorldDetails; surfaceLevel: number; rockLevel: number; evil: "corruption" | "crimson";
} {
  const seedFlags = booleans(reader, ["drunk", "forTheWorthy", "tenthAnniversary", "dontStarve", "notTheBees", "remix", "noTraps", "zenith"]);
  const skyblock = features.skyblockSeed ? reader.bool() : undefined;
  const creationTime = dateTime(reader.long());
  const lastPlayed = features.lastPlayed ? dateTime(reader.long()) : undefined;
  const moonType = reader.int(1);
  const treeX = reader.ints(3);
  const treeStyles = reader.ints(4);
  const caveBackX = reader.ints(3);
  const caveBackStyles = reader.ints(4);
  const iceBackStyle = reader.int();
  const jungleBackStyle = reader.int();
  const hellBackStyle = reader.int();
  const spawn = { x: reader.int(), y: reader.int() };
  const surfaceLevel = reader.level("surfaceLevel");
  const rockLevel = reader.level("rockLevel");
  const time = reader.float();
  const dayTime = reader.bool();
  const moonPhase = reader.int();
  const bloodMoon = reader.bool();
  const eclipse = reader.bool();
  const dungeon = { x: reader.int(), y: reader.int() };
  const evil = reader.bool() ? "crimson" : "corruption";
  const initialBosses = booleans(reader, ["eyeOfCthulhu", "eaterOfWorldsOrBrainOfCthulhu", "skeletron", "queenBee", "destroyer", "twins", "skeletronPrime", "anyMechanicalBoss", "plantera", "golem", "kingSlime"]);
  const initialSavedNpcs = booleans(reader, ["goblinTinkerer", "wizard", "mechanic"]);
  const initialInvasions = booleans(reader, ["goblins", "clown", "frostLegion", "pirates"]);
  const orbSmashed = reader.bool();
  const spawnMeteor = reader.bool();
  const orbCount = reader.int(1);
  const altarCount = reader.int();
  const hardmode = reader.bool();
  const partyOfDoom = reader.bool();
  const invasionStart = { delay: reader.int(), size: reader.int(), type: reader.int(), x: reader.float() };
  const slimeRainTime = reader.float();
  const sundialCooldown = reader.int(1);
  const rain = { active: reader.bool(), time: reader.int(), maximum: reader.float(4) };
  const hardmodeOres = numbers(reader, ["cobalt", "mythril", "adamantite"]);
  const initialBackgrounds = numbers(reader, ["tree", "corruption", "jungle", "snow", "hallow", "crimson", "desert", "ocean"], 1);
  const cloudBackground = reader.int();
  const cloudCount = reader.int(2);
  const windSpeed = reader.float(4);
  const anglerFinishers = reader.array("anglerFinishers", 4, 1, () => reader.string("anglerFinishers"));
  const angler = reader.bool();
  const anglerQuest = reader.int();
  const laterSavedNpcs = booleans(reader, ["stylist", "taxCollector", "golfer"]);
  const startSize = reader.int();
  const cultistDelay = reader.int();
  const killCountLength = reader.list("killCounts", 2, 4);
  const claimableBannerLength = features.claimableBanners ? reader.list("claimableBanners", 2, 2) : undefined;
  const fastForwardTime = reader.bool();
  const dukeFishron = reader.bool();
  const martians = reader.bool();
  const seasonalBosses = booleans(reader, ["lunaticCultist", "moonLord", "pumpking", "mourningWood", "iceQueen", "santaNk1", "everscream"]);
  const defeatedPillars = booleans(reader, ["solar", "vortex", "nebula", "stardust"]);
  const activePillars = booleans(reader, ["solar", "vortex", "nebula", "stardust"]);
  const apocalypse = reader.bool();
  const party = { manual: reader.bool(), genuine: reader.bool(), cooldown: reader.int(),
    npcs: reader.array("partyingNpcs", 4, 4, () => reader.int()) };
  const sandstorm = { active: reader.bool(), time: reader.int(), severity: reader.float(4), intendedSeverity: reader.float(4) };
  const tavernkeep = reader.bool();
  const oldOnesArmy = booleans(reader, ["oldOnesArmyTier1", "oldOnesArmyTier2", "oldOnesArmyTier3"]);
  const mushroom = reader.int(1);
  const underworld = reader.int(1);
  const additionalTreeBackgrounds = reader.ints(3, 1);
  const combatBookUsed = reader.bool();
  const lanternNight = { cooldown: reader.int(), genuine: reader.bool(), manual: reader.bool(), nextIsGenuine: reader.bool() };
  const treeTopVariations = reader.array("treeTopVariations", 4, 4, () => reader.int());
  const halloweenToday = reader.bool();
  const christmasToday = reader.bool();
  const preHardmodeOres = numbers(reader, ["copper", "iron", "silver", "gold"]);
  const boughtPets = booleans(reader, ["cat", "dog", "bunny"]);
  const laterBosses = booleans(reader, ["empressOfLight", "queenSlime", "deerclops"]);
  const initialUnlocks = booleans(reader, ["blueSlime", "merchant", "demolitionist", "partyGirl", "dyeTrader", "truffle", "armsDealer", "nurse", "princess"]);
  const combatBookVolumeTwoUsed = reader.bool();
  const peddlersSatchelUsed = reader.bool();
  const slimeUnlocks = booleans(reader, ["greenSlime", "oldSlime", "purpleSlime", "rainbowSlime", "redSlime", "yellowSlime", "copperSlime"]);
  const fastForwardToDusk = reader.bool();
  const moondialCooldown = reader.int(1);
  const halloweenForever = features.permanentHolidays ? reader.bool() : undefined;
  const christmasForever = features.permanentHolidays ? reader.bool() : undefined;
  const vampire = features.vampireSeed ? reader.bool() : undefined;
  const infected = features.infectedSeed ? reader.bool() : undefined;
  const meteorShowerCount = features.eventCounts ? reader.int() : undefined;
  const coinRain = features.eventCounts ? reader.int() : undefined;
  const teamSpawnsSeed = features.teamSpawns ? reader.bool() : undefined;
  const teamSpawns = features.teamSpawns ? reader.array("teamSpawns", 1, 4, () => ({ x: reader.int(2), y: reader.int(2) })) : undefined;
  const dualDungeons = features.dualDungeonsSeed ? reader.bool() : undefined;
  const moreLightning = features.lightningSeeds ? reader.bool() : undefined;
  const noLightning = features.lightningSeeds ? reader.bool() : undefined;
  // Row 58 (299–312) is absent from every admitted released format.
  const worldGenManifest = features.worldGenManifest ? reader.string("worldGenManifest") : undefined;
  const details: WorldDetails = {
    generation: { worldGenVersion, specialSeeds: { ...seedFlags, skyblock, vampire, infected, teamSpawns: teamSpawnsSeed,
      dualDungeons, moreLightning, noLightning }, creationTime, lastPlayed, moonType,
      treeX, treeStyles, caveBackX, caveBackStyles, iceBackStyle, jungleBackStyle, hellBackStyle,
      backgrounds: { ...initialBackgrounds, mushroom, underworld }, additionalTreeBackgrounds, treeTopVariations, worldGenManifest },
    spawnAndLandmarks: { spawn, dungeon, teamSpawns },
    timeAndWeather: { time, dayTime, moonPhase, bloodMoon, eclipse, slimeRainTime, sundialCooldown, fastForwardTime,
      fastForwardToDusk, moondialCooldown, rain, cloudBackground, cloudCount, windSpeed, party, sandstorm, lanternNight,
      holidays: { halloweenToday, christmasToday, halloweenForever, christmasForever }, meteorShowerCount, coinRain },
    progression: { hardmode, bosses: { ...initialBosses, dukeFishron, ...seasonalBosses, ...laterBosses },
      savedNpcs: { ...initialSavedNpcs, angler, ...laterSavedNpcs, tavernkeep },
      defeatedInvasions: { ...initialInvasions, martians, ...oldOnesArmy }, defeatedPillars, activePillars, apocalypse,
      orbSmashed, spawnMeteor, orbCount, altarCount, partyOfDoom, invasion: { ...invasionStart, startSize }, cultistDelay,
      hardmodeOres, preHardmodeOres, anglerQuest, anglerFinishers, combatBookUsed, combatBookVolumeTwoUsed,
      peddlersSatchelUsed, boughtPets, unlockedNpcs: { ...initialUnlocks, ...slimeUnlocks } },
    other: { killCountLength, claimableBannerLength },
  };
  return { details, surfaceLevel, rockLevel, evil };
}
