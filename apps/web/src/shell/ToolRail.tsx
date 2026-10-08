import { useRef } from "react";
import { IconButton } from "../ui/IconButton.js";
import { TOOLS, type Command, type ToolDefinition } from "./commands.js";

const GROUPS: readonly { readonly id: ToolDefinition["group"]; readonly label: string }[] = [
  { id: "navigate", label: "Navigate" },
  { id: "edit", label: "Edit" },
  { id: "objects", label: "Objects" },
];

/**
 * The tool rail (WAI-ARIA toolbar): one Tab stop, the arrow keys move between tools, Enter or Space picks one.
 * Each tool also has a single-key shortcut. Tools that are not available yet stay visible and explain why.
 */
export function ToolRail({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  const rail = useRef<HTMLDivElement>(null);
  const toolCommands = new Map(commands.filter((command) => command.group === "Tools").map((command) => [command.id, command]));
  const activeIndex = Math.max(0, TOOLS.findIndex((tool) => toolCommands.get(`tool.${tool.id}`)?.checked === true));

  const onKeyDown = (event: React.KeyboardEvent): void => {
    const buttons = [...(rail.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = { ArrowDown: index + 1, ArrowRight: index + 1, ArrowUp: index - 1, ArrowLeft: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
    if (next === undefined || index < 0) return;
    event.preventDefault();
    const target = buttons[(next + buttons.length) % buttons.length];
    if (target === undefined) return;
    for (const button of buttons) button.tabIndex = button === target ? 0 : -1;
    target.focus();
  };

  return (
    <nav className="tool-rail" aria-label="Tools">
      <div ref={rail} className="tool-rail-toolbar" role="toolbar" aria-label="Tools" aria-orientation="vertical" onKeyDown={onKeyDown}>
      {GROUPS.map((group) => (
        <div key={group.id} className="tool-group" role="group" aria-label={group.label}>
          {TOOLS.filter((tool) => tool.group === group.id).map((tool) => {
            const command = toolCommands.get(`tool.${tool.id}`);
            if (command === undefined) return null;
            return (
              <ToolButton key={tool.id} command={command} tool={tool} tabbable={TOOLS.indexOf(tool) === activeIndex} />
            );
          })}
        </div>
      ))}
      </div>
    </nav>
  );
}

function ToolButton({ command, tool, tabbable }: { readonly command: Command; readonly tool: ToolDefinition; readonly tabbable: boolean }): React.JSX.Element {
  return (
    <IconButton
      icon={tool.icon}
      label={command.label}
      shortcut={command.shortcut}
      pressed={command.checked ?? false}
      disabled={!command.enabled}
      disabledReason={command.disabledReason}
      tooltipSide="right"
      className="tool-button"
      tabIndex={tabbable ? 0 : -1}
      onClick={command.run}
    />
  );
}
