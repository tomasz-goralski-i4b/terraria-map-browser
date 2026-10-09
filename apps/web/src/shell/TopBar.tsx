import { useEffect, useRef } from "react";
import { buildFraction, useAssetStore, type AssetStatus } from "../assets/asset-session.js";
import { useAppStore } from "../store.js";
import { IconButton } from "../ui/IconButton.js";
import { MenuBar, type MenuBarMenu, type MenuItem } from "../ui/Menu.js";
import { ProgressFill } from "../ui/Progress.js";
import { useNow } from "../ui/use-now.js";
import { formatBytes } from "../panels/world-fields.js";
import { registerFileInput } from "../world/open-world.js";
import {
  chooseWorldsFolder, clearRecentWorlds, forgetWorldsFolder, formatAge, openFolderWorld, openRecentWorld,
  reconnectWorldsFolder, useWorldLibrary, type RecentWorld, type WorldsFolderState,
} from "../world/world-library.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { commandById, type Command } from "./commands.js";

/**
 * The asset button: the connect action, the build's progress drawn on the button itself (so it shows with the Layers
 * panel closed), and greyed out once a valid folder is connected. Changing the folder stays in the Assets menu and the
 * Layers panel.
 */
function assetsButton(status: AssetStatus): { readonly label: string; readonly inactive: boolean; readonly title?: string } {
  switch (status.kind) {
    case "choosing":
      return { label: "Waiting for the folder…", inactive: true, title: "With thousands of files the browser takes a few seconds to hand them over" };
    case "building":
      return { label: `Building sprites ${String(Math.floor(buildFraction(status) * 100))}%`, inactive: true, title: "The sprite atlas is being built" };
    case "ready":
      return { label: "Terraria assets connected", inactive: true, title: `From “${status.folderName}”. Change the folder in the Assets menu or the Layers panel.` };
    default:
      return { label: "Connect Terraria assets", inactive: false };
  }
}

export function menuItem(command: Command): MenuItem {
  if (command.checked !== undefined) {
    return {
      kind: "check", label: command.label, checked: command.checked, disabled: !command.enabled, onChange: command.run,
      ...(command.shortcut === undefined ? {} : { shortcut: command.shortcut }),
    };
  }
  return {
    kind: "action", label: command.label, disabled: !command.enabled, onSelect: command.run,
    ...(command.icon === undefined ? {} : { icon: command.icon }),
    ...(command.shortcut === undefined ? {} : { shortcut: command.shortcut }),
    ...(command.enabled || command.disabledReason === undefined ? {} : { disabledReason: command.disabledReason }),
  };
}

/** File ▸ Worlds: the worlds in the remembered folder, newest first, or what is needed to list them. */
function worldsMenu(folder: WorldsFolderState, now: number): MenuItem {
  const another: MenuItem = { kind: "action", label: "Choose Another Folder…", icon: "folder", onSelect: () => void chooseWorldsFolder() };
  const forget: MenuItem = { kind: "action", label: "Forget This Folder", onSelect: () => void forgetWorldsFolder() };
  switch (folder.kind) {
    case "none":
      return { kind: "submenu", label: "Worlds", icon: "world", items: [], disabled: true, disabledReason: "Open a folder first" };
    case "permission":
      return {
        kind: "submenu", label: "Worlds", icon: "world",
        items: [
          { kind: "heading", label: `“${folder.name}”` },
          { kind: "action", label: `Allow Access to “${folder.name}”`, icon: "lock", onSelect: () => void reconnectWorldsFolder() },
          { kind: "separator" }, another, forget,
        ],
      };
    case "listing":
      return { kind: "submenu", label: "Worlds", icon: "world", items: [{ kind: "action", label: `Reading “${folder.name}”…`, disabled: true, onSelect: () => undefined }] };
    case "failed":
      return {
        kind: "submenu", label: "Worlds", icon: "world",
        items: [
          { kind: "action", label: `Could not read “${folder.name}”`, disabled: true, disabledReason: folder.message, onSelect: () => undefined },
          { kind: "separator" }, another, forget,
        ],
      };
    case "ready": {
      const worlds: MenuItem[] = folder.worlds.length === 0
        ? [{ kind: "action", label: "No .wld files in this folder", disabled: true, onSelect: () => undefined }]
        : folder.worlds.map((world) => ({
          kind: "action", label: world.fileName.replace(/\.wld$/i, ""), icon: "world",
          detail: `${formatBytes(world.size)} · ${formatAge(world.modified, now)}`,
          onSelect: () => void openFolderWorld(world.fileName),
        }));
      return { kind: "submenu", label: "Worlds", icon: "world", items: [{ kind: "heading", label: `“${folder.name}”` }, ...worlds, { kind: "separator" }, another, forget] };
    }
  }
}

function recentMenu(recent: readonly RecentWorld[], now: number): MenuItem {
  const items: MenuItem[] = recent.length === 0
    ? [{ kind: "action", label: "No recent worlds", disabled: true, onSelect: () => undefined }]
    : [
      ...recent.map((world, index): MenuItem => ({
        kind: "action", label: world.worldName, detail: `${world.fileName} · ${formatAge(world.openedAt, now)}`,
        onSelect: () => void openRecentWorld(index),
      })),
      { kind: "separator" },
      { kind: "action", label: "Clear Recent", onSelect: () => void clearRecentWorlds() },
    ];
  return { kind: "submenu", label: "Open Recent", icon: "clock", items };
}

/** The menu bar, the open world's name and file, and the global actions. Nothing else lives here. */
export function TopBar({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  const summary = useAppStore((state) => state.summary);
  const unsaved = useAppStore((state) => state.unsavedChanges);
  const input = useRef<HTMLInputElement>(null);
  const assetStatus = useAssetStore((state) => state.status);
  const folder = useWorldLibrary((state) => state.folder);
  const recent = useWorldLibrary((state) => state.recent);
  const now = useNow();
  const get = (id: string): Command => commandById(commands, id);

  useEffect(() => {
    registerFileInput(input.current);
    return () => {
      registerFileInput(null);
    };
  }, []);

  const menus: MenuBarMenu[] = [
    {
      label: "File", mnemonic: "F",
      items: [
        menuItem(get("file.open")),
        menuItem(get("file.openFolder")),
        worldsMenu(folder, now),
        recentMenu(recent, now),
        { kind: "separator" },
        menuItem(get("file.save")),
        menuItem(get("file.saveAs")),
        { kind: "separator" },
        menuItem(get("file.close")),
      ],
    },
    {
      label: "View", mnemonic: "V",
      items: [
        menuItem(get("view.dock")),
        { kind: "separator" },
        menuItem(get("view.fit")),
        menuItem(get("view.actual")),
        { kind: "separator" },
        menuItem(get("view.stats")),
        { kind: "submenu", label: "Theme", icon: "theme", items: commands.filter((command) => command.id.startsWith("view.theme.")).map(menuItem) },
        menuItem(get("view.reset")),
      ],
    },
    {
      label: "Assets", mnemonic: "A",
      items: [menuItem(get("file.assets")), menuItem(get("file.sprites")), { kind: "separator" }, menuItem(get("file.disconnectAssets"))],
    },
    {
      label: "Help", mnemonic: "H",
      items: [menuItem(get("help.palette")), menuItem(get("help.shortcuts"))],
    },
  ];
  const dock = get("view.dock");
  const assets = get("file.assets");
  const assetButton = assetsButton(assetStatus);

  return (
    <header className="top-bar">
      <span className="brand-mark" aria-hidden="true" />
      <h1 className="visually-hidden">Terraria Map Studio</h1>
      <MenuBar label="Main menu" menus={menus} />
      <div className="world-title" aria-live="polite">
        {summary === null ? (
          <span className="muted">Terraria Map Studio</span>
        ) : (
          <>
            <span className="world-name">{summary.name}</span>
            {unsaved && <span className="unsaved-dot" role="img" aria-label="Unsaved changes" title="Unsaved changes" />}
            <span className="world-file muted">{summary.fileName} · {formatBytes(summary.fileSize)} · format {summary.formatVersion}</span>
          </>
        )}
      </div>
      <nav className="top-actions" aria-label="Actions">
        <button
          type="button" className="button button-quiet assets-button" aria-disabled={assetButton.inactive || !assets.enabled || undefined}
          title={assetButton.title ?? assets.disabledReason}
          onClick={() => {
            if (!assetButton.inactive && assets.enabled) assets.run();
          }}
        >
          {(assetStatus.kind === "building" || assetStatus.kind === "choosing") && (
            <ProgressFill fraction={buildFraction(assetStatus)} waiting={assetStatus.kind === "choosing"} />
          )}
          <span className="assets-dot" data-state={assetStatus.kind} aria-hidden="true" />
          <span className="button-label">{assetButton.label}</span>
        </button>
        <span className="top-divider hide-on-phone" aria-hidden="true" />
        <span className="hide-on-phone">
          <IconButton icon="command" label="Command palette" shortcut="Control+K" onClick={get("help.palette").run} />
        </span>
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
