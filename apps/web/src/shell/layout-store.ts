import { create } from "zustand";
import { DEFAULT_RULER, type RulerSettings } from "../world/measurements.js";

/** The dock sections, in display order. */
export const SECTION_IDS = ["search", "world", "layers", "grid", "measurements", "inspector", "content", "entities", "swatches"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

/** The dock's tabs: what the world is (properties, content, entities), what is shown (layers) and what is painted. */
export const DOCK_TABS = ["world", "view", "swatches"] as const;
export type DockTab = (typeof DOCK_TABS)[number];
/** Which tab each section lives in; the Inspector is under the tabs, visible with either. */
export const SECTION_TAB: Readonly<Record<Exclude<SectionId, "inspector">, DockTab>> = {
  layers: "view", grid: "view", measurements: "view", world: "world", content: "world", entities: "world", search: "world", swatches: "swatches",
};

export type ThemeChoice = "system" | "dark" | "light";
export type ChestView = "grid" | "list";

export const GRID_MODES = ["off", 3, 5, 10, "custom"] as const;
export type GridMode = (typeof GRID_MODES)[number];
export interface GridSettings {
  readonly mode: GridMode;
  readonly customSpacing: number;
  readonly opacity: number;
}

function parseGrid(value: unknown): GridSettings {
  const stored = isRecord(value) ? value : {};
  const { mode, customSpacing, opacity } = stored;
  return {
    mode: GRID_MODES.find((choice) => choice === mode) ?? "off",
    customSpacing: typeof customSpacing === "number" && Number.isInteger(customSpacing) && customSpacing >= 2 && customSpacing <= 1000 ? customSpacing : 10,
    opacity: typeof opacity === "number" && Number.isFinite(opacity) && opacity >= 0 && opacity <= 100 ? opacity : 30,
  };
}

export interface ColumnLayout {
  readonly hidden?: boolean;
  readonly width?: number;
}

/** Per-browser layout: what the user arranged, never world data. */
export interface Layout {
  readonly grid: GridSettings;
  readonly ruler: RulerSettings;
  readonly sections: Readonly<Record<SectionId, boolean>>;
  /** Collapsible groups inside sections, keyed `<section>/<group>`; absent means open. */
  readonly groups: Readonly<Record<string, boolean>>;
  readonly dockWidth: number;
  readonly dockHidden: boolean;
  readonly dockTab: DockTab;
  /** The open Inspector's height in CSS pixels, set by its splitter; null fits its content (up to half the dock). */
  readonly inspectorHeight: number | null;
  /** Table columns, keyed by table id and column id. */
  readonly columns: Readonly<Record<string, Readonly<Record<string, ColumnLayout>>>>;
  readonly theme: ThemeChoice;
  /** The Inspector lists every field ("None" for absent ones) instead of only what the tile has. */
  readonly inspectorShowAll: boolean;
  /** How a chest's slots open: the game's grid or a list of the filled slots. */
  readonly chestView: ChestView;
}

export const DEFAULT_LAYOUT = {
  sections: { world: true, layers: true, grid: true, measurements: true, inspector: true, content: false, entities: false, search: false, swatches: true },
  grid: { mode: "off", customSpacing: 10, opacity: 30 },
  ruler: DEFAULT_RULER,
  groups: {},
  dockWidth: 320,
  dockHidden: false,
  dockTab: "world",
  inspectorHeight: null,
  columns: {},
  theme: "system",
  inspectorShowAll: false,
  chestView: "grid",
  minDockWidth: 240,
  maxDockWidth: 640,
} as const satisfies Layout & { minDockWidth: number; maxDockWidth: number };

export const LAYOUT_STORAGE_KEY = "terraria-map-studio.layout.v1";

/** The slice of `Storage` the layout needs; tests pass their own. */
export interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface LayoutState extends Layout {
  readonly setGrid: (settings: Partial<GridSettings>) => void;
  readonly setRuler: (settings: Partial<RulerSettings>) => void;
  readonly setSectionOpen: (id: SectionId, open: boolean) => void;
  readonly setGroupOpen: (key: string, open: boolean) => void;
  /** Opens or closes several groups at once (Expand all / Collapse all). */
  readonly setGroupsOpen: (keys: readonly string[], open: boolean) => void;
  readonly setDockWidth: (width: number) => void;
  readonly setInspectorHeight: (height: number | null) => void;
  readonly setDockHidden: (hidden: boolean) => void;
  readonly setDockTab: (tab: DockTab) => void;
  readonly setColumn: (table: string, column: string, layout: ColumnLayout) => void;
  readonly setTheme: (theme: ThemeChoice) => void;
  readonly setInspectorShowAll: (showAll: boolean) => void;
  readonly setChestView: (view: ChestView) => void;
}

function clampDockWidth(width: number): number {
  return Math.round(Math.min(DEFAULT_LAYOUT.maxDockWidth, Math.max(DEFAULT_LAYOUT.minDockWidth, width)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRuler(value: unknown): RulerSettings {
  const stored = isRecord(value) ? value : {};
  return {
    mode: stored["mode"] === "rectangle" ? "rectangle" : "line",
    keep: typeof stored["keep"] === "boolean" ? stored["keep"] : DEFAULT_RULER.keep,
    dimensions: typeof stored["dimensions"] === "boolean" ? stored["dimensions"] : DEFAULT_RULER.dimensions,
    components: typeof stored["components"] === "boolean" ? stored["components"] : DEFAULT_RULER.components,
    angle: typeof stored["angle"] === "boolean" ? stored["angle"] : DEFAULT_RULER.angle,
  };
}

function booleans(value: unknown): Record<string, boolean> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
}

function columnLayouts(value: unknown): Record<string, Record<string, ColumnLayout>> {
  if (!isRecord(value)) return {};
  const tables: Record<string, Record<string, ColumnLayout>> = {};
  for (const [table, columns] of Object.entries(value)) {
    if (!isRecord(columns)) continue;
    const parsed: Record<string, ColumnLayout> = {};
    for (const [column, layout] of Object.entries(columns)) {
      if (!isRecord(layout)) continue;
      const { hidden, width } = layout;
      parsed[column] = {
        ...(typeof hidden === "boolean" ? { hidden } : {}),
        ...(typeof width === "number" && Number.isFinite(width) ? { width } : {}),
      };
    }
    tables[table] = parsed;
  }
  return tables;
}

/** Reads a stored layout field by field: anything missing, corrupt or from another version falls back to its default. */
function parseLayout(text: string | null): Layout {
  let stored: unknown;
  try {
    stored = text === null ? null : JSON.parse(text);
  } catch {
    stored = null;
  }
  const value = isRecord(stored) ? stored : {};
  const storedSections = booleans(value["sections"]);
  const sections = Object.fromEntries(
    SECTION_IDS.map((id) => [id, storedSections[id] ?? DEFAULT_LAYOUT.sections[id]]),
  ) as Record<SectionId, boolean>;
  const { dockWidth, dockHidden, dockTab, inspectorHeight, theme, inspectorShowAll, chestView } = value;
  return {
    sections,
    grid: parseGrid(value["grid"]),
    ruler: parseRuler(value["ruler"]),
    groups: booleans(value["groups"]),
    dockWidth: typeof dockWidth === "number" && Number.isFinite(dockWidth) ? clampDockWidth(dockWidth) : DEFAULT_LAYOUT.dockWidth,
    dockHidden: typeof dockHidden === "boolean" ? dockHidden : DEFAULT_LAYOUT.dockHidden,
    dockTab: DOCK_TABS.find((tab) => tab === dockTab) ?? DEFAULT_LAYOUT.dockTab,
    inspectorHeight: typeof inspectorHeight === "number" && Number.isFinite(inspectorHeight) && inspectorHeight > 0 ? inspectorHeight : null,
    columns: columnLayouts(value["columns"]),
    theme: theme === "dark" || theme === "light" || theme === "system" ? theme : DEFAULT_LAYOUT.theme,
    inspectorShowAll: typeof inspectorShowAll === "boolean" ? inspectorShowAll : DEFAULT_LAYOUT.inspectorShowAll,
    chestView: chestView === "grid" || chestView === "list" ? chestView : DEFAULT_LAYOUT.chestView,
  };
}

function defaultLayout(): Layout {
  return parseLayout(null);
}

function browserStorage(): LayoutStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // blocked site data: the accessor itself throws
  }
}

let storage: LayoutStorage | null = null;

function save(layout: Layout): void {
  const { sections, groups, dockWidth, dockHidden, dockTab, inspectorHeight, columns, theme, inspectorShowAll, chestView, grid, ruler } = layout;
  try {
    storage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ sections, groups, dockWidth, dockHidden, dockTab, inspectorHeight, columns, theme, inspectorShowAll, chestView, grid, ruler }));
  } catch {
    // Private mode, quota or blocked storage: the layout still works for this visit.
  }
}

export const useLayoutStore = create<LayoutState>()((set, get) => {
  const update = (change: Partial<Layout>): void => {
    set(change);
    save(get());
  };
  return {
    ...defaultLayout(),
    setGrid: (settings) => {
      update({ grid: parseGrid({ ...get().grid, ...settings }) });
    },
    setRuler: (settings) => { update({ ruler: parseRuler({ ...get().ruler, ...settings }) }); },
    setSectionOpen: (id, open) => {
      update({ sections: { ...get().sections, [id]: open } });
    },
    setGroupOpen: (key, open) => {
      update({ groups: { ...get().groups, [key]: open } });
    },
    setGroupsOpen: (keys, open) => {
      update({ groups: { ...get().groups, ...Object.fromEntries(keys.map((key) => [key, open])) } });
    },
    setDockWidth: (width) => {
      update({ dockWidth: clampDockWidth(width) });
    },
    setInspectorHeight: (height) => {
      update({ inspectorHeight: height });
    },
    setDockHidden: (hidden) => {
      update({ dockHidden: hidden });
    },
    setDockTab: (tab) => {
      update({ dockTab: tab });
    },
    setColumn: (table, column, layout) => {
      const columns = get().columns;
      update({ columns: { ...columns, [table]: { ...columns[table], [column]: { ...columns[table]?.[column], ...layout } } } });
    },
    setTheme: (theme) => {
      update({ theme });
    },
    setInspectorShowAll: (showAll) => {
      update({ inspectorShowAll: showAll });
    },
    setChestView: (view) => {
      update({ chestView: view });
    },
  };
});

/** Loads the stored layout (the browser's `localStorage` by default); a throwing or empty storage leaves the defaults. */
export function hydrateLayout(from: LayoutStorage | null = browserStorage()): void {
  storage = from;
  let text: string | null;
  try {
    text = storage?.getItem(LAYOUT_STORAGE_KEY) ?? null;
  } catch {
    text = null;
  }
  useLayoutStore.setState(parseLayout(text));
}

/** Restores the default layout and forgets the stored one. */
export function resetLayout(): void {
  try {
    storage?.removeItem(LAYOUT_STORAGE_KEY);
  } catch {
    // Nothing stored that we could remove; the defaults still apply now.
  }
  useLayoutStore.setState(defaultLayout());
}
