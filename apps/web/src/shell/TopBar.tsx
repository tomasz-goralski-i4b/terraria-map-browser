import { useEffect, useRef } from "react";
import { buildFraction, useAssetStore, type AssetStatus } from "../assets/asset-session.js";
import { useAppStore } from "../store.js";
import { Icon } from "../ui/Icon.js";
import { IconButton } from "../ui/IconButton.js";
import { MenuButton, type MenuItem } from "../ui/Menu.js";
import { ProgressFill } from "../ui/Progress.js";
import { formatBytes } from "../panels/world-fields.js";
import { registerFileInput } from "../world/open-world.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { commandById, type Command } from "./commands.js";

/**
 * The asset button: the connect action, the build's progress drawn on the button itself (so it shows with the Layers
 * panel closed), and greyed out once a valid folder is connected. Changing the folder stays in the app menu and the
 * Layers panel.
 */
function assetsButton(status: AssetStatus): { readonly label: string; readonly inactive: boolean; readonly title?: string } {
  switch (status.kind) {
    case "choosing":
      return { label: "Waiting for the folder…", inactive: true, title: "With thousands of files the browser takes a few seconds to hand them over" };
    case "building":
      return { label: `Building sprites ${String(Math.floor(buildFraction(status) * 100))}%`, inactive: true, title: "The sprite atlas is being built" };
    case "ready":
      return { label: "Terraria assets connected", inactive: true, title: `From “${status.folderName}”. Change the folder in the app menu or the Layers panel.` };
    default:
      return { label: "Connect Terraria assets", inactive: false };
  }
}

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
  const assetStatus = useAssetStore((state) => state.status);
  const get = (id: string): Command => commandById(commands, id);

  useEffect(() => {
    registerFileInput(input.current);
    return () => {
      registerFileInput(null);
    };
  }, []);

  const appMenu: MenuItem[] = [
    menuItem(get("file.open")),
    menuItem(get("file.openFolder")),
    { kind: "action", label: "Recent worlds — not available yet", disabled: true, onSelect: () => undefined },
    menuItem(get("file.export")),
    menuItem(get("file.saveCopy")),
    { kind: "separator" },
    menuItem(get("file.assets")),
    menuItem(get("file.sprites")),
    menuItem(get("file.disconnectAssets")),
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
  const openFolder = get("file.openFolder");
  const assets = get("file.assets");
  const assetButton = assetsButton(assetStatus);

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
        <button type="button" className="button world-folder-button" aria-label={openFolder.label} disabled={!openFolder.enabled} title={openFolder.disabledReason} onClick={openFolder.run}>
          <Icon name="open" /><span className="button-label">{openFolder.label}</span>
        </button>
        <button
          type="button" className="button assets-button" aria-disabled={assetButton.inactive || !assets.enabled || undefined}
          title={assetButton.title ?? assets.disabledReason}
          onClick={() => {
            if (!assetButton.inactive && assets.enabled) assets.run();
          }}
        >
          {(assetStatus.kind === "building" || assetStatus.kind === "choosing") && (
            <ProgressFill fraction={buildFraction(assetStatus)} waiting={assetStatus.kind === "choosing"} />
          )}
          <span className="button-label">{assetButton.label}</span>
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
