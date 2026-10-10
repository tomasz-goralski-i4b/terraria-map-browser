import { create } from "zustand";
import type { BrushContentLayer } from "@studio/world-model";

/** One swatch: a block or wall with the paint it is put down with (0: none). */
export interface PaletteSwatch {
  readonly layer: BrushContentLayer;
  readonly id: number;
  readonly paint: number;
}

/** A named set of swatches the user keeps, like an image editor's swatch library. */
export interface CustomPalette {
  readonly id: string;
  readonly name: string;
  readonly swatches: readonly PaletteSwatch[];
}

export const PALETTES_STORAGE_KEY = "terraria-map-studio.palettes.v1";
const RECENT_LIMIT = 16;
const FILE_FORMAT = "terraria-map-studio.palettes";

interface PalettesState {
  readonly palettes: readonly CustomPalette[];
  readonly recent: readonly PaletteSwatch[];
}

/** The slice of `Storage` the palettes need; tests pass their own. */
export interface PaletteStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseSwatch(value: unknown): PaletteSwatch | null {
  if (!isRecord(value)) return null;
  const { layer, id, paint } = value;
  if ((layer !== "block" && layer !== "wall") || !Number.isInteger(id) || (id as number) < 0) return null;
  return { layer, id: id as number, paint: Number.isInteger(paint) && (paint as number) >= 0 && (paint as number) <= 0xff ? paint as number : 0 };
}

function parseSwatches(value: unknown): PaletteSwatch[] {
  return Array.isArray(value) ? value.flatMap((swatch) => parseSwatch(swatch) ?? []) : [];
}

function parsePalettes(value: unknown): CustomPalette[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((palette) => {
    if (!isRecord(palette) || typeof palette["name"] !== "string") return [];
    const id = typeof palette["id"] === "string" && palette["id"].length > 0 ? palette["id"] : newId();
    return [{ id, name: palette["name"].slice(0, 80), swatches: parseSwatches(palette["swatches"]) }];
  });
}

let counter = 0;
function newId(): string {
  counter += 1;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

export const sameSwatch = (a: PaletteSwatch, b: PaletteSwatch): boolean => a.layer === b.layer && a.id === b.id && a.paint === b.paint;

let storage: PaletteStorage | null = null;

function save(state: PalettesState): void {
  try {
    storage?.setItem(PALETTES_STORAGE_KEY, JSON.stringify({ palettes: state.palettes, recent: state.recent }));
  } catch {
    // Private mode, quota or blocked storage: the palettes still work for this visit.
  }
}

export const usePaletteStore = create<PalettesState>()(() => ({ palettes: [], recent: [] }));

function update(change: (state: PalettesState) => Partial<PalettesState>): void {
  usePaletteStore.setState(change);
  save(usePaletteStore.getState());
}

/** Loads the stored palettes (the browser's `localStorage` by default); corrupt entries are dropped. */
export function hydratePalettes(from: PaletteStorage | null = browserStorage()): void {
  storage = from;
  let stored: unknown;
  try {
    const text = storage?.getItem(PALETTES_STORAGE_KEY) ?? null;
    stored = text === null ? null : JSON.parse(text);
  } catch {
    stored = null;
  }
  const value = isRecord(stored) ? stored : {};
  usePaletteStore.setState({ palettes: parsePalettes(value["palettes"]), recent: parseSwatches(value["recent"]).slice(0, RECENT_LIMIT) });
}

function browserStorage(): PaletteStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Remembers a swatch as the most recently used one. */
export function pushRecentSwatch(swatch: PaletteSwatch): void {
  update((state) => ({ recent: [swatch, ...state.recent.filter((other) => !sameSwatch(other, swatch))].slice(0, RECENT_LIMIT) }));
}

/** Creates a palette, optionally with swatches, and returns its id. */
export function createPalette(name: string, swatches: readonly PaletteSwatch[] = []): string {
  const id = newId();
  update((state) => ({ palettes: [...state.palettes, { id, name: name.trim() || "Palette", swatches }] }));
  return id;
}

export function renamePalette(id: string, name: string): void {
  const trimmed = name.trim();
  if (trimmed.length === 0) return;
  update((state) => ({ palettes: state.palettes.map((palette) => (palette.id === id ? { ...palette, name: trimmed.slice(0, 80) } : palette)) }));
}

export function deletePalette(id: string): void {
  update((state) => ({ palettes: state.palettes.filter((palette) => palette.id !== id) }));
}

/** Adds swatches a palette does not have yet, at its end. */
export function addSwatches(id: string, swatches: readonly PaletteSwatch[]): void {
  update((state) => ({
    palettes: state.palettes.map((palette) => {
      if (palette.id !== id) return palette;
      const added = swatches.filter((swatch, index) => !palette.swatches.some((other) => sameSwatch(other, swatch)) && swatches.findIndex((other) => sameSwatch(other, swatch)) === index);
      return { ...palette, swatches: [...palette.swatches, ...added] };
    }),
  }));
}

export function removeSwatch(id: string, swatch: PaletteSwatch): void {
  update((state) => ({
    palettes: state.palettes.map((palette) => (palette.id === id ? { ...palette, swatches: palette.swatches.filter((other) => !sameSwatch(other, swatch)) } : palette)),
  }));
}

/** The palettes as a JSON file body, to share or keep. */
export function exportPalettes(ids?: readonly string[]): string {
  const palettes = usePaletteStore.getState().palettes.filter((palette) => ids === undefined || ids.includes(palette.id));
  return JSON.stringify({ format: FILE_FORMAT, version: 1, palettes: palettes.map(({ name, swatches }) => ({ name, swatches })) }, null, 2);
}

/** Adds the palettes of an exported file as new palettes; returns how many, or throws when it is not such a file. */
export function importPalettes(text: string): number {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The file is not a palette file (it is not JSON)");
  }
  if (!isRecord(parsed) || parsed["format"] !== FILE_FORMAT) throw new Error("The file is not a Terraria Map Studio palette file");
  const palettes = parsePalettes(parsed["palettes"]).map((palette) => ({ ...palette, id: newId() }));
  update((state) => ({ palettes: [...state.palettes, ...palettes] }));
  return palettes.length;
}
