import { useRef, useState, useSyncExternalStore } from "react";
import { ContextMenu, type ContextMenuState } from "../ui/ContextMenu.js";
import { IconButton } from "../ui/IconButton.js";
import type { MenuItem } from "../ui/Menu.js";
import { TOOL_FAMILIES, TOOLS, type Command, type ToolDefinition, type ToolFamily, type ToolGroup } from "./commands.js";
import { useViewStore, type ToolId } from "./view-store.js";

const GROUPS: readonly { readonly id: ToolGroup; readonly label: string }[] = [
  { id: "navigate", label: "Navigate" },
  { id: "edit", label: "Edit" },
  { id: "build", label: "Build" },
];

/** Must match the narrow-screen breakpoint in styles.css, where the rail becomes a row. */
const NARROW_QUERY = "(max-width: 1023px)";
/** How long a press rests on a family button before its tools open, as in image editors. */
const LONG_PRESS_MS = 400;

function subscribeNarrow(onChange: () => void): () => void {
  const query = window.matchMedia(NARROW_QUERY);
  query.addEventListener("change", onChange);
  return () => {
    query.removeEventListener("change", onChange);
  };
}

function isNarrow(): boolean {
  return window.matchMedia(NARROW_QUERY).matches;
}

const membersOf = (family: ToolFamily): readonly ToolDefinition[] => TOOLS.filter((tool) => tool.family === family.id);

/** The tool a family's button stands for: the active one, else the one it had last, else its first available one. */
function shownTool(family: ToolFamily, active: ToolId, last: ToolId | undefined, commands: ReadonlyMap<string, Command>): ToolDefinition | undefined {
  const members = membersOf(family);
  return members.find((tool) => tool.id === active)
    ?? members.find((tool) => tool.id === last)
    ?? members.find((tool) => commands.get(`tool.${tool.id}`)?.enabled === true)
    ?? members[0];
}

function FamilyButton({ family, active, commands, narrow, tabStop, onFocusFamily }: {
  readonly family: ToolFamily;
  readonly active: ToolId;
  readonly commands: ReadonlyMap<string, Command>;
  readonly narrow: boolean;
  readonly tabStop: boolean;
  readonly onFocusFamily: () => void;
}): React.JSX.Element | null {
  const last = useViewStore((state) => state.familyTools[family.id]);
  const [flyout, setFlyout] = useState<ContextMenuState | null>(null);
  const root = useRef<HTMLSpanElement>(null);
  const timer = useRef<number | undefined>(undefined);
  const longPressed = useRef(false);
  const members = membersOf(family);
  const tool = shownTool(family, active, last, commands);
  const command = tool === undefined ? undefined : commands.get(`tool.${tool.id}`);
  if (tool === undefined || command === undefined) return null;
  const several = members.length > 1;
  const familyCommand = commands.get(`family.${family.id}`);
  const open = (): void => {
    const rect = root.current?.getBoundingClientRect();
    if (rect !== undefined) setFlyout(narrow ? { x: rect.left, y: rect.bottom + 2 } : { x: rect.right + 2, y: rect.top });
  };
  const items: MenuItem[] = [
    { kind: "heading", label: family.label },
    ...members.map((member): MenuItem => {
      const memberCommand = commands.get(`tool.${member.id}`);
      const shortcut = member.shortcut ?? family.shortcut;
      return {
        kind: "action", label: member.label, icon: member.icon, disabled: memberCommand?.enabled !== true,
        ...(member.id === active ? { detail: "Active" } : shortcut === undefined ? {} : { shortcut }),
        ...(memberCommand?.enabled === true || memberCommand?.disabledReason === undefined ? {} : { disabledReason: memberCommand.disabledReason }),
        onSelect: () => { memberCommand?.run(); },
      };
    }),
  ];
  const noneAvailable = several && familyCommand?.enabled === false;
  return (<>
    <span
      ref={root} className="tool-slot" data-family={several || undefined} data-unavailable={noneAvailable || undefined}
      onContextMenu={(event) => { if (several) { event.preventDefault(); open(); } }}
      onPointerDown={(event) => {
        if (!several || event.button !== 0) return;
        longPressed.current = false;
        timer.current = window.setTimeout(() => { longPressed.current = true; open(); }, LONG_PRESS_MS);
      }}
      onPointerUp={() => { window.clearTimeout(timer.current); }}
      onPointerLeave={() => { window.clearTimeout(timer.current); }}
      onFocus={onFocusFamily}
      onKeyDown={(event) => {
        if (several && event.key === (narrow ? "ArrowDown" : "ArrowRight")) {
          event.preventDefault();
          event.stopPropagation();
          open();
        }
      }}
    >
      <IconButton
        icon={tool.icon}
        label={command.label}
        {...(several ? { tooltip: `${command.label} · ${family.label}: right-click or hold for more`, hasMenu: true } : {})}
        shortcut={family.shortcut ?? command.shortcut}
        pressed={command.checked ?? false}
        // A family with nothing available still opens, so its tools and their reasons can be read.
        disabled={!command.enabled && !several}
        disabledReason={command.disabledReason}
        tooltipSide={narrow ? "bottom" : "right"}
        className={several ? "tool-button tool-family" : "tool-button"}
        tabIndex={tabStop ? 0 : -1}
        dataTool={family.id}
        onClick={() => {
          if (longPressed.current) { longPressed.current = false; return; }
          if (command.enabled) command.run();
          else open();
        }}
      />
    </span>
    {flyout !== null && <ContextMenu at={flyout} label={family.label} items={items} onClose={() => { setFlyout(null); }} />}
  </>);
}

/**
 * The tool rail (WAI-ARIA toolbar): one button per tool family, one Tab stop, the arrow keys move between buttons and
 * Enter or Space picks the family's tool. A family of several tools has a corner mark; right-click, a long press or →
 * (↓ on narrow screens) opens its tools. Tools that are not available yet stay listed and say why.
 *
 * Roving focus lives in React state: the Tab stop is the family focused last by arrow keys, until the active tool
 * changes (click or shortcut), which moves the Tab stop to the active tool's family. So exactly one button is tabbable.
 */
export function ToolRail({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  const rail = useRef<HTMLDivElement>(null);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const toolCommands = new Map(commands.filter((command) => command.group === "Tools").map((command) => [command.id, command]));
  const activeTool: ToolId = TOOLS.find((tool) => toolCommands.get(`tool.${tool.id}`)?.checked === true)?.id ?? "pan";
  const activeFamily = TOOLS.find((tool) => tool.id === activeTool)?.family ?? "pan";
  const [focused, setFocused] = useState<{ readonly family: string; readonly whileActive: ToolId } | null>(null);
  // A roving position taken while another tool was active is stale once the active tool changes.
  const tabStop = focused !== null && focused.whileActive === activeTool ? focused.family : activeFamily;

  const onKeyDown = (event: React.KeyboardEvent): void => {
    // An open family's tools are a menu with keys of its own.
    if (event.target instanceof Element && event.target.closest(".context-menu") !== null) return;
    const current = (document.activeElement as HTMLElement | null)?.dataset["tool"];
    const index = TOOL_FAMILIES.findIndex((family) => family.id === current);
    const forward = narrow ? "ArrowRight" : "ArrowDown";
    const back = narrow ? "ArrowLeft" : "ArrowUp";
    const next = { [forward]: index + 1, [back]: index - 1, Home: 0, End: TOOL_FAMILIES.length - 1 }[event.key];
    if (next === undefined || index < 0) return;
    event.preventDefault();
    const target = TOOL_FAMILIES[(next + TOOL_FAMILIES.length) % TOOL_FAMILIES.length];
    if (target === undefined) return;
    setFocused({ family: target.id, whileActive: activeTool });
    rail.current?.querySelector<HTMLButtonElement>(`[data-tool="${target.id}"]`)?.focus();
  };

  return (
    <nav className="tool-rail" aria-label="Tools">
      <div ref={rail} className="tool-rail-toolbar" role="toolbar" aria-label="Tools" aria-orientation={narrow ? "horizontal" : "vertical"} onKeyDown={onKeyDown}>
        {GROUPS.map((group) => (
          <div key={group.id} className="tool-group" role="group" aria-label={group.label}>
            {TOOL_FAMILIES.filter((family) => family.group === group.id).map((family) => (
              <FamilyButton
                key={family.id} family={family} active={activeTool} commands={toolCommands} narrow={narrow} tabStop={family.id === tabStop}
                onFocusFamily={() => { if (family.id !== tabStop) setFocused({ family: family.id, whileActive: activeTool }); }}
              />
            ))}
          </div>
        ))}
      </div>
    </nav>
  );
}
