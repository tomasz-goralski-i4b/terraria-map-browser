import { useEffect } from "react";
import { openSearch, stepSearch, useCanStep } from "../world/search-store.js";
import type { IconName } from "../ui/Icon.js";
import { getDefaultAssetSession, useAssetStore } from "../assets/asset-session.js";
import { useAppStore } from "../store.js";
import { chooseWorldFile } from "../world/open-world.js";
import { openSaveAs, useSaveStore } from "../world/save-world.js";
import { openImageExport } from "../world/image-export-session.js";
import { chooseWorldsFolder, hasFolderPicker } from "../world/world-library.js";
import { closeWorld } from "../world/world-session.js";
import { finishBrush, redoBrush, setBrushSize, undoBrush, useBrushStore } from "../world/brush-session.js";
import { WORLD_GROUP_IDS } from "../panels/world-fields.js";
import { cancelArea, copySelection, placePaste, startPaste, useAreaStore } from "../world/area-session.js";
import { MAX_AREA_TILES } from "../world/area-clipboard.js";
import { GRID_MODES, resetLayout, useLayoutStore, type ThemeChoice } from "./layout-store.js";
import { PANELS, showPanel, toggleArea, togglePanel, useWorkbenchStore } from "./workbench-api.js";
import { CUSTOM_GRID_INPUT_ID } from "../panels/GridPanel.js";
import { useRulerStore, finishMeasurement, undoMeasurement, redoMeasurement, deleteMeasurement, selectMeasurement } from "../world/ruler-session.js";
import { getMapController, useViewStore, type MapLayers, type PlannedDialog, type ToolId } from "./view-store.js";

export type CommandGroup = "File" | "Edit" | "Select" | "View" | "World" | "Layers" | "Tools" | "Assets" | "Help";

/**
 * One user action. Menus, the tool rail, tooltips, the shortcut help and the command palette are all built from this
 * list, so an action has one name, one shortcut and one enabled rule everywhere.
 */
export interface Command {
  readonly id: string;
  readonly group: CommandGroup;
  readonly label: string;
  readonly icon?: IconName;
  /** In `aria-keyshortcuts` syntax: `H`, `Shift+?`, `Control+K`. */
  readonly shortcut?: string;
  readonly enabled: boolean;
  /** Shown next to a disabled command. */
  readonly disabledReason?: string;
  /** For toggles and the active tool. */
  readonly checked?: boolean;
  readonly run: () => void;
}

export type ToolGroup = "navigate" | "edit" | "build";

/** Tools that do the same kind of thing share one rail button; the others of the family open from it. */
export interface ToolFamily {
  readonly id: string;
  readonly label: string;
  readonly group: ToolGroup;
  /** Picks the family's last tool, or the next one while a tool of the family is active (only families of several). */
  readonly shortcut?: string;
}

export interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  readonly icon: IconName;
  readonly family: ToolFamily["id"];
  /** A key of the tool itself; the tools of a family of several are reached by the family's key instead. */
  readonly shortcut?: string;
  readonly available: boolean;
  /** Not in the first complete editor (catalog band B or later). */
  readonly later?: boolean;
  /** One line for the tool options bar. */
  readonly hint: string;
}

export const TOOL_FAMILIES: readonly ToolFamily[] = [
  { id: "pan", label: "Pan", group: "navigate" },
  { id: "inspect", label: "Inspect", group: "navigate" },
  { id: "ruler", label: "Measure", group: "navigate" },
  { id: "select", label: "Selection tools", group: "edit", shortcut: "M" },
  { id: "draw", label: "Drawing tools", group: "edit", shortcut: "B" },
  { id: "shape", label: "Shape tools", group: "edit", shortcut: "U" },
  { id: "fill", label: "Fill", group: "edit" },
  { id: "erase", label: "Erase", group: "edit" },
  { id: "tileState", label: "Tile state tools", group: "edit", shortcut: "A" },
  { id: "picker", label: "Eyedropper", group: "edit" },
  { id: "objects", label: "Object tools", group: "build", shortcut: "O" },
  { id: "infra", label: "Wiring and liquid tools", group: "build", shortcut: "W" },
];

export const TOOLS: readonly ToolDefinition[] = [
  { id: "pan", label: "Pan", icon: "pan", family: "pan", shortcut: "H", available: true, hint: "Drag to pan · Wheel or +/− to zoom · Arrow keys to move" },
  { id: "inspect", label: "Inspect", icon: "inspect", family: "inspect", shortcut: "I", available: true, hint: "Click a tile (or press Enter) to pin it in the Inspector · Hover to preview · Drag to pan" },
  { id: "ruler", label: "Ruler", icon: "ruler", family: "ruler", shortcut: "L", available: true, hint: "Drag to measure · Hold Shift for a rectangle" },
  { id: "select", label: "Rectangle select", icon: "select", family: "select", available: true, hint: "Drag a rectangle · Ctrl+C to copy · Ctrl+V to paste" },
  { id: "selectEllipse", label: "Ellipse select", icon: "selectEllipse", family: "select", available: false, hint: "" },
  { id: "lasso", label: "Lasso select", icon: "lasso", family: "select", available: false, later: true, hint: "" },
  { id: "wand", label: "Magic wand", icon: "wand", family: "select", available: false, later: true, hint: "" },
  { id: "move", label: "Move", icon: "move", family: "select", shortcut: "V", available: false, hint: "" },
  { id: "brush", label: "Brush", icon: "brush", family: "draw", available: true, hint: "Drag to paint simple blocks or walls" },
  { id: "pencil", label: "Pencil", icon: "pencil", family: "draw", available: false, hint: "" },
  { id: "line", label: "Line", icon: "line", family: "draw", available: false, hint: "" },
  { id: "shapeRect", label: "Rectangle", icon: "shapeRect", family: "shape", available: false, hint: "" },
  { id: "shapeEllipse", label: "Ellipse", icon: "shapeEllipse", family: "shape", available: false, hint: "" },
  { id: "shapePolygon", label: "Polygon", icon: "shapePolygon", family: "shape", available: false, hint: "" },
  { id: "fill", label: "Fill", icon: "fill", family: "fill", shortcut: "G", available: false, hint: "" },
  { id: "erase", label: "Erase", icon: "erase", family: "erase", shortcut: "E", available: true, hint: "Drag to erase the selected layer" },
  { id: "hammer", label: "Hammer", icon: "hammer", family: "tileState", available: false, hint: "" },
  { id: "paint", label: "Paint and coatings", icon: "roller", family: "tileState", available: false, hint: "" },
  { id: "picker", label: "Eyedropper", icon: "picker", family: "picker", shortcut: "K", available: false, hint: "" },
  { id: "object", label: "Place object", icon: "object", family: "objects", available: false, hint: "" },
  { id: "platform", label: "Platforms and tracks", icon: "platform", family: "objects", available: false, hint: "" },
  { id: "wire", label: "Wire", icon: "wire", family: "infra", available: false, hint: "" },
  { id: "liquid", label: "Liquid", icon: "liquid", family: "infra", available: false, hint: "" },
  { id: "trace", label: "Trace circuit", icon: "trace", family: "infra", available: false, hint: "" },
];

/** Tools that write the world: unavailable while no supported world is open. */
const WORLD_TOOLS: ReadonlySet<ToolId> = new Set(["brush", "erase", "select"]);

/** Why a command that exists as a slot only cannot be used yet; short, since its label already names it (ui.md). */
export function plannedReason(later = false): string {
  return later ? "Planned for later" : "Not available yet";
}

function toolReason(definition: ToolDefinition, editReason: string | null): string | null {
  if (!definition.available) return plannedReason(definition.later);
  return WORLD_TOOLS.has(definition.id) ? editReason : null;
}

export function toolCommands(tool: ToolId, setTool: (tool: ToolId, family?: string) => void, editReason: string | null = "Open a vanilla world first"): Command[] {
  const pick = (definition: ToolDefinition): void => {
    finishBrush();
    finishMeasurement(true, true);
    setTool(definition.id, definition.family);
  };
  const tools = TOOLS.map((definition): Command => {
    const reason = toolReason(definition, editReason);
    return {
      id: `tool.${definition.id}`, group: "Tools", label: definition.label, icon: definition.icon,
      ...(definition.shortcut === undefined ? {} : { shortcut: definition.shortcut }),
      enabled: reason === null, ...(reason === null ? {} : { disabledReason: reason }),
      checked: tool === definition.id,
      run: () => { pick(definition); },
    };
  });
  // A family's key picks its last tool, then steps through its other available tools, as in image editors.
  const families = TOOL_FAMILIES.flatMap((family): Command[] => {
    if (family.shortcut === undefined) return [];
    const members = TOOLS.filter((definition) => definition.family === family.id && toolReason(definition, editReason) === null);
    return [{
      id: `family.${family.id}`, group: "Tools", label: family.label, shortcut: family.shortcut, enabled: members.length > 0,
      ...(members.length > 0 ? {} : { disabledReason: plannedReason() }),
      run: () => {
        const at = members.findIndex((definition) => definition.id === tool);
        const last = members.find((definition) => definition.id === useViewStore.getState().familyTools[family.id]);
        const next = at >= 0 ? members[(at + 1) % members.length] : last ?? members[0];
        if (next !== undefined) pick(next);
      },
    }];
  });
  return [...tools, ...families];
}

interface CommandExtra { readonly icon?: IconName; readonly shortcut?: string; readonly later?: boolean }

/** A command whose behaviour is not connected yet: it has its place, name and key, and says why it is off. */
function planned(id: string, group: CommandGroup, label: string, extra: CommandExtra = {}): Command {
  return {
    id, group, label, enabled: false, disabledReason: plannedReason(extra.later),
    ...(extra.icon === undefined ? {} : { icon: extra.icon }), ...(extra.shortcut === undefined ? {} : { shortcut: extra.shortcut }),
    run: () => undefined,
  };
}

/** Opens the shell of a dialog whose action is not connected yet, so its questions can be seen. */
function dialogShell(id: string, group: CommandGroup, label: string, dialog: PlannedDialog, enabled: boolean, extra: CommandExtra = {}): Command {
  return {
    id, group, label, enabled, ...(enabled ? {} : { disabledReason: "Open a world first" }),
    ...(extra.icon === undefined ? {} : { icon: extra.icon }), ...(extra.shortcut === undefined ? {} : { shortcut: extra.shortcut }),
    run: () => { useViewStore.getState().setPlannedDialog(dialog); },
  };
}

/** Commands that have their menu place, key and dialog before their feature exists (docs/planning/editor-ui-plan.md). */
export function plannedCommands(hasWorld: boolean): Command[] {
  return [
    dialogShell("file.importImage", "File", "Image as Pixel Art…", "importImage", hasWorld, { icon: "image" }),
    planned("file.importSchematic", "File", "Schematic…", { icon: "schematic" }),
    {
      id: "file.exportImage", group: "File", label: "Map Image…", icon: "image", enabled: hasWorld,
      ...(hasWorld ? {} : { disabledReason: "Open a world first" }), run: openImageExport,
    },
    dialogShell("file.exportSchematic", "File", "Selection as Schematic…", "saveSchematic", hasWorld, { icon: "schematic" }),
    planned("file.recover", "File", "Recover Unsaved Work", { icon: "recovery" }),
    planned("file.backups", "File", "Backups…", { icon: "clock" }),
    planned("edit.cut", "Edit", "Cut", { shortcut: "Control+X" }),
    planned("edit.duplicate", "Edit", "Duplicate", { shortcut: "Control+Shift+D" }),
    dialogShell("edit.replace", "Edit", "Replace…", "replace", hasWorld, { icon: "replace", shortcut: "Control+H" }),
    planned("edit.flipH", "Edit", "Flip Horizontal", { icon: "flipH" }),
    planned("edit.flipV", "Edit", "Flip Vertical", { icon: "flipV" }),
    planned("edit.rotate", "Edit", "Rotate 90° Clockwise", { icon: "rotate" }),
    planned("edit.shortcuts", "Edit", "Keyboard Shortcuts…", { icon: "keyboard" }),
    planned("select.all", "Select", "All", { shortcut: "Control+A" }),
    planned("select.none", "Select", "Deselect", { shortcut: "Control+D" }),
    planned("select.invert", "Select", "Invert", { shortcut: "Control+I" }),
    planned("select.objects", "Select", "Expand to Complete Objects", { icon: "object" }),
    planned("select.matches", "Select", "Select Search Matches", { icon: "search", later: true }),
    planned("view.previous", "View", "Previous View", { shortcut: "Alt+ArrowLeft" }),
    planned("view.next", "View", "Next View", { shortcut: "Alt+ArrowRight" }),
    planned("view.fitSelection", "View", "Fit Selection"),
    planned("view.goTo", "View", "Go To…", { icon: "target", shortcut: "Control+G" }),
    planned("view.isolate", "View", "Isolate Layer", { icon: "isolate" }),
    planned("world.bookmark", "World", "Add Bookmark", { icon: "bookmark", shortcut: "Control+B" }),
    planned("world.statistics", "World", "Statistics", { icon: "stats" }),
    planned("world.presets", "World", "Settings Presets…", { icon: "world" }),
  ];
}

/** View > Panels: one checkable item per panel (shown or not), with the activity bar's rule (`togglePanel`). */
export function windowCommands(shown: ReadonlySet<string>): Command[] {
  return [
    ...PANELS.map((panel): Command => ({
      id: `panel.${panel.id}`, group: "View", label: panel.title, icon: panel.icon, enabled: true, checked: shown.has(panel.id),
      run: () => { togglePanel(panel.id); },
    })),
    {
      id: "panel.bottom", group: "View", label: "Show bottom panel", shortcut: "Control+J", enabled: true,
      checked: PANELS.some((panel) => panel.area === "bottom" && shown.has(panel.id)),
      run: () => { toggleArea("bottom"); },
    },
  ];
}

/** `[` and `]` change the brush size as in image editors: one tile at a time up to 8, then in larger steps. */
export function brushSizeCommands(editing: boolean): Command[] {
  // The size is read when the key arrives: several presses can come before the next render.
  const step = (size: number, direction: 1 | -1): number => {
    // The step is chosen by the smaller of the two sizes, so ] and [ retrace each other's sizes.
    const from = direction > 0 ? size : size - 1;
    const delta = from < 8 ? 1 : from < 24 ? 2 : 4;
    return size + direction * delta;
  };
  const reason = editing ? null : "Choose Brush or Erase first";
  return ([["tool.brushSmaller", "Smaller brush", "[", -1], ["tool.brushLarger", "Larger brush", "]", 1]] as const).map(([id, label, shortcut, direction]) => ({
    id, group: "Tools", label, shortcut, enabled: reason === null,
    ...(reason === null ? {} : { disabledReason: reason }),
    run: () => {
      // The footprint of a stroke in progress is fixed; so is its outline.
      if (!useBrushStore.getState().active) setBrushSize(step(useBrushStore.getState().size, direction));
    },
  }));
}

/**
 * Brush settings from the keyboard, as image editors give their options keys: X swaps blocks and walls (Shift+X
 * both), Shift+B the shape, S Smooth edges, R Place and Paint. Not during a stroke, whose settings are fixed.
 */
export function brushOptionCommands(tool: ToolId): Command[] {
  const editing = tool === "brush" || tool === "erase";
  const set = (change: (state: ReturnType<typeof useBrushStore.getState>) => Partial<ReturnType<typeof useBrushStore.getState>>) => () => {
    const state = useBrushStore.getState();
    if (!state.active) useBrushStore.setState(change(state));
  };
  const reason = (brushOnly: boolean): string | null => (!editing ? "Choose Brush or Erase first" : brushOnly && tool !== "brush" ? "Choose Brush first" : null);
  const options: readonly (readonly [string, string, string, boolean, ReturnType<typeof set>])[] = [
    // Erase has its own layer mask: X swaps its blocks and walls, Shift+X turns both on; liquids and wires stay.
    ["tool.brushSwapLayer", "Swap block and wall target", "X", false, set((state) => (tool === "erase"
      ? { eraseLayers: { ...state.eraseLayers, block: state.eraseLayers.wall, wall: state.eraseLayers.block } }
      : { layer: state.layer === "block" ? "wall" : "block" }))],
    ["tool.brushBothLayers", "Target blocks and walls", "Shift+X", false, set((state) => (tool === "erase"
      ? { eraseLayers: { ...state.eraseLayers, block: true, wall: true } }
      : { layer: "both" }))],
    ["tool.brushShape", "Toggle square and round brush", "Shift+B", false, set((state) => ({ shape: state.shape === "square" ? "circle" : "square" }))],
    ["tool.brushSmooth", "Toggle Smooth edges", "S", false, set((state) => ({ smooth: !state.smooth }))],
    ["tool.brushPaintOnly", "Toggle Place and Paint", "R", true, set((state) => ({ paintOnly: !state.paintOnly }))],
  ];
  return options.map(([id, label, shortcut, brushOnly, run]) => {
    const why = reason(brushOnly);
    return { id, group: "Tools", label, shortcut, enabled: why === null, ...(why === null ? {} : { disabledReason: why }), run };
  });
}

/** Layer toggles, in the order of the Layers panel, with their shortcuts. Sprites has its own row (with the assets). */
export const LAYER_TOGGLES: readonly { readonly layer: Exclude<keyof MapLayers, "wireMask" | "sprites">; readonly label: string; readonly shortcut: string }[] = [
  { layer: "background", label: "Background", shortcut: "Alt+2" },
  { layer: "walls", label: "Walls", shortcut: "Alt+3" },
  { layer: "blocks", label: "Blocks", shortcut: "Alt+4" },
  { layer: "liquids", label: "Liquids", shortcut: "Alt+5" },
  { layer: "paint", label: "Paint", shortcut: "Alt+6" },
  { layer: "wires", label: "Wires and actuators", shortcut: "Alt+7" },
];

/** Whether a layer row's eye is open (for wires: the group switch, whatever colours are chosen inside it). */
export function layerShown(layers: MapLayers, layer: (typeof LAYER_TOGGLES)[number]["layer"]): boolean {
  return layers[layer];
}

const WORLD_GROUP_KEYS = WORLD_GROUP_IDS.map((id) => `world/${id}`);

const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = { system: "Theme: follow system", dark: "Theme: dark", light: "Theme: light" };

/** The app's commands with their current state. */
export function useCommands(): Command[] {
  const canStep = useCanStep();
  const hasWorld = useAppStore((state) => state.summary !== null);
  const loadingWorld = useAppStore((state) => state.phase === "loading");
  const saving = useSaveStore((state) => state.open);
  const unsaved = useAppStore((state) => state.unsavedChanges);
  const brushReason = useBrushStore((state) => state.reason);
  const brushCanUndo = useBrushStore((state) => state.canUndo);
  const brushCanRedo = useBrushStore((state) => state.canRedo);
  const rulerCanUndo = useRulerStore((state) => state.canUndo);
  const rulerCanRedo = useRulerStore((state) => state.canRedo);
  const rulerSelected = useRulerStore((state) => state.selected);
  const area = useAreaStore();
  const areaCopyReason = area.pasting ? "Place or cancel the paste first" : area.selection === null ? "Select an area first"
    : area.selection.width * area.selection.height > MAX_AREA_TILES ? `Too large: select up to ${MAX_AREA_TILES.toLocaleString("en-US")} tiles` : null;
  const editReason = loadingWorld ? "A world is loading" : saving ? "Finish exporting first" : brushReason;
  const dockHidden = useLayoutStore((state) => state.dockHidden);
  const shownPanels = useWorkbenchStore((state) => state.shown);
  const setDockHidden = useLayoutStore((state) => state.setDockHidden);
  const theme = useLayoutStore((state) => state.theme);
  const setTheme = useLayoutStore((state) => state.setTheme);
  const grid = useLayoutStore((state) => state.grid);
  const setGrid = useLayoutStore((state) => state.setGrid);
  const tool = useViewStore((state) => state.tool);
  const setTool = useViewStore((state) => state.setTool);
  const canUndo = tool === "ruler" ? rulerCanUndo : brushCanUndo;
  const canRedo = tool === "ruler" ? rulerCanRedo : brushCanRedo;
  const historyReason = tool === "ruler" ? loadingWorld ? "A world is loading" : null : editReason;
  const statsVisible = useViewStore((state) => state.statsVisible);
  const minimap = useLayoutStore((state) => state.minimap);
  const setMinimap = useLayoutStore((state) => state.setMinimap);
  const setStatsVisible = useViewStore((state) => state.setStatsVisible);
  const setHelpOpen = useViewStore((state) => state.setHelpOpen);
  const setPaletteOpen = useViewStore((state) => state.setPaletteOpen);
  const layers = useViewStore((state) => state.layers);
  const setLayers = useViewStore((state) => state.setLayers);
  const setGroupsOpen = useLayoutStore((state) => state.setGroupsOpen);
  const pinnedTile = useViewStore((state) => state.pinnedTile);
  const setPinnedTile = useViewStore((state) => state.setPinnedTile);
  const noWorld = hasWorld ? {} : { disabledReason: "Open a world first" };
  const assetsBuilding = useAssetStore((state) => state.status.kind === "building" || state.status.kind === "choosing");
  const assetsReady = useAssetStore((state) => state.status.kind === "ready");
  const setSpritePreviewOpen = useViewStore((state) => state.setSpritePreviewOpen);

  return [
    { id: "search.find", group: "Edit", label: "Find…", icon: "search", shortcut: "Control+F", enabled: hasWorld, ...noWorld, run: openSearch },
    { id: "search.next", group: "Edit", label: "Next match", shortcut: "F3", enabled: canStep, ...(canStep ? {} : { disabledReason: "Nothing found" }), run: () => { stepSearch(1); } },
    { id: "search.previous", group: "Edit", label: "Previous match", shortcut: "Shift+F3", enabled: canStep, ...(canStep ? {} : { disabledReason: "Nothing found" }), run: () => { stepSearch(-1); } },
    { id: "edit.undo", group: "Edit", label: "Undo", icon: "undo", shortcut: "Control+Z", enabled: canUndo && historyReason === null,
      ...(historyReason !== null ? { disabledReason: historyReason } : !canUndo ? { disabledReason: tool === "ruler" ? "No measurement to undo" : "No stroke to undo" } : {}), run: tool === "ruler" ? undoMeasurement : undoBrush },
    { id: "edit.redo", group: "Edit", label: "Redo", icon: "redo", shortcut: "Control+Shift+Z", enabled: canRedo && historyReason === null,
      ...(historyReason !== null ? { disabledReason: historyReason } : !canRedo ? { disabledReason: tool === "ruler" ? "No measurement to redo" : "No stroke to redo" } : {}), run: tool === "ruler" ? redoMeasurement : redoBrush },
    { id: "tool.deleteMeasurement", group: "Tools", label: "Delete measurement", shortcut: "Delete", enabled: tool === "ruler" && rulerSelected !== null,
      run: () => { const id = useRulerStore.getState().selected; if (id !== null) deleteMeasurement(id); } },
    { id: "tool.deselectMeasurement", group: "Tools", label: "Deselect measurement", shortcut: "Escape", enabled: tool === "ruler" && rulerSelected !== null,
      run: () => { finishMeasurement(true, true); selectMeasurement(null); } },
    ...([
      ["edit.copy", "Copy", "Control+C", areaCopyReason === null, areaCopyReason, copySelection],
      ["edit.paste", "Paste", "Control+V", area.hasClipboard, "Copy an area first", startPaste],
      ["edit.placePaste", "Place paste", "Enter", area.pasting && area.canPlace, area.pasting ? area.problem ?? "Preparing preview…" : "Paste first", placePaste],
      // Outside Select, Escape keeps its other meanings (unpinning the Inspector's tile, taking back a stroke).
      ["edit.cancelArea", area.pasting ? "Cancel paste" : "Deselect", "Escape", area.pasting || (area.selection !== null && tool === "select"), area.selection === null ? "Nothing is selected" : "Switch to Select first", cancelArea],
    ] as const).map(([id, label, shortcut, available, reason, run]): Command => ({ id, group: "Edit", label, shortcut, enabled: available && editReason === null, ...(!available || editReason !== null ? { disabledReason: editReason ?? reason ?? "" } : {}), run })),
    { id: "file.open", group: "File", label: "Open World…", icon: "file", shortcut: "Control+O", enabled: true, run: chooseWorldFile },
    {
      id: "file.openFolder", group: "File", label: "Open Folder…", icon: "folder", enabled: hasFolderPicker(),
      ...(hasFolderPicker() ? {} : { disabledReason: "This browser cannot open folders" }),
      run: () => {
        void chooseWorldsFolder();
      },
    },
    {
      // Writing over the opened file is not offered yet: Save asks where to write a verified copy, as Save As does.
      id: "file.save", group: "File", label: "Save…", icon: "save", shortcut: "Control+S", enabled: hasWorld && unsaved && !loadingWorld && !saving,
      ...(!hasWorld ? noWorld : loadingWorld ? { disabledReason: "A world is loading" } : !unsaved ? { disabledReason: "No unsaved changes" } : {}),
      run: () => {
        void openSaveAs();
      },
    },
    {
      id: "file.saveAs", group: "File", label: "Save As…", shortcut: "Control+Shift+S", enabled: hasWorld && !loadingWorld && !saving,
      ...(!hasWorld ? noWorld : loadingWorld ? { disabledReason: "A world is loading" } : {}),
      run: () => {
        void openSaveAs();
      },
    },
    {
      id: "file.close", group: "File", label: "Close World", enabled: hasWorld && !loadingWorld,
      ...(!hasWorld ? noWorld : loadingWorld ? { disabledReason: "A world is loading" } : {}),
      run: () => {
        void closeWorld();
      },
    },
    {
      id: "file.assets", group: "Assets", label: "Connect Terraria assets…", enabled: !assetsBuilding,
      ...(assetsBuilding ? { disabledReason: "The sprite atlas is being built" } : {}),
      run: () => {
        void getDefaultAssetSession().connect();
      },
    },
    {
      id: "file.disconnectAssets", group: "Assets", label: "Disconnect Terraria assets", enabled: assetsReady,
      ...(assetsReady ? {} : { disabledReason: "No Terraria assets are connected" }),
      run: () => {
        void getDefaultAssetSession().disconnect();
      },
    },
    {
      id: "file.sprites", group: "Assets", label: "Preview sprite sheets…", enabled: assetsReady,
      ...(assetsReady ? {} : { disabledReason: "Connect Terraria assets first" }),
      run: () => {
        setSpritePreviewOpen(true);
      },
    },
    {
      id: "view.dock", group: "View", label: "Show panels", icon: "dock", shortcut: "P", enabled: true, checked: !dockHidden,
      run: () => {
        setDockHidden(!dockHidden);
      },
    },
    {
      id: "view.fit", group: "View", label: "Fit world", shortcut: "F", enabled: hasWorld, ...noWorld,
      run: () => {
        getMapController()?.fitWorld();
      },
    },
    {
      id: "view.actual", group: "View", label: "Actual size (1:1)", shortcut: "1", enabled: hasWorld, ...noWorld,
      run: () => {
        getMapController()?.actualSize();
      },
    },
    {
      id: "view.minimap", group: "View", label: "Show minimap", shortcut: "N", enabled: true, checked: minimap,
      run: () => {
        setMinimap(!minimap);
      },
    },
    {
      id: "view.stats", group: "View", label: "Show render stats", icon: "stats", enabled: true, checked: statsVisible,
      run: () => {
        setStatsVisible(!statsVisible);
      },
    },
    ...(["system", "dark", "light"] as const).map((choice): Command => ({
      id: `view.theme.${choice}`, group: "View", label: THEME_LABELS[choice], icon: "theme", enabled: true, checked: theme === choice,
      run: () => {
        setTheme(choice);
      },
    })),
    { id: "view.reset", group: "View", label: "Reset layout", icon: "reset", enabled: true, run: resetLayout },
    ...GRID_MODES.map((mode): Command => ({
      id: `view.grid.${String(mode)}`, group: "View", label: mode === "off" ? "Off" : mode === "custom" ? "Custom…" : String(mode),
      enabled: true, checked: grid.mode === mode,
      run: () => {
        setGrid({ mode });
        if (mode === "custom") {
          showPanel("layers", "grid");
          window.requestAnimationFrame(() => { document.getElementById(CUSTOM_GRID_INPUT_ID)?.focus(); });
        }
      },
    })),
    {
      id: "view.worldExpand", group: "View", label: "Expand all World groups", icon: "expandAll", enabled: true,
      run: () => {
        setGroupsOpen(WORLD_GROUP_KEYS, true);
      },
    },
    {
      id: "view.worldCollapse", group: "View", label: "Collapse all World groups", icon: "collapseAll", enabled: true,
      run: () => {
        setGroupsOpen(WORLD_GROUP_KEYS, false);
      },
    },
    {
      id: "layer.sprites", group: "Layers", label: "Show sprites", shortcut: "Alt+1", enabled: assetsReady,
      ...(assetsReady ? {} : { disabledReason: "Connect Terraria assets first" }),
      checked: assetsReady && layers.sprites,
      run: () => {
        setLayers({ sprites: !layers.sprites });
      },
    },
    ...LAYER_TOGGLES.map(({ layer, label, shortcut }): Command => ({
      id: `layer.${layer}`, group: "Layers", label: `Show ${label.toLowerCase()}`, shortcut, enabled: true,
      checked: layerShown(layers, layer),
      run: () => {
        setLayers({ [layer]: !layers[layer] });
      },
    })),
    ...toolCommands(tool, setTool, editReason),
    ...plannedCommands(hasWorld),
    ...windowCommands(shownPanels),
    ...brushSizeCommands(tool === "brush" || tool === "erase"),
    ...brushOptionCommands(tool),
    {
      id: "tool.unpin", group: "Tools", label: "Unpin inspected tile", shortcut: "Escape", enabled: pinnedTile !== null,
      ...(pinnedTile === null ? { disabledReason: "No tile is pinned" } : {}),
      run: () => {
        setPinnedTile(null);
      },
    },
    {
      id: "help.palette", group: "Help", label: "Command palette", icon: "command", shortcut: "Control+K", enabled: true,
      run: () => {
        setPaletteOpen(true);
      },
    },
    {
      id: "help.shortcuts", group: "Help", label: "Keyboard shortcuts", icon: "help", shortcut: "Shift+?", enabled: true,
      run: () => {
        setHelpOpen(true);
      },
    },
  ];
}

export function commandById(commands: readonly Command[], id: string): Command {
  const command = commands.find((candidate) => candidate.id === id);
  if (command === undefined) throw new Error(`unknown command ${id}`);
  return command;
}

/** Whether a key event is the shortcut. `Control` also matches ⌘ so the same shortcuts work on macOS. */
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split("+");
  const key = parts.at(-1) ?? "";
  const modifiers = new Set(parts.slice(0, -1));
  const control = event.ctrlKey || event.metaKey;
  if (control !== modifiers.has("Control") || event.altKey !== modifiers.has("Alt")) return false;
  // Shift-produced punctuation matches by character; letters and named keys (F3, Escape) compare the modifier.
  if ((/^[a-z]$/i.test(key) || key.length > 1) && event.shiftKey !== modifiers.has("Shift")) return false;
  // Digits match by physical key: with Alt (Option on macOS) the produced character is not the digit.
  if (/^[0-9]$/.test(key)) return event.code === `Digit${key}` || event.key === key;
  return event.key.toLowerCase() === key.toLowerCase();
}

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["button", "checkbox", "radio", "range"].includes(target.type);
}

/**
 * Runs a command when its shortcut is pressed anywhere in the app, except while typing in a field or inside an open
 * menu or dialog (their keys belong to them). Disabled commands swallow only Ctrl shortcuts (browser actions).
 */
export function useGlobalShortcuts(commands: readonly Command[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // Find and its steps also work from a text field (the search box itself included), as in code editors.
      const findKey = event.key === "F3" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f" && !event.shiftKey && !event.altKey);
      if (event.defaultPrevented || event.repeat || (isTextEntry(event.target) && !findKey)) return;
      if (event.target instanceof Element && event.target.closest("[role=menu], dialog[open]") !== null) return;
      const matching = commands.filter((candidate) => candidate.shortcut !== undefined && matchesShortcut(event, candidate.shortcut));
      const command = matching.find((candidate) => candidate.enabled) ?? matching[0];
      if (command === undefined) return;
      if (command.id === "edit.placePaste" && event.target instanceof Element && event.target.closest("button, input, select, [role=button]") !== null) return;
      // Ctrl+C / Ctrl+V stay the browser's for selected page text and whenever there is no area to copy or paste.
      if ((command.id === "edit.copy" || command.id === "edit.paste") && (!command.enabled || window.getSelection()?.isCollapsed === false)) return;
      // A disabled Ctrl shortcut is still ours: Ctrl+S must not open the browser's "Save page" instead, nor F3 its
      // find bar.
      if (!command.enabled) {
        if (event.ctrlKey || event.metaKey || event.key === "F3") event.preventDefault();
        return;
      }
      event.preventDefault();
      command.run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [commands]);
}
