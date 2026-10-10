import { useEffect } from "react";
import type { IconName } from "../ui/Icon.js";
import { getDefaultAssetSession, useAssetStore } from "../assets/asset-session.js";
import { useAppStore } from "../store.js";
import { chooseWorldFile } from "../world/open-world.js";
import { openSaveAs, useSaveStore } from "../world/save-world.js";
import { chooseWorldsFolder, hasFolderPicker } from "../world/world-library.js";
import { closeWorld } from "../world/world-session.js";
import { finishBrush, redoBrush, setBrushSize, undoBrush, useBrushStore } from "../world/brush-session.js";
import { WORLD_GROUP_IDS } from "../panels/world-fields.js";
import { cancelArea, copySelection, placePaste, startPaste, useAreaStore } from "../world/area-session.js";
import { MAX_AREA_TILES } from "../world/area-clipboard.js";
import { resetLayout, useLayoutStore, type ThemeChoice } from "./layout-store.js";
import { getMapController, useViewStore, type MapLayers, type ToolId } from "./view-store.js";

export type CommandGroup = "File" | "Edit" | "View" | "Layers" | "Tools" | "Assets" | "Help";

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

export interface ToolDefinition {
  readonly id: ToolId;
  readonly label: string;
  readonly icon: IconName;
  readonly shortcut: string;
  readonly group: "navigate" | "edit" | "objects";
  readonly available: boolean;
  /** One line for the tool options bar. */
  readonly hint: string;
}

const EDITING_LATER = "World editing is not available yet";

export const TOOLS: readonly ToolDefinition[] = [
  { id: "pan", label: "Pan", icon: "pan", shortcut: "H", group: "navigate", available: true, hint: "Drag to pan · Wheel or +/− to zoom · Arrow keys to move" },
  { id: "inspect", label: "Inspect", icon: "inspect", shortcut: "I", group: "navigate", available: true, hint: "Click a tile (or press Enter) to pin it in the Inspector · Hover to preview · Drag to pan" },
  { id: "brush", label: "Brush", icon: "brush", shortcut: "B", group: "edit", available: true, hint: "Drag to paint simple blocks or walls" },
  { id: "erase", label: "Erase", icon: "erase", shortcut: "E", group: "edit", available: true, hint: "Drag to erase the selected layer" },
  { id: "fill", label: "Fill", icon: "fill", shortcut: "G", group: "edit", available: false, hint: "" },
  { id: "select", label: "Select", icon: "select", shortcut: "M", group: "edit", available: true, hint: "Drag a rectangle · Ctrl+C to copy · Ctrl+V to paste" },
  { id: "picker", label: "Pick content", icon: "picker", shortcut: "K", group: "edit", available: false, hint: "" },
  { id: "object", label: "Place object", icon: "object", shortcut: "O", group: "objects", available: false, hint: "" },
];

export function toolCommands(tool: ToolId, setTool: (tool: ToolId) => void, editReason: string | null = "Open a vanilla world first"): Command[] {
  return TOOLS.map((definition) => {
    const reason = !definition.available ? EDITING_LATER : definition.id === "brush" || definition.id === "erase" || definition.id === "select" ? editReason : null;
    return ({
    id: `tool.${definition.id}`,
    group: "Tools",
    label: definition.label,
    icon: definition.icon,
    shortcut: definition.shortcut,
    enabled: reason === null,
    ...(reason === null ? {} : { disabledReason: reason }),
    checked: tool === definition.id,
    run: () => {
      finishBrush();
      setTool(definition.id);
    },
  });
  });
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
    ["tool.brushSwapLayer", "Swap block and wall target", "X", false, set((state) => ({ layer: state.layer === "block" ? "wall" : "block" }))],
    ["tool.brushBothLayers", "Target blocks and walls", "Shift+X", false, set(() => ({ layer: "both" }))],
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
  { layer: "wires", label: "Wires and actuators", shortcut: "Alt+6" },
];

/** Whether a layer row's eye is open (for wires: the group switch, whatever colours are chosen inside it). */
export function layerShown(layers: MapLayers, layer: (typeof LAYER_TOGGLES)[number]["layer"]): boolean {
  return layers[layer];
}

const WORLD_GROUP_KEYS = WORLD_GROUP_IDS.map((id) => `world/${id}`);

const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = { system: "Theme: follow system", dark: "Theme: dark", light: "Theme: light" };

/** The app's commands with their current state. */
export function useCommands(): Command[] {
  const hasWorld = useAppStore((state) => state.summary !== null);
  const loadingWorld = useAppStore((state) => state.phase === "loading");
  const saving = useSaveStore((state) => state.open);
  const unsaved = useAppStore((state) => state.unsavedChanges);
  const brushReason = useBrushStore((state) => state.reason);
  const canUndo = useBrushStore((state) => state.canUndo);
  const canRedo = useBrushStore((state) => state.canRedo);
  const area = useAreaStore();
  const areaCopyReason = area.pasting ? "Place or cancel the paste first" : area.selection === null ? "Select an area first"
    : area.selection.width * area.selection.height > MAX_AREA_TILES ? `Too large: select up to ${MAX_AREA_TILES.toLocaleString("en-US")} tiles` : null;
  const editReason = loadingWorld ? "A world is loading" : saving ? "Finish exporting first" : brushReason;
  const dockHidden = useLayoutStore((state) => state.dockHidden);
  const setDockHidden = useLayoutStore((state) => state.setDockHidden);
  const theme = useLayoutStore((state) => state.theme);
  const setTheme = useLayoutStore((state) => state.setTheme);
  const tool = useViewStore((state) => state.tool);
  const setTool = useViewStore((state) => state.setTool);
  const statsVisible = useViewStore((state) => state.statsVisible);
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
    { id: "edit.undo", group: "Edit", label: "Undo", icon: "undo", shortcut: "Control+Z", enabled: canUndo && editReason === null,
      ...(editReason !== null ? { disabledReason: editReason } : !canUndo ? { disabledReason: "No stroke to undo" } : {}), run: undoBrush },
    { id: "edit.redo", group: "Edit", label: "Redo", icon: "redo", shortcut: "Control+Shift+Z", enabled: canRedo && editReason === null,
      ...(editReason !== null ? { disabledReason: editReason } : !canRedo ? { disabledReason: "No stroke to redo" } : {}), run: redoBrush },
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
  // A printable key that needs Shift (e.g. `?`) is matched by the character; Shift is only compared for letters.
  if (/^[a-z]$/i.test(key) && event.shiftKey !== modifiers.has("Shift")) return false;
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
      if (event.defaultPrevented || event.repeat || isTextEntry(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[role=menu], dialog[open]") !== null) return;
      const matching = commands.filter((candidate) => candidate.shortcut !== undefined && matchesShortcut(event, candidate.shortcut));
      const command = matching.find((candidate) => candidate.enabled) ?? matching[0];
      if (command === undefined) return;
      if (command.id === "edit.placePaste" && event.target instanceof Element && event.target.closest("button, input, select, [role=button]") !== null) return;
      // Ctrl+C / Ctrl+V stay the browser's for selected page text and whenever there is no area to copy or paste.
      if ((command.id === "edit.copy" || command.id === "edit.paste") && (!command.enabled || window.getSelection()?.isCollapsed === false)) return;
      // A disabled Ctrl shortcut is still ours: Ctrl+S must not open the browser's "Save page" instead.
      if (!command.enabled) {
        if (event.ctrlKey || event.metaKey) event.preventDefault();
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
