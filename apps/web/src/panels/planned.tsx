import { Icon, type IconName } from "../ui/Icon.js";
import { commandById, type Command } from "../shell/commands.js";

/**
 * The empty state of a panel whose feature is not connected yet: what it is for, and its one action (disabled with
 * the action's own reason until the feature lands).
 */
function PlannedPanel({ icon, text, action }: { readonly icon: IconName; readonly text: string; readonly action?: Command }): React.JSX.Element {
  return (
    <div className="panel-planned">
      <Icon name={icon} className="panel-planned-icon" />
      <p>{text}</p>
      {action !== undefined && (
        <button
          type="button" className="button button-small" aria-disabled={!action.enabled || undefined}
          {...(action.enabled || action.disabledReason === undefined ? {} : { "data-tooltip": action.disabledReason, "data-tooltip-side": "bottom" })}
          onClick={() => { if (action.enabled) action.run(); }}
        >
          {action.icon !== undefined && <Icon name={action.icon} />}{action.label.replace(/…$/, "")}
        </button>
      )}
    </div>
  );
}

export function BookmarksPanel({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  return <PlannedPanel icon="bookmark" text="Named places in this world: bases, farms, entrances." action={commandById(commands, "world.bookmark")} />;
}

export function StatisticsPanel({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  return <PlannedPanel icon="stats" text="Blocks, walls, objects and entities counted for the world or the selection." action={commandById(commands, "world.statistics")} />;
}

export function ObjectsPanel({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  return <PlannedPanel icon="object" text="Furniture, doors, plants and decorations with their styles, to place on the map." action={commandById(commands, "tool.object")} />;
}

export function SchematicsPanel({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  return <PlannedPanel icon="schematic" text="Saved builds to place again. Select an area and save it as a schematic." action={commandById(commands, "file.exportSchematic")} />;
}

export function HistoryPanel(): React.JSX.Element {
  return <PlannedPanel icon="history" text="Every edit appears here with what it changed; click one to go back to it." />;
}
