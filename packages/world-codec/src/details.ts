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

export function readWorldDetails(): WorldDetails {
  throw new Error("World details are not implemented");
}
