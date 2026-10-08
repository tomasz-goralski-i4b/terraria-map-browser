import { useRef, useState, useSyncExternalStore } from "react";
import { IconButton } from "../ui/IconButton.js";
import { TOOLS, type Command, type ToolDefinition } from "./commands.js";
import type { ToolId } from "./view-store.js";

const GROUPS: readonly { readonly id: ToolDefinition["group"]; readonly label: string }[] = [
  { id: "navigate", label: "Navigate" },
  { id: "edit", label: "Edit" },
  { id: "objects", label: "Objects" },
];

/** Must match the narrow-screen breakpoint in styles.css, where the rail becomes a row. */
const NARROW_QUERY = "(max-width: 1023px)";

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

/**
 * The tool rail (WAI-ARIA toolbar): one Tab stop, the arrow keys move between tools, Enter or Space picks one.
 * Each tool also has a single-key shortcut. Tools that are not available yet stay visible and explain why.
 *
 * Roving focus lives in React state: the Tab stop is the tool focused last by arrow keys, until the active tool
 * changes (click or shortcut), which moves the Tab stop to the active tool. So exactly one tool is ever tabbable.
 */
export function ToolRail({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  const rail = useRef<HTMLDivElement>(null);
  const narrow = useSyncExternalStore(subscribeNarrow, isNarrow);
  const toolCommands = new Map(commands.filter((command) => command.group === "Tools").map((command) => [command.id, command]));
  const activeTool: ToolId = TOOLS.find((tool) => toolCommands.get(`tool.${tool.id}`)?.checked === true)?.id ?? "pan";
  const [focused, setFocused] = useState<{ readonly tool: ToolId; readonly whileActive: ToolId } | null>(null);
  // A roving position taken while another tool was active is stale once the active tool changes.
  const tabStop = focused !== null && focused.whileActive === activeTool ? focused.tool : activeTool;

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const current = (document.activeElement as HTMLElement | null)?.dataset["tool"];
    const index = TOOLS.findIndex((tool) => tool.id === current);
    const forward = narrow ? "ArrowRight" : "ArrowDown";
    const back = narrow ? "ArrowLeft" : "ArrowUp";
    const next = { [forward]: index + 1, [back]: index - 1, Home: 0, End: TOOLS.length - 1 }[event.key];
    if (next === undefined || index < 0) return;
    event.preventDefault();
    const target = TOOLS[(next + TOOLS.length) % TOOLS.length];
    if (target === undefined) return;
    setFocused({ tool: target.id, whileActive: activeTool });
    rail.current?.querySelector<HTMLButtonElement>(`[data-tool="${target.id}"]`)?.focus();
  };

  return (
    <nav className="tool-rail" aria-label="Tools">
      <div ref={rail} className="tool-rail-toolbar" role="toolbar" aria-label="Tools" aria-orientation={narrow ? "horizontal" : "vertical"} onKeyDown={onKeyDown}>
        {GROUPS.map((group) => (
          <div key={group.id} className="tool-group" role="group" aria-label={group.label}>
            {TOOLS.filter((tool) => tool.group === group.id).map((tool) => {
              const command = toolCommands.get(`tool.${tool.id}`);
              if (command === undefined) return null;
              return (
                <IconButton
                  key={tool.id}
                  icon={tool.icon}
                  label={command.label}
                  shortcut={command.shortcut}
                  pressed={command.checked ?? false}
                  disabled={!command.enabled}
                  disabledReason={command.disabledReason}
                  tooltipSide={narrow ? "bottom" : "right"}
                  className="tool-button"
                  tabIndex={tool.id === tabStop ? 0 : -1}
                  dataTool={tool.id}
                  onClick={command.run}
                />
              );
            })}
          </div>
        ))}
      </div>
    </nav>
  );
}
