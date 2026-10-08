import { useEffect } from "react";
import type { IconName } from "../ui/Icon.js";
import { useAppStore } from "../store.js";
import { chooseWorldFile } from "../world/open-world.js";
import { resetLayout, useLayoutStore, type ThemeChoice } from "./layout-store.js";
import { getMapController, useViewStore, type ToolId } from "./view-store.js";

export type CommandGroup = "File" | "View" | "Tools" | "Help";

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
  { id: "inspect", label: "Inspect", icon: "inspect", shortcut: "I", group: "navigate", available: true, hint: "Hover a tile to see what it is in the status bar · Drag to pan" },
  { id: "brush", label: "Brush", icon: "brush", shortcut: "B", group: "edit", available: false, hint: "" },
  { id: "erase", label: "Erase", icon: "erase", shortcut: "E", group: "edit", available: false, hint: "" },
  { id: "fill", label: "Fill", icon: "fill", shortcut: "G", group: "edit", available: false, hint: "" },
  { id: "select", label: "Select", icon: "select", shortcut: "M", group: "edit", available: false, hint: "" },
  { id: "picker", label: "Pick content", icon: "picker", shortcut: "K", group: "edit", available: false, hint: "" },
  { id: "object", label: "Place object", icon: "object", shortcut: "O", group: "objects", available: false, hint: "" },
];

export function toolCommands(tool: ToolId, setTool: (tool: ToolId) => void): Command[] {
  return TOOLS.map((definition) => ({
    id: `tool.${definition.id}`,
    group: "Tools",
    label: definition.label,
    icon: definition.icon,
    shortcut: definition.shortcut,
    enabled: definition.available,
    ...(definition.available ? {} : { disabledReason: EDITING_LATER }),
    checked: tool === definition.id,
    run: () => {
      setTool(definition.id);
    },
  }));
}

const THEME_LABELS: Readonly<Record<ThemeChoice, string>> = { system: "Theme: follow system", dark: "Theme: dark", light: "Theme: light" };

/** The app's commands with their current state. */
export function useCommands(): Command[] {
  const hasWorld = useAppStore((state) => state.summary !== null);
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
  const noWorld = hasWorld ? {} : { disabledReason: "Open a world first" };

  return [
    { id: "file.open", group: "File", label: "Open world…", icon: "open", shortcut: "Control+O", enabled: true, run: chooseWorldFile },
    { id: "file.export", group: "File", label: "Export world…", enabled: false, disabledReason: EDITING_LATER, run: () => undefined },
    { id: "file.assets", group: "File", label: "Connect Terraria assets…", enabled: false, disabledReason: "Sprite rendering is not available yet", run: () => undefined },
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
    ...toolCommands(tool, setTool),
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
 * menu or dialog (their keys belong to them). Disabled commands swallow nothing.
 */
export function useGlobalShortcuts(commands: readonly Command[]): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || isTextEntry(event.target)) return;
      if (event.target instanceof Element && event.target.closest("[role=menu], dialog[open]") !== null) return;
      const command = commands.find((candidate) => candidate.shortcut !== undefined && matchesShortcut(event, candidate.shortcut));
      if (!command?.enabled) return;
      event.preventDefault();
      command.run();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [commands]);
}
