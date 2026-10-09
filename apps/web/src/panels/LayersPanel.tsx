import { useMemo } from "react";
import type { MissingSheet } from "@studio/assets";
import { WIRE_COLORS, WIRE_LAYER } from "@studio/renderer";
import { buildFraction, getDefaultAssetSession, useAssetStore, type AssetStatus } from "../assets/asset-session.js";
import { contentWithoutSprite } from "../assets/sprite-coverage.js";
import { useAppStore } from "../store.js";
import { contentKey, contentName } from "../world/content-names.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { commandById, LAYER_TOGGLES, layerShown, type Command } from "../shell/commands.js";
import { useViewStore } from "../shell/view-store.js";
import { Icon } from "../ui/Icon.js";
import { MenuButton, type MenuItem } from "../ui/Menu.js";
import { ProgressBar } from "../ui/Progress.js";
import { VisibilityRow } from "../ui/Toggle.js";

const WIRE_ROWS: readonly { readonly bit: number; readonly label: string }[] = [
  { bit: WIRE_LAYER.red, label: "Red wire" },
  { bit: WIRE_LAYER.blue, label: "Blue wire" },
  { bit: WIRE_LAYER.green, label: "Green wire" },
  { bit: WIRE_LAYER.yellow, label: "Yellow wire" },
  { bit: WIRE_LAYER.actuator, label: "Actuators" },
];

function swatch(bit: number): React.CSSProperties {
  const [r, g, b] = WIRE_COLORS.find(([candidate]) => candidate === bit)?.[1] ?? [0, 0, 0];
  return { backgroundColor: `rgb(${String(r)} ${String(g)} ${String(b)})` };
}

function missingText(missing: readonly MissingSheet[]): string {
  const listed = missing.slice(0, 12).map((sheet) => `${sheet.name}: ${sheet.reason}`);
  const more = missing.length > listed.length ? [`… and ${String(missing.length - listed.length)} more`] : [];
  return [`${String(missing.length)} sheets could not be read; those tiles keep their map colour.`, ...listed, ...more].join("\n");
}

/** What the Sprites row says on its right: why it is off, the build's progress, or a problem. */
function SpritesStatus({ status }: { readonly status: AssetStatus }): React.JSX.Element | null {
  switch (status.kind) {
    case "none":
      return <span className="row-note">Not connected</span>;
    case "choosing":
      return <ProgressBar label="Waiting for the folder" title="Waiting for the browser to hand over the folder's files" fraction={0} waiting />;
    case "reconnect":
      return <span className="row-note" title={`Allow access to “${status.folderName}” again`}>Access needed</span>;
    case "building":
      return (
        <ProgressBar label="Building the sprite atlas" title={`Building the sprite atlas from “${status.folderName}”`} fraction={buildFraction(status)} />
      );
    case "ready":
      return status.missing.length === 0 ? null : (
        <span className="row-warning" role="img" aria-label={`${String(status.missing.length)} sheets could not be read`} title={missingText(status.missing)}>
          <Icon name="warning" />
        </span>
      );
  }
}

function spritesMenu(status: AssetStatus): MenuItem[] {
  const session = getDefaultAssetSession();
  const connect = (label: string): MenuItem => ({ kind: "action", label, onSelect: () => void session.connect() });
  switch (status.kind) {
    case "none":
      return [connect("Connect Terraria assets…")];
    case "choosing":
      return [{ kind: "action", label: "Cancel", onSelect: () => { session.cancel(); } }];
    case "reconnect":
      return [
        { kind: "action", label: `Allow access to “${status.folderName}”`, onSelect: () => void session.reconnect() },
        connect("Choose another folder…"),
        { kind: "action", label: "Disconnect", onSelect: () => void session.disconnect() },
      ];
    case "building":
      return [{ kind: "action", label: "Cancel building", onSelect: () => { session.cancel(); } }];
    case "ready":
      return [
        { kind: "action", label: "Preview sprite sheets…", onSelect: () => { useViewStore.getState().setSpritePreviewOpen(true); } },
        connect("Change folder…"),
        { kind: "separator" },
        { kind: "action", label: "Disconnect", onSelect: () => void session.disconnect() },
      ];
  }
}

/**
 * The open world's content drawn as the missing-texture checkerboard (placed with a frame, no sheet in the atlas),
 * listed once under the Sprites row. Nothing while the list is empty, without assets or without a world.
 */
function SpritelessContent(): React.JSX.Element | null {
  const status = useAssetStore((state) => state.status);
  const summary = useAppStore((state) => state.summary);
  const missing = useMemo(() => {
    const world = summary === null ? null : getDefaultWorldSession().getLoadedWorld();
    const atlas = status.kind === "ready" ? getDefaultAssetSession().getAtlas() : null;
    if (world === null || atlas === null) return [];
    const sheets = new Set(atlas.index.entries.filter((entry) => entry.kind === "tile").map((entry) => entry.id));
    return contentWithoutSprite(world.planes, world.palette, sheets);
  }, [status, summary]);
  if (missing.length === 0) return null;
  return (
    <details className="sprite-missing">
      <summary>
        {missing.length} {missing.length === 1 ? "type has" : "types have"} no sprite (shown as a magenta checkerboard)
      </summary>
      <ul>
        {missing.map((ref) => <li key={contentKey(ref)}>{contentName(ref, "block")} <code>{contentKey(ref)}</code></li>)}
      </ul>
    </details>
  );
}

/** The Sprites layer row: the same eye row as the other layers, with the Terraria assets' state and actions inline. */
function SpritesRow({ command }: { readonly command: Command }): React.JSX.Element {
  const status = useAssetStore((state) => state.status);
  return (
    <VisibilityRow label="Sprites" visible={command.checked ?? false} disabled={!command.enabled} shortcut="Alt+1" onChange={command.run}>
      <SpritesStatus status={status} />
      <MenuButton label="Terraria assets" icon="more" items={spritesMenu(status)} align="end" />
    </VisibilityRow>
  );
}

/**
 * Layer visibility (eye rows). Toggling a layer changes a renderer uniform only: no chunk is re-uploaded or re-parsed.
 * With editing, each row also gets a lock (docs/ui.md).
 */
export function LayersPanel({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  const layers = useViewStore((state) => state.layers);
  const setLayers = useViewStore((state) => state.setLayers);
  return (
    <div className="layers-panel" role="group" aria-label="Map layers">
      <SpritesRow command={commandById(commands, "layer.sprites")} />
      <SpritelessContent />
      {LAYER_TOGGLES.map(({ layer, label, shortcut }) => {
        const command = commandById(commands, `layer.${layer}`);
        return (
          <div key={layer}>
            <VisibilityRow label={label} visible={layerShown(layers, layer)} shortcut={shortcut} onChange={command.run} />
            {layer === "wires" && (
              <div className="visibility-children" role="group" aria-label="Wire colours" data-parent-visible={layers.wires}>
                {WIRE_ROWS.map(({ bit, label: wireLabel }) => (
                  <VisibilityRow
                    key={bit}
                    label={wireLabel}
                    visible={(layers.wireMask & bit) !== 0}
                    onChange={(visible) => {
                      setLayers({ wireMask: visible ? layers.wireMask | bit : layers.wireMask & ~bit });
                    }}
                  >
                    <span className="swatch" style={swatch(bit)} aria-hidden="true" />
                  </VisibilityRow>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
