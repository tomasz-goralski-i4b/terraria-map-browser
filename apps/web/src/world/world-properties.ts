import type { WorldTilesResult } from "@studio/world-codec";
import { useAppStore } from "../store.js";
import { useSaveStore } from "./save-world.js";
import { finishBrush } from "./brush-session.js";
import { getDefaultWorldSession } from "./world-session.js";

export type PropertyValue = string | number | boolean | readonly number[] | readonly string[] | readonly { readonly x: number; readonly y: number }[];
export interface PropertyOption { readonly value: string | number | boolean; readonly label: string }
const options = (values: readonly (string | number | boolean)[], labels?: readonly string[]): PropertyOption[] =>
  values.map((value, index) => ({ value, label: labels?.[index] ?? String(value) }));
const range = (count: number): PropertyOption[] => options(Array.from({ length: count }, (_, index) => index));
// Observed by calling vanilla 1.4.5.8 RandomizeBackgrounds/RandomizeCaveBackgrounds/RandomizeTreeStyle,
// 20,000 iterations; see docs/world-properties.md. These are stored style ids, not texture ids.
const forestStyles = [...Array.from({ length: 14 }, (_, index) => index), 31, 51, 71, 72, 73];
const snowStyles = [0, 1, 2, 3, 4, 5, 6, 7, 8, 21, 22, 31, 32, 41, 42];
const backgroundStyles: Readonly<Record<string, readonly number[]>> = {
  tree: forestStyles, corruption: [0, 1, 2, 3, 4, 51, 52], jungle: [0, 1, 2, 3, 4, 5, 6],
  snow: snowStyles, hallow: [0, 1, 2, 3, 4, 5], crimson: [0, 1, 2, 3, 4, 5, 6],
  desert: [0, 1, 2, 3, 4, 51, 52, 53], ocean: [0, 1, 2, 3, 4, 5, 6, 7], mushroom: [0, 1, 2, 3, 4], underworld: [0, 1, 2],
};

/** Finite domains use selects. Unknown stored values remain visible, but cannot be newly entered. */
export function propertyOptions(path: string, value: unknown): readonly PropertyOption[] | undefined {
  if (typeof value === "boolean") return options([false, true], ["No", "Yes"]);
  if (path === "metadata.mode") return options(["classic", "expert", "master", "journey"], ["Classic", "Expert", "Master", "Journey"]);
  if (path === "metadata.evil") return options(["corruption", "crimson"], ["Corruption", "Crimson"]);
  if (path.endsWith(".moonType")) return range(9);
  if (path.endsWith(".moonPhase")) return options([0, 1, 2, 3, 4, 5, 6, 7], ["Full moon", "Waning gibbous", "Third quarter", "Waning crescent", "New moon", "Waxing crescent", "First quarter", "Waxing gibbous"]);
  if (path.endsWith(".invasion.type")) return options([0, 1, 2, 3, 4], ["None", "Goblin Army", "Frost Legion", "Pirate Invasion", "Martian Madness"]);
  if (path.endsWith(".anglerQuest")) return range(41);
  if (path.includes(".backgrounds.")) return options(backgroundStyles[path.split(".").at(-1) ?? ""] ?? []);
  if (/\.(additionalTreeBackgrounds)\.\d+$/.test(path)) return options(forestStyles);
  if (/\.treeStyles\.\d+$/.test(path)) return range(6);
  if (/\.caveBackStyles\.\d+$/.test(path)) return range(8);
  if (path.endsWith(".iceBackStyle")) return range(4);
  if (path.endsWith(".jungleBackStyle")) return range(2);
  if (path.endsWith(".hellBackStyle")) return range(3);
  if (/\.treeTopVariations\.\d+$/.test(path)) {
    const index = Number(path.split(".").at(-1));
    if (index === 6) return options([0, 1, 2, 3, 4, 5, 6, 7, 21, 22, 31, 32, 41, 42]);
    return range(index === 11 ? 4 : [4, 7, 9].includes(index) ? 5 : 6);
  }
  if (/\.party\.npcs\.\d+$/.test(path)) return range(200).map((choice) => ({ ...choice, label: `NPC slot ${String(choice.value)}` }));
  const oreTiers: Readonly<Record<string, readonly number[]>> = { copper: [-1, 7, 166], iron: [-1, 6, 167], silver: [-1, 9, 168], gold: [-1, 8, 169], cobalt: [-1, 107, 221], mythril: [-1, 108, 222], adamantite: [-1, 111, 223] };
  const oreNames: Readonly<Record<number, string>> = { [-1]: "Not chosen yet", 7: "Copper", 166: "Tin", 6: "Iron", 167: "Lead", 9: "Silver", 168: "Tungsten", 8: "Gold", 169: "Platinum", 107: "Cobalt", 221: "Palladium", 108: "Mythril", 222: "Orichalcum", 111: "Adamantite", 223: "Titanium" };
  if (/\.(preHardmodeOres|hardmodeOres)\./.test(path)) return (oreTiers[path.split(".").at(-1) ?? ""] ?? []).map((id) => ({ value: id, label: oreNames[id] ?? String(id) }));
  return undefined;
}

/** File structure and stored list lengths are derived rather than editable values. */
export function propertyReadOnly(path: string): boolean {
  return !path.startsWith("metadata.") && !path.startsWith("details.") && !["header.revision", "header.isFavorite"].includes(path) || ["details.other.killCountLength", "details.other.claimableBannerLength"].includes(path);
}

export function propertyValue(world: unknown, path: string): unknown {
  let value: unknown = world;
  for (const key of path.split(".")) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

export function propertyText(value: unknown): string {
  if (Array.isArray(value)) return JSON.stringify(value);
  if (typeof value === "object" && value !== null) return JSON.stringify(value);
  return String(value);
}

export function parseProperty(path: string, text: string, previous: unknown): PropertyValue {
  if (path === "details.generation.worldGenManifest") {
    const manifest: unknown = JSON.parse(text);
    if (typeof manifest !== "object" || manifest === null || Array.isArray(manifest)) throw new Error("Enter a world-generation manifest object.");
  }
  const choices = propertyOptions(path, previous);
  if (choices !== undefined) {
    const option = choices.find((candidate) => String(candidate.value) === text);
    if (option === undefined) throw new Error("Choose one of the available values.");
    return option.value;
  }
  if (typeof previous === "number") {
    if (text.trim() === "" || !Number.isFinite(Number(text))) throw new Error("Enter a finite number.");
    return Number(text);
  }
  if (Array.isArray(previous)) {
    const value: unknown = JSON.parse(text);
    if (!Array.isArray(value)) throw new Error("Enter a JSON list.");
    const points = path.endsWith(".teamSpawns");
    const strings = path.endsWith(".anglerFinishers");
    if (!value.every((item: unknown) => points
      ? typeof item === "object" && item !== null && Object.keys(item).length === 2 && Number.isInteger((item as Record<string, unknown>)["x"]) && Number.isInteger((item as Record<string, unknown>)["y"])
      : strings ? typeof item === "string" : typeof item === "number" && Number.isInteger(item))) throw new Error(points ? "Each point needs integer x and y." : strings ? "Enter a list of names." : "Enter a list of integers.");
    if (["treeX", "treeStyles", "caveBackX", "caveBackStyles", "additionalTreeBackgrounds", "treeTopVariations"].includes(path.split(".").at(-1) ?? "") && value.length !== previous.length) throw new Error(`Keep all ${String(previous.length)} entries.`);
    value.forEach((item: unknown, index) => {
      if (Object.is(item, previous[index])) return;
      const choices = propertyOptions(`${path}.${String(index)}`, item);
      if (choices !== undefined && !choices.some((choice) => choice.value === item)) throw new Error(`Choose an available value for entry ${String(index + 1)}.`);
    });
    return value as PropertyValue;
  }
  return text;
}

let savedProperties = "";
const drafts = new Map<string, string>();
export function setPropertyDraft(path: string, text: string | null): void {
  if (text === null) drafts.delete(path);
  else drafts.set(path, text);
}
export function flushPropertyDrafts(): string | null {
  for (const [path, text] of [...drafts]) {
    try { setWorldProperty(path, text); drafts.delete(path); }
    catch (error) { return `Fix ${path.split(".").at(-1) ?? "the world property"}: ${error instanceof Error ? error.message : String(error)}`; }
  }
  return null;
}
let propertiesWorld: WorldTilesResult | null = null;
export function setPropertiesWorld(world: WorldTilesResult | null, reset = true): void {
  propertiesWorld = world;
  if (reset) drafts.clear();
  if (reset) savedProperties = world === null ? "" : propertiesFingerprint(world);
}
export function propertiesFingerprint(world: WorldTilesResult): string { return JSON.stringify([world.header.revision, world.header.isFavorite, world.metadata, world.details]); }
export function propertiesAreDirty(): boolean {
  const world = propertiesWorld;
  return world !== null && savedProperties !== "" && propertiesFingerprint(world) !== savedProperties;
}
useAppStore.subscribe((state, previous) => {
  if ((!state.unsavedChanges && previous.unsavedChanges) || (state.phase === "loaded" && previous.phase === "loading")) {
    const world = propertiesWorld;
    savedProperties = world === null ? "" : propertiesFingerprint(world);
  }
});

/** Validates a small metadata-only candidate through the same encoder used for saving. */
export function setWorldProperty(path: string, text: string): void {
  const session = getDefaultWorldSession();
  const world = session.getLoadedWorld();
  if (world === null || propertyReadOnly(path) || useAppStore.getState().phase === "loading" || useSaveStore.getState().open) throw new Error("World properties cannot be edited right now.");
  finishBrush();
  const before = propertiesFingerprint(world);
  const value = parseProperty(path, text, propertyValue(world, path));
  session.editProperty(path, value);
  if (propertiesFingerprint(world) !== before) useAppStore.getState().setUnsavedChanges(true);
}
