import { useAssetStore } from "../assets/asset-session.js";
import { formatBytes } from "../panels/world-fields.js";
import type { Command } from "../shell/commands.js";
import { Icon, type IconName } from "../ui/Icon.js";
import { shortcutText } from "../ui/IconButton.js";
import { useNow } from "../ui/use-now.js";
import {
  formatAge, openFolderWorld, openRecentWorld, reconnectWorldsFolder, useWorldLibrary,
} from "../world/world-library.js";

const LIST_LIMIT = 8;

function StartAction({ command, icon, label }: { readonly command: Command | undefined; readonly icon: IconName; readonly label?: string }): React.JSX.Element | null {
  if (command === undefined) return null;
  return (
    <button
      type="button" className="start-action" aria-label={label ?? command.label} aria-keyshortcuts={command.shortcut}
      disabled={!command.enabled} title={command.enabled ? undefined : command.disabledReason} onClick={command.run}
    >
      <Icon name={icon} />
      <span className="start-action-label">{label ?? command.label}</span>
      {command.shortcut !== undefined && <kbd>{shortcutText(command.shortcut)}</kbd>}
    </button>
  );
}

function WorldRow({ name, detail, onOpen }: { readonly name: string; readonly detail: string; readonly onOpen: () => void }): React.JSX.Element {
  return (
    <li>
      <button type="button" className="start-world" onClick={onOpen}>
        <Icon name="world" />
        <span className="start-world-name">{name}</span>
        <span className="start-world-detail">{detail}</span>
      </button>
    </li>
  );
}

/**
 * The empty map, as an editor's start page: how to open a world, the worlds of the remembered folder and the recent
 * ones, and where Terraria keeps its worlds. It also says plainly that files stay on this computer.
 */
export function StartScreen({ commands }: { readonly commands?: readonly Command[] | undefined }): React.JSX.Element {
  const folder = useWorldLibrary((state) => state.folder);
  const recent = useWorldLibrary((state) => state.recent);
  const assetsReady = useAssetStore((state) => state.status.kind === "ready");
  const find = (id: string): Command | undefined => commands?.find((command) => command.id === id);
  const now = useNow();

  return (
    <section className="start" aria-label="Start">
      <div className="start-hero">
        <span className="brand-mark brand-mark-large" aria-hidden="true" />
        <div>
          <h2 className="start-title">Terraria Map Studio</h2>
          <p className="start-lead">Open a world to explore its map. Worlds are read on this computer and never uploaded.</p>
        </div>
      </div>
      <div className="start-columns">
        <div className="start-column">
          <h3 className="start-heading">Start</h3>
          <StartAction command={find("file.open")} icon="file" />
          <StartAction command={find("file.openFolder")} icon="folder" label="Open Worlds Folder…" />
          {!assetsReady && <StartAction command={find("file.assets")} icon="object" />}
          <p className="start-hint">Or drop a .wld file here.</p>
        </div>
        <div className="start-column">
          {folder.kind === "ready" && (
            <>
              <h3 className="start-heading">Worlds in “{folder.name}”</h3>
              {folder.worlds.length === 0
                ? <p className="start-hint">This folder has no .wld files.</p>
                : (
                  <ul className="start-list" aria-label={`Worlds in ${folder.name}`}>
                    {folder.worlds.slice(0, LIST_LIMIT).map((world) => (
                      <WorldRow
                        key={world.fileName} name={world.fileName.replace(/\.wld$/i, "")}
                        detail={`${formatBytes(world.size)} · ${formatAge(world.modified, now)}`}
                        onOpen={() => void openFolderWorld(world.fileName)}
                      />
                    ))}
                  </ul>
                )}
            </>
          )}
          {folder.kind === "permission" && (
            <>
              <h3 className="start-heading">Worlds in “{folder.name}”</h3>
              <button type="button" className="start-action" onClick={() => void reconnectWorldsFolder()}>
                <Icon name="lock" />
                <span className="start-action-label">Allow access to “{folder.name}” again</span>
              </button>
            </>
          )}
          {recent.length > 0 && (
            <>
              <h3 className="start-heading">Recent</h3>
              <ul className="start-list" aria-label="Recent worlds">
                {recent.slice(0, LIST_LIMIT).map((world, index) => (
                  <WorldRow
                    key={`${world.fileName}-${String(world.openedAt)}`} name={world.worldName}
                    detail={`${world.fileName} · ${formatAge(world.openedAt, now)}`}
                    onOpen={() => void openRecentWorld(index)}
                  />
                ))}
              </ul>
            </>
          )}
          {folder.kind !== "ready" && folder.kind !== "permission" && recent.length === 0 && (
            <>
              <h3 className="start-heading">Where are my worlds?</h3>
              <p className="start-hint">Terraria keeps them in</p>
              <code className="start-path">Documents\My Games\Terraria\Worlds</code>
              <p className="start-hint">and tModLoader in</p>
              <code className="start-path">Documents\My Games\Terraria\tModLoader\Worlds</code>
              <p className="start-hint">Open that folder once and its worlds stay listed here and in File ▸ Worlds.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
