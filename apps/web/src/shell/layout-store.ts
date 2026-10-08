import { create } from "zustand";

/** The dock sections, in display order. */
export const SECTION_IDS = ["world", "layers", "inspector", "content", "entities"] as const;
export type SectionId = (typeof SECTION_IDS)[number];

export type ThemeChoice = "system" | "dark" | "light";
export type ChestView = "grid" | "list";

export interface ColumnLayout {
  readonly hidden?: boolean;
  readonly width?: number;
}

/** Per-browser layout: what the user arranged, never world data. */
export interface Layout {
  readonly sections: Readonly<Record<SectionId, boolean>>;
  /** Collapsible groups inside sections, keyed `<section>/<group>`; absent means open. */
  readonly groups: Readonly<Record<string, boolean>>;
  readonly dockWidth: number;
  readonly dockHidden: boolean;
  /** Table columns, keyed by table id and column id. */
  readonly columns: Readonly<Record<string, Readonly<Record<string, ColumnLayout>>>>;
  readonly theme: ThemeChoice;
  /** The Inspector lists every field ("None" for absent ones) instead of only what the tile has. */
  readonly inspectorShowAll: boolean;
  /** How a chest's slots open: the game's grid or a list of the filled slots. */
  readonly chestView: ChestView;
}

export const DEFAULT_LAYOUT = {
  sections: { world: true, layers: true, inspector: true, content: false, entities: false },
  groups: {},
  dockWidth: 320,
  dockHidden: false,
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
  readonly setSectionOpen: (id: SectionId, open: boolean) => void;
  readonly setGroupOpen: (key: string, open: boolean) => void;
  /** Opens or closes several groups at once (Expand all / Collapse all). */
  readonly setGroupsOpen: (keys: readonly string[], open: boolean) => void;
  readonly setDockWidth: (width: number) => void;
  readonly setDockHidden: (hidden: boolean) => void;
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
  const { dockWidth, dockHidden, theme, inspectorShowAll, chestView } = value;
  return {
    sections,
    groups: booleans(value["groups"]),
    dockWidth: typeof dockWidth === "number" && Number.isFinite(dockWidth) ? clampDockWidth(dockWidth) : DEFAULT_LAYOUT.dockWidth,
    dockHidden: typeof dockHidden === "boolean" ? dockHidden : DEFAULT_LAYOUT.dockHidden,
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
  const { sections, groups, dockWidth, dockHidden, columns, theme, inspectorShowAll, chestView } = layout;
  try {
    storage?.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ sections, groups, dockWidth, dockHidden, columns, theme, inspectorShowAll, chestView }));
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
    setDockHidden: (hidden) => {
      update({ dockHidden: hidden });
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
