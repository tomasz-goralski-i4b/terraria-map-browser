import type { WorldDetails, WorldMetadata, WorldPoint } from "@studio/world-codec";

/**
 * One row of the World panel. Only decoded values become rows: a field the file's version lacks has none.
 * `paths` names the decoded values the row shows (`metadata.name`, `details.timeAndWeather.rain.time`), so tests can
 * prove every decoded value has a row.
 */
export type WorldField = { readonly label: string; readonly paths: readonly string[] } & (
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "flag"; readonly value: boolean }
  | { readonly kind: "point"; readonly point: WorldPoint }
  | { readonly kind: "points"; readonly points: readonly WorldPoint[] }
);

export interface WorldFieldGroup {
  readonly id: string;
  readonly title: string;
  readonly fields: readonly WorldField[];
}

/** Every group id the World panel can show, in display order (for Expand all / Collapse all). */
export const WORLD_GROUP_IDS = [
  "identity", "size", "generation", "seeds", "time", "progression", "bosses", "events", "npcs", "landmarks", "ores", "backgrounds",
] as const;

export interface WorldFieldsInput {
  readonly metadata: WorldMetadata;
  readonly header: { readonly version: number; readonly revision?: number; readonly isFavorite?: boolean };
  readonly details?: WorldDetails | undefined;
  readonly fileSize?: number | undefined;
}

const text = (label: string, value: string, ...paths: string[]): WorldField => ({ kind: "text", label, value, paths });
const flag = (label: string, value: boolean, path: string): WorldField => ({ kind: "flag", label, value, paths: [path] });
const integer = (value: number): string => value.toLocaleString("en-US");
const decimal = (value: number): string => (Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, ""));
const list = (values: readonly (number | string)[]): string => (values.length === 0 ? "None" : values.join(", "));

/** Rows for the values that exist; `undefined` (not in this file's version) yields no row. */
function optional<T>(value: T | undefined, row: (value: T) => WorldField): WorldField[] {
  return value === undefined ? [] : [row(value)];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  const units = ["KiB", "MiB", "GiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unit] ?? "GiB"}`;
}

/** `2026-10-06T09:30:19.905Z` → `2026-10-06 09:30 UTC`; a date without a zone stays without one. */
export function formatDate(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (match === null) return iso;
  return `${match[1] ?? ""} ${match[2] ?? ""}${iso.endsWith("Z") ? " UTC" : ""}`;
}

/** Terraria's three preset sizes; anything else was made with a custom size. */
export function sizeClass(width: number, height: number): string {
  if (width === 4200 && height === 1200) return "Small";
  if (width === 6400 && height === 1800) return "Medium";
  if (width === 8400 && height === 2400) return "Large";
  return "Custom";
}

function modeName(mode: WorldMetadata["mode"]): string {
  if (typeof mode !== "string") return `Unknown (${String(mode.raw)})`;
  return { classic: "Classic", expert: "Expert", master: "Master", journey: "Journey" }[mode];
}

/** In-game clock: a day starts at 4:30 AM and a night at 7:30 PM; `time` counts ticks (60 per in-game minute). */
export function clockTime(time: number, dayTime: boolean): string {
  const minutes = Math.floor(((dayTime ? 4.5 * 60 : 19.5 * 60) + time / 60) % (24 * 60));
  const hours = Math.floor(minutes / 60);
  const suffix = hours < 12 ? "AM" : "PM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${String(hour12)}:${String(minutes % 60).padStart(2, "0")} ${suffix}`;
}

const MOON_PHASES = ["Full moon", "Waning gibbous", "Third quarter", "Waning crescent", "New moon", "Waxing crescent", "First quarter", "Waxing gibbous"];

/** Ore tile ids each world chose (public tile ids); -1 means the world has not chosen yet. */
const ORE_NAMES: Readonly<Record<number, string>> = {
  6: "Iron", 7: "Copper", 8: "Gold", 9: "Silver", 107: "Cobalt", 108: "Mythril", 111: "Adamantite",
  166: "Tin", 167: "Lead", 168: "Tungsten", 169: "Platinum", 221: "Palladium", 222: "Orichalcum", 223: "Titanium",
};

function ore(id: number): string {
  if (id < 0) return "Not chosen yet";
  return ORE_NAMES[id] ?? `Tile ${String(id)}`;
}

/** `oldOnesArmyTier1` → `Old ones army tier 1`, for keys without a curated name. */
export function humanize(key: string): string {
  const words = key.replace(/([a-z])([A-Z0-9])/g, "$1 $2").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const SEED_NAMES: Readonly<Record<keyof WorldDetails["generation"]["specialSeeds"], string>> = {
  drunk: "Drunk world", forTheWorthy: "For the worthy", tenthAnniversary: "Celebrationmk10", dontStarve: "The Constant",
  notTheBees: "Not the bees", remix: "Don't dig up", noTraps: "No traps", zenith: "Get fixed boi", skyblock: "Skyblock",
  vampire: "Vampire", infected: "Infected", teamSpawns: "Team spawns", dualDungeons: "Dual dungeons",
  moreLightning: "More lightning", noLightning: "No lightning",
};

const BOSS_NAMES: Readonly<Record<keyof WorldDetails["progression"]["bosses"], string>> = {
  kingSlime: "King Slime", eyeOfCthulhu: "Eye of Cthulhu", eaterOfWorldsOrBrainOfCthulhu: "Eater of Worlds / Brain of Cthulhu",
  queenBee: "Queen Bee", skeletron: "Skeletron", deerclops: "Deerclops", queenSlime: "Queen Slime", destroyer: "The Destroyer",
  twins: "The Twins", skeletronPrime: "Skeletron Prime", anyMechanicalBoss: "Any mechanical boss", plantera: "Plantera",
  golem: "Golem", dukeFishron: "Duke Fishron", empressOfLight: "Empress of Light", lunaticCultist: "Lunatic Cultist",
  moonLord: "Moon Lord", mourningWood: "Mourning Wood", pumpking: "Pumpking", everscream: "Everscream",
  santaNk1: "Santa-NK1", iceQueen: "Ice Queen",
};

const NPC_NAMES: Readonly<Record<keyof WorldDetails["progression"]["savedNpcs"], string>> = {
  goblinTinkerer: "Goblin Tinkerer", wizard: "Wizard", mechanic: "Mechanic", angler: "Angler", stylist: "Stylist",
  taxCollector: "Tax Collector", golfer: "Golfer", tavernkeep: "Tavernkeep",
};

const INVASION_NAMES: Readonly<Record<keyof WorldDetails["progression"]["defeatedInvasions"], string>> = {
  goblins: "Goblin Army", frostLegion: "Frost Legion", pirates: "Pirate Invasion", martians: "Martian Madness",
  clown: "Clown", oldOnesArmyTier1: "Old One's Army, tier 1", oldOnesArmyTier2: "Old One's Army, tier 2",
  oldOnesArmyTier3: "Old One's Army, tier 3",
};

const PILLAR_NAMES = { solar: "Solar", vortex: "Vortex", nebula: "Nebula", stardust: "Stardust" } as const;

/** One flag row per key, in the order of `names` (progression order, not file order). */
function flags<K extends string>(
  values: Readonly<Record<K, boolean | undefined>>, names: Readonly<Record<K, string>>, path: string, prefix = "",
): WorldField[] {
  return (Object.keys(names) as K[]).flatMap((key) => optional<boolean>(values[key], (value) => flag(`${prefix}${names[key]}`, value, `${path}.${key}`)));
}

/** Flag rows for every key of a record, named by `humanize`. */
function allFlags<K extends string>(values: Readonly<Record<K, boolean>>, path: string, prefix = ""): WorldField[] {
  return (Object.keys(values) as K[]).map((key) => flag(`${prefix}${humanize(key)}`, values[key], `${path}.${key}`));
}

function detailGroups(details: WorldDetails, metadata: WorldMetadata): WorldFieldGroup[] {
  const { generation, timeAndWeather: weather, progression, spawnAndLandmarks: landmarks, other } = details;
  const g = "details.generation";
  const w = "details.timeAndWeather";
  const p = "details.progression";
  const l = "details.spawnAndLandmarks";
  return [
    {
      id: "generation", title: "Generation", fields: [
        text("Game mode", modeName(metadata.mode), "metadata.mode"),
        text("Evil", metadata.evil === "crimson" ? "Crimson" : "Corruption", "metadata.evil"),
        ...optional(generation.creationTime, (value) => text("Created", formatDate(value), `${g}.creationTime`)),
        ...optional(generation.lastPlayed, (value) => text("Last played", formatDate(value), `${g}.lastPlayed`)),
        text("World-gen version", generation.worldGenVersion, `${g}.worldGenVersion`),
        text("Moon type", String(generation.moonType), `${g}.moonType`),
        ...optional(generation.worldGenManifest, (value) => text("World-gen manifest", value, `${g}.worldGenManifest`)),
      ],
    },
    { id: "seeds", title: "Special seeds", fields: flags(generation.specialSeeds, SEED_NAMES, `${g}.specialSeeds`) },
    {
      id: "time", title: "Time & weather", fields: [
        text("Time", `${clockTime(weather.time, weather.dayTime)} (${weather.dayTime ? "day" : "night"}, ${decimal(weather.time)} ticks)`, `${w}.time`, `${w}.dayTime`),
        text("Moon phase", MOON_PHASES[weather.moonPhase] ?? `Phase ${String(weather.moonPhase)}`, `${w}.moonPhase`),
        flag("Blood moon", weather.bloodMoon, `${w}.bloodMoon`),
        flag("Solar eclipse", weather.eclipse, `${w}.eclipse`),
        flag("Raining", weather.rain.active, `${w}.rain.active`),
        text("Rain time left", integer(weather.rain.time), `${w}.rain.time`),
        text("Rain intensity", decimal(weather.rain.maximum), `${w}.rain.maximum`),
        flag("Sandstorm", weather.sandstorm.active, `${w}.sandstorm.active`),
        text("Sandstorm time left", integer(weather.sandstorm.time), `${w}.sandstorm.time`),
        text("Sandstorm severity", decimal(weather.sandstorm.severity), `${w}.sandstorm.severity`),
        text("Sandstorm target severity", decimal(weather.sandstorm.intendedSeverity), `${w}.sandstorm.intendedSeverity`),
        text("Slime rain time", decimal(weather.slimeRainTime), `${w}.slimeRainTime`),
        text("Wind speed", decimal(weather.windSpeed), `${w}.windSpeed`),
        text("Clouds", String(weather.cloudCount), `${w}.cloudCount`),
        text("Cloud background", String(weather.cloudBackground), `${w}.cloudBackground`),
        flag("Party (manual)", weather.party.manual, `${w}.party.manual`),
        flag("Party (genuine)", weather.party.genuine, `${w}.party.genuine`),
        text("Party cooldown", integer(weather.party.cooldown), `${w}.party.cooldown`),
        text("Partying NPCs", list(weather.party.npcs), `${w}.party.npcs`),
        flag("Lantern night (manual)", weather.lanternNight.manual, `${w}.lanternNight.manual`),
        flag("Lantern night (genuine)", weather.lanternNight.genuine, `${w}.lanternNight.genuine`),
        flag("Next lantern night genuine", weather.lanternNight.nextIsGenuine, `${w}.lanternNight.nextIsGenuine`),
        text("Lantern night cooldown", integer(weather.lanternNight.cooldown), `${w}.lanternNight.cooldown`),
        flag("Halloween today", weather.holidays.halloweenToday, `${w}.holidays.halloweenToday`),
        flag("Christmas today", weather.holidays.christmasToday, `${w}.holidays.christmasToday`),
        ...optional(weather.holidays.halloweenForever, (value) => flag("Halloween always", value, `${w}.holidays.halloweenForever`)),
        ...optional(weather.holidays.christmasForever, (value) => flag("Christmas always", value, `${w}.holidays.christmasForever`)),
        flag("Fast-forward time (sundial)", weather.fastForwardTime, `${w}.fastForwardTime`),
        text("Sundial cooldown", String(weather.sundialCooldown), `${w}.sundialCooldown`),
        flag("Fast-forward to dusk (moondial)", weather.fastForwardToDusk, `${w}.fastForwardToDusk`),
        text("Moondial cooldown", String(weather.moondialCooldown), `${w}.moondialCooldown`),
        ...optional(weather.meteorShowerCount, (value) => text("Meteor showers", integer(value), `${w}.meteorShowerCount`)),
        ...optional(weather.coinRain, (value) => text("Coin rains", integer(value), `${w}.coinRain`)),
      ],
    },
    {
      id: "progression", title: "Progression", fields: [
        flag("Hardmode", progression.hardmode, `${p}.hardmode`),
        flag("Shadow orb smashed", progression.orbSmashed, `${p}.orbSmashed`),
        text("Shadow orbs smashed", String(progression.orbCount), `${p}.orbCount`),
        flag("Meteor due", progression.spawnMeteor, `${p}.spawnMeteor`),
        text("Altars smashed", String(progression.altarCount), `${p}.altarCount`),
        flag("Party of doom", progression.partyOfDoom, `${p}.partyOfDoom`),
        flag("Lunar events", progression.apocalypse, `${p}.apocalypse`),
        text("Cultist delay", integer(progression.cultistDelay), `${p}.cultistDelay`),
        text("Angler quest", String(progression.anglerQuest), `${p}.anglerQuest`),
        text("Angler quest finished by", list(progression.anglerFinishers), `${p}.anglerFinishers`),
        flag("Combat book", progression.combatBookUsed, `${p}.combatBookUsed`),
        flag("Combat book volume 2", progression.combatBookVolumeTwoUsed, `${p}.combatBookVolumeTwoUsed`),
        flag("Peddler's satchel", progression.peddlersSatchelUsed, `${p}.peddlersSatchelUsed`),
        text("Invasion type", String(progression.invasion.type), `${p}.invasion.type`),
        text("Invasion size", `${integer(progression.invasion.size)} of ${integer(progression.invasion.startSize)}`, `${p}.invasion.size`, `${p}.invasion.startSize`),
        text("Invasion delay", integer(progression.invasion.delay), `${p}.invasion.delay`),
        text("Invasion position", decimal(progression.invasion.x), `${p}.invasion.x`),
        text("Kill counts stored", integer(other.killCountLength), "details.other.killCountLength"),
        text("Kill counts", list(other.killCounts), "details.other.killCounts"),
        ...optional(other.claimableBannerLength, (value) => text("Claimable banners stored", integer(value), "details.other.claimableBannerLength")),
        ...optional(other.claimableBanners, (value) => text("Claimable banners", list(value), "details.other.claimableBanners")),
      ],
    },
    { id: "bosses", title: "Bosses", fields: flags(progression.bosses, BOSS_NAMES, `${p}.bosses`) },
    {
      id: "events", title: "Invasions & pillars", fields: [
        ...flags(progression.defeatedInvasions, INVASION_NAMES, `${p}.defeatedInvasions`),
        ...flags(progression.defeatedPillars, PILLAR_NAMES, `${p}.defeatedPillars`, "Pillar defeated: "),
        ...flags(progression.activePillars, PILLAR_NAMES, `${p}.activePillars`, "Pillar active: "),
      ],
    },
    {
      id: "npcs", title: "NPCs & pets", fields: [
        ...flags(progression.savedNpcs, NPC_NAMES, `${p}.savedNpcs`, "Rescued: "),
        ...allFlags(progression.unlockedNpcs, `${p}.unlockedNpcs`, "Unlocked: "),
        ...allFlags(progression.boughtPets, `${p}.boughtPets`, "Pet bought: "),
      ],
    },
    {
      id: "landmarks", title: "Spawn & landmarks", fields: [
        { kind: "point", label: "Spawn", point: landmarks.spawn, paths: [`${l}.spawn.x`, `${l}.spawn.y`] },
        { kind: "point", label: "Dungeon", point: landmarks.dungeon, paths: [`${l}.dungeon.x`, `${l}.dungeon.y`] },
        ...optional(landmarks.teamSpawns, (points): WorldField => ({ kind: "points", label: "Team spawn points", points, paths: [`${l}.teamSpawns`] })),
      ],
    },
    {
      id: "ores", title: "Ores", fields: [
        ...(Object.keys(progression.preHardmodeOres) as (keyof typeof progression.preHardmodeOres)[]).map((key) =>
          text(`${humanize(key)} tier`, ore(progression.preHardmodeOres[key]), `${p}.preHardmodeOres.${key}`)),
        ...(Object.keys(progression.hardmodeOres) as (keyof typeof progression.hardmodeOres)[]).map((key) =>
          text(`${humanize(key)} tier`, ore(progression.hardmodeOres[key]), `${p}.hardmodeOres.${key}`)),
      ],
    },
    {
      id: "backgrounds", title: "Backgrounds", fields: [
        ...(Object.keys(generation.backgrounds) as (keyof typeof generation.backgrounds)[]).map((key) =>
          text(`${humanize(key)} background`, String(generation.backgrounds[key]), `${g}.backgrounds.${key}`)),
        text("Tree boundaries (x)", list(generation.treeX), `${g}.treeX`),
        text("Tree styles", list(generation.treeStyles), `${g}.treeStyles`),
        text("Extra tree backgrounds", list(generation.additionalTreeBackgrounds), `${g}.additionalTreeBackgrounds`),
        text("Tree top variations", list(generation.treeTopVariations), `${g}.treeTopVariations`),
        text("Cave boundaries (x)", list(generation.caveBackX), `${g}.caveBackX`),
        text("Cave styles", list(generation.caveBackStyles), `${g}.caveBackStyles`),
        text("Ice cave style", String(generation.iceBackStyle), `${g}.iceBackStyle`),
        text("Jungle cave style", String(generation.jungleBackStyle), `${g}.jungleBackStyle`),
        text("Underworld style", String(generation.hellBackStyle), `${g}.hellBackStyle`),
      ],
    },
  ];
}

/** The World panel's groups for a loaded world, built from its decoded metadata only. */
export function worldFieldGroups(world: WorldFieldsInput): WorldFieldGroup[] {
  const { metadata, header, details, fileSize } = world;
  const { bounds } = metadata;
  const groups: WorldFieldGroup[] = [
    {
      id: "identity", title: "Identity", fields: [
        text("Name", metadata.name, "metadata.name"),
        text("Seed", metadata.seed, "metadata.seed"),
        text("GUID", metadata.guid, "metadata.guid"),
        text("World ID", String(metadata.worldId), "metadata.worldId"),
        text("Format version", String(header.version), "header.version"),
        ...optional(header.revision, (value) => text("Save revision", String(value), "header.revision")),
        ...optional(header.isFavorite, (value) => flag("Favorite", value, "header.isFavorite")),
        ...optional(fileSize, (value) => text("File size", formatBytes(value), "file.size")),
      ],
    },
    {
      id: "size", title: "Size & layers", fields: [
        text("Size", `${String(metadata.width)} × ${String(metadata.height)} tiles`, "metadata.width", "metadata.height"),
        text("Size class", sizeClass(metadata.width, metadata.height)),
        text("Surface level", String(metadata.surfaceLevel), "metadata.surfaceLevel"),
        text("Rock level", String(metadata.rockLevel), "metadata.rockLevel"),
        text(
          "Bounds (px)", `${String(bounds.left)}, ${String(bounds.top)} – ${String(bounds.right)}, ${String(bounds.bottom)}`,
          "metadata.bounds.left", "metadata.bounds.top", "metadata.bounds.right", "metadata.bounds.bottom",
        ),
      ],
    },
  ];
  if (details === undefined) {
    groups.push({ id: "generation", title: "Generation", fields: [
      text("Game mode", modeName(metadata.mode), "metadata.mode"),
      text("Evil", metadata.evil === "crimson" ? "Crimson" : "Corruption", "metadata.evil"),
    ] });
    return groups;
  }
  return [...groups, ...detailGroups(details, metadata)];
}
