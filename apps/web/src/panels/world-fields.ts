import type { WorldDetails, WorldMetadata, WorldPoint } from "@studio/world-codec";

/** One row of the World panel. Only decoded values become rows: a field the file's version lacks has none. */
export type WorldField =
  | { readonly kind: "text"; readonly label: string; readonly value: string }
  | { readonly kind: "flag"; readonly label: string; readonly value: boolean }
  | { readonly kind: "point"; readonly label: string; readonly point: WorldPoint };

export interface WorldFieldGroup {
  readonly id: string;
  readonly title: string;
  readonly fields: readonly WorldField[];
}

export interface WorldFieldsInput {
  readonly metadata: WorldMetadata;
  readonly header: { readonly version: number };
  readonly details?: WorldDetails | undefined;
  readonly fileSize?: number | undefined;
}

const text = (label: string, value: string): WorldField => ({ kind: "text", label, value });
const flag = (label: string, value: boolean): WorldField => ({ kind: "flag", label, value });
const integer = (value: number): string => value.toLocaleString("en-US");

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

/** Terraria's three preset sizes; anything else was made with a custom size. */
export function sizeClass(width: number, height: number): string {
  if (width === 4200 && height === 1200) return "Small";
  if (width === 6400 && height === 1800) return "Medium";
  if (width === 8400 && height === 2400) return "Large";
  return "Custom";
}

/** `2026-10-06T09:30:19.905Z` → `2026-10-06 09:30 UTC`; a date without a zone stays without one. */
export function formatDate(iso: string): string {
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso);
  if (match === null) return iso;
  return `${match[1] ?? ""} ${match[2] ?? ""}${iso.endsWith("Z") ? " UTC" : ""}`;
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

/** Flags in the order of `names`, so the checklist reads in progression order, not file order. */
function flags<K extends string>(values: Readonly<Record<K, boolean>>, names: Readonly<Record<K, string>>, prefix = ""): WorldField[] {
  return (Object.keys(names) as K[]).map((key) => flag(`${prefix}${names[key]}`, values[key]));
}

function generationGroups(details: WorldDetails, metadata: WorldMetadata): WorldFieldGroup[] {
  const { generation, timeAndWeather: weather, progression, spawnAndLandmarks: landmarks } = details;
  const seeds = (Object.keys(SEED_NAMES) as (keyof typeof SEED_NAMES)[])
    .filter((key) => generation.specialSeeds[key] === true).map((key) => SEED_NAMES[key]);
  return [
    {
      id: "generation", title: "Generation", fields: [
        text("Game mode", modeName(metadata.mode)),
        text("Evil", metadata.evil === "crimson" ? "Crimson" : "Corruption"),
        text("Special seeds", seeds.length === 0 ? "None" : seeds.join(", ")),
        ...optional(generation.creationTime, (value) => text("Created", formatDate(value))),
        ...optional(generation.lastPlayed, (value) => text("Last played", formatDate(value))),
        text("World-gen version", generation.worldGenVersion),
        text("Moon type", String(generation.moonType)),
        ...optional(generation.worldGenManifest, (value) => text("World-gen manifest", value)),
      ],
    },
    {
      id: "time", title: "Time & weather", fields: [
        text("Time", `${clockTime(weather.time, weather.dayTime)} (${weather.dayTime ? "day" : "night"})`),
        text("Moon phase", MOON_PHASES[weather.moonPhase] ?? `Phase ${String(weather.moonPhase)}`),
        flag("Blood moon", weather.bloodMoon),
        flag("Solar eclipse", weather.eclipse),
        flag("Raining", weather.rain.active),
        flag("Sandstorm", weather.sandstorm.active),
        flag("Party", weather.party.manual || weather.party.genuine),
        flag("Lantern night", weather.lanternNight.manual || weather.lanternNight.genuine),
        text("Wind speed", weather.windSpeed.toFixed(2)),
        text("Clouds", String(weather.cloudCount)),
        flag("Halloween today", weather.holidays.halloweenToday),
        flag("Christmas today", weather.holidays.christmasToday),
        ...optional(weather.holidays.halloweenForever, (value) => flag("Halloween always", value)),
        ...optional(weather.holidays.christmasForever, (value) => flag("Christmas always", value)),
        ...optional(weather.meteorShowerCount, (value) => text("Meteor showers", integer(value))),
        ...optional(weather.coinRain, (value) => text("Coin rains", integer(value))),
      ],
    },
    {
      id: "progression", title: "Progression", fields: [
        flag("Hardmode", progression.hardmode),
        text("Shadow orbs smashed", String(progression.orbCount)),
        text("Altars smashed", String(progression.altarCount)),
        text("Angler quest", String(progression.anglerQuest)),
        flag("Combat book", progression.combatBookUsed),
        flag("Combat book volume 2", progression.combatBookVolumeTwoUsed),
        flag("Peddler's satchel", progression.peddlersSatchelUsed),
        flag("Lunar events", progression.apocalypse),
        ...flags(progression.defeatedPillars, PILLAR_NAMES, "Pillar defeated: "),
      ],
    },
    { id: "bosses", title: "Bosses", fields: flags(progression.bosses, BOSS_NAMES) },
    {
      id: "events", title: "Invasions & NPCs", fields: [
        ...flags(progression.defeatedInvasions, INVASION_NAMES),
        ...flags(progression.savedNpcs, NPC_NAMES, "Rescued: "),
      ],
    },
    {
      id: "landmarks", title: "Spawn & landmarks", fields: [
        { kind: "point", label: "Spawn", point: landmarks.spawn },
        { kind: "point", label: "Dungeon", point: landmarks.dungeon },
        ...(landmarks.teamSpawns ?? []).map((point, index): WorldField => ({ kind: "point", label: `Team spawn ${String(index + 1)}`, point })),
      ],
    },
    {
      id: "ores", title: "Ores & backgrounds", fields: [
        text("Copper tier", ore(progression.preHardmodeOres.copper)),
        text("Iron tier", ore(progression.preHardmodeOres.iron)),
        text("Silver tier", ore(progression.preHardmodeOres.silver)),
        text("Gold tier", ore(progression.preHardmodeOres.gold)),
        text("Cobalt tier", ore(progression.hardmodeOres.cobalt)),
        text("Mythril tier", ore(progression.hardmodeOres.mythril)),
        text("Adamantite tier", ore(progression.hardmodeOres.adamantite)),
        ...Object.entries(generation.backgrounds).map(([name, style]) =>
          text(`${name.charAt(0).toUpperCase()}${name.slice(1)} background`, String(style))),
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
        text("Name", metadata.name),
        text("Seed", metadata.seed),
        text("GUID", metadata.guid),
        text("World ID", String(metadata.worldId)),
        text("Format version", String(header.version)),
        ...optional(fileSize, (value) => text("File size", formatBytes(value))),
      ],
    },
    {
      id: "size", title: "Size & layers", fields: [
        text("Size", `${String(metadata.width)} × ${String(metadata.height)} tiles`),
        text("Size class", sizeClass(metadata.width, metadata.height)),
        text("Surface level", String(metadata.surfaceLevel)),
        text("Rock level", String(metadata.rockLevel)),
        text("Bounds (px)", `${String(bounds.left)}, ${String(bounds.top)} – ${String(bounds.right)}, ${String(bounds.bottom)}`),
      ],
    },
  ];
  if (details === undefined) {
    groups.push({ id: "generation", title: "Generation", fields: [
      text("Game mode", modeName(metadata.mode)),
      text("Evil", metadata.evil === "crimson" ? "Crimson" : "Corruption"),
    ] });
    return groups;
  }
  return [...groups, ...generationGroups(details, metadata)];
}
