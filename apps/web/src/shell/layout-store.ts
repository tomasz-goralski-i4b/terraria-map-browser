import { create } from "zustand";
import { DEFAULT_RULER, type RulerSettings } from "../world/measurements.js";

/** The dock sections, in display order. */
export const SECTION_IDS = [
  "search", "bookmarks", "world", "layers", "grid", "measurements", "inspector", "history", "content", "entities", "statistics", "swatches", "objects", "schematics",
] as const;
export type SectionId = (typeof SECTION_IDS)[number];
export const SECTION_TITLES: Readonly<Record<SectionId, string>> = {
  search: "Search", bookmarks: "Bookmarks", world: "World", layers: "Layers", grid: "Grid", measurements: "Measurements",
  inspector: "Inspector", history: "History", content: "Content", entities: "Entities", statistics: "Statistics",
  swatches: "Swatches", objects: "Objects", schematics: "Schematics",
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
  readonly dockHidden: boolean;
  /** The workbench's arrangement (dockview's `toJSON`); null until the user changes it, then restored on load. */
  readonly workbench: unknown;
  /** Table columns, keyed by table id and column id. */
  readonly columns: Readonly<Record<string, Readonly<Record<string, ColumnLayout>>>>;
  readonly theme: ThemeChoice;
  /** The Inspector lists every field ("None" for absent ones) instead of only what the tile has. */
  readonly inspectorShowAll: boolean;
  /** How a chest's slots open: the game's grid or a list of the filled slots. */
  readonly chestView: ChestView;
  /** The overview of the whole world in the map's corner while zoomed in. */
  readonly minimap: boolean;
}

export const DEFAULT_LAYOUT = {
  sections: {
    world: true, layers: true, grid: true, measurements: true, inspector: true, history: true, content: false, entities: false, search: false, bookmarks: false,
    statistics: false, swatches: true, objects: true, schematics: true,
  },
  grid: { mode: "off", customSpacing: 10, opacity: 30 },
  ruler: DEFAULT_RULER,
  groups: {},
  dockHidden: false,
  workbench: null,
  columns: {},
  theme: "system",
  inspectorShowAll: false,
  chestView: "grid",
  minimap: true,
} as const satisfies Layout;

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
  readonly setDockHidden: (hidden: boolean) => void;
  readonly setWorkbench: (arrangement: unknown) => void;
  readonly setColumn: (table: string, column: string, layout: ColumnLayout) => void;
  readonly setTheme: (theme: ThemeChoice) => void;
  readonly setInspectorShowAll: (showAll: boolean) => void;
  readonly setMinimap: (shown: boolean) => void;
  readonly setChestView: (view: ChestView) => void;
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
  const { dockHidden, workbench, theme, inspectorShowAll, chestView, minimap } = value;
  return {
    sections,
    grid: parseGrid(value["grid"]),
    ruler: parseRuler(value["ruler"]),
    groups: booleans(value["groups"]),
    dockHidden: typeof dockHidden === "boolean" ? dockHidden : DEFAULT_LAYOUT.dockHidden,
    // Checked by the workbench when it restores it (dockview validates its own format).
    workbench: isRecord(workbench) ? workbench : null,
    columns: columnLayouts(value["columns"]),
    theme: theme === "dark" || theme === "light" || theme === "system" ? theme : DEFAULT_LAYOUT.theme,
    inspectorShowAll: typeof inspectorShowAll === "boolean" ? inspectorShowAll : DEFAULT_LAYOUT.inspectorShowAll,
    chestView: chestView === "grid" || chestView === "list" ? chestView : DEFAULT_LAYOUT.chestView,
    minimap: typeof minimap === "boolean" ? minimap : DEFAULT_LAYOUT.minimap,
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
  const { sections, groups, dockHidden, workbench, columns, theme, inspectorShowAll, chestView, grid, ruler, minimap } = layout;
  try {
    storage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ sections, groups, dockHidden, workbench, columns, theme, inspectorShowAll, chestView, grid, ruler, minimap }));
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
    setDockHidden: (hidden) => {
      update({ dockHidden: hidden });
    },
    setWorkbench: (arrangement) => {
      update({ workbench: arrangement });
    },
    setColumn: (table, column, layout) => {
      const columns = get().columns;
      update({ columns: { ...columns, [table]: { ...columns[table], [column]: { ...columns[table]?.[column], ...layout } } } });
    },
    setTheme: (theme) => {
      update({ theme });
    },
    setMinimap: (shown) => { update({ minimap: shown }); },
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
