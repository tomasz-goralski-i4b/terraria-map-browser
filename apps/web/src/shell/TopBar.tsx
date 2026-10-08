import { useEffect, useRef } from "react";
import { useAppStore } from "../store.js";
import { Icon } from "../ui/Icon.js";
import { IconButton } from "../ui/IconButton.js";
import { MenuButton, type MenuItem } from "../ui/Menu.js";
import { formatBytes } from "../panels/world-fields.js";
import { registerFileInput } from "../world/open-world.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { commandById, type Command } from "./commands.js";

function menuItem(command: Command): MenuItem {
  if (command.checked !== undefined) {
    return {
      kind: "check", label: command.label, checked: command.checked, disabled: !command.enabled, onChange: command.run,
      ...(command.shortcut === undefined ? {} : { shortcut: command.shortcut }),
    };
  }
  return {
    kind: "action", label: command.enabled || command.disabledReason === undefined ? command.label : `${command.label} — ${command.disabledReason}`,
    ...(command.shortcut === undefined ? {} : { shortcut: command.shortcut }), disabled: !command.enabled, onSelect: command.run,
  };
}

function themeMenuItems(commands: readonly Command[]): MenuItem[] {
  return commands.filter((command) => command.id.startsWith("view.theme.")).map(menuItem);
}

/** App menu, the open world's name and size, and the global actions. Nothing else lives here. */
export function TopBar({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  const summary = useAppStore((state) => state.summary);
  const input = useRef<HTMLInputElement>(null);
  const get = (id: string): Command => commandById(commands, id);

  useEffect(() => {
    registerFileInput(input.current);
    return () => {
      registerFileInput(null);
    };
  }, []);

  const appMenu: MenuItem[] = [
    menuItem(get("file.open")),
    { kind: "action", label: "Recent worlds — not available yet", disabled: true, onSelect: () => undefined },
    menuItem(get("file.export")),
    { kind: "separator" },
    menuItem(get("file.assets")),
    { kind: "separator" },
    menuItem(get("view.dock")),
    menuItem(get("view.stats")),
    menuItem(get("view.reset")),
    ...themeMenuItems(commands),
    { kind: "separator" },
    menuItem(get("help.palette")),
    menuItem(get("help.shortcuts")),
  ];
  const themeMenu = themeMenuItems(commands);
  const dock = get("view.dock");
  const open = get("file.open");
  const assets = get("file.assets");

  return (
    <header className="top-bar">
      <MenuButton label="App menu" icon="menu" items={appMenu} />
      <h1 className="brand">Terraria Map Studio</h1>
      <div className="world-title" aria-live="polite">
        {summary === null ? (
          <span className="muted">No world open</span>
        ) : (
          <>
            <span className="world-name">{summary.name}</span>
            <span className="muted">{summary.fileName} · {formatBytes(summary.fileSize)}</span>
          </>
        )}
      </div>
      <nav className="top-actions" aria-label="Actions">
        <button type="button" className="button button-primary" aria-label="Open .wld world" aria-keyshortcuts={open.shortcut} onClick={open.run}>
          <Icon name="open" />
          <span className="button-label">Open .wld world</span>
        </button>
        <button type="button" className="button" aria-disabled="true" title={assets.disabledReason}>
          Connect Terraria assets
        </button>
        <span className="top-divider hide-on-phone" aria-hidden="true" />
        <span className="hide-on-phone">
          <IconButton icon="command" label="Command palette" shortcut="Control+K" onClick={get("help.palette").run} />
        </span>
        <MenuButton label="Theme" icon="theme" items={themeMenu} align="end" className="hide-on-phone" />
        <span className="hide-on-phone">
          <IconButton icon="help" label="Keyboard shortcuts" shortcut="Shift+?" onClick={get("help.shortcuts").run} />
        </span>
        <IconButton icon="dock" label="Show panels" shortcut="P" pressed={dock.checked ?? false} onClick={dock.run} />
      </nav>
      <input
        ref={input}
        type="file"
        accept=".wld"
        hidden
        aria-label="World file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = ""; // allow picking the same file again
          if (file !== undefined) void getDefaultWorldSession().open(file);
        }}
      />
    </header>
  );
}
