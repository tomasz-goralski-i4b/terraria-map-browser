import { useMemo } from "react";
import { useLayoutStore } from "../shell/layout-store.js";
import { getMapController } from "../shell/view-store.js";
import { useAppStore } from "../store.js";
import { IconButton } from "../ui/IconButton.js";
import { PropertyGrid, type Property } from "../ui/PropertyGrid.js";
import { Section } from "../ui/Section.js";
import { getDefaultWorldSession } from "../world/world-session.js";
import { WORLD_GROUP_IDS, worldFieldGroups, type WorldField, type WorldFieldGroup, type WorldFieldsInput } from "./world-fields.js";

function property(field: WorldField): Property {
  if (field.kind !== "point") return field;
  const { x, y } = field.point;
  return {
    kind: "custom",
    label: field.label,
    value: (
      <span className="property-point">
        <span className="numeric">{x}, {y}</span>
        <IconButton icon="target" label={`Go to ${field.label} on the map`} tooltipSide="left" onClick={() => {
          getMapController()?.centerOn(x, y);
        }} />
      </span>
    ),
  };
}

/** "7/22" for groups that are checklists, so progress reads without opening them. */
function badge(group: WorldFieldGroup): string | undefined {
  const flags = group.fields.filter((field) => field.kind === "flag");
  if (flags.length !== group.fields.length || flags.length === 0) return undefined;
  return `${String(flags.filter((field) => field.value).length)}/${String(flags.length)}`;
}

function loadedFields(fileSize: number): WorldFieldsInput | null {
  const loaded = getDefaultWorldSession().getLoadedWorld();
  return loaded === null ? null : { ...loaded, fileSize };
}

const WORLD_GROUP_KEYS = WORLD_GROUP_IDS.map((id) => `world/${id}`);

/** Expand all / Collapse all, for the World section's header. */
export function WorldPanelActions(): React.JSX.Element {
  const setGroupsOpen = useLayoutStore((state) => state.setGroupsOpen);
  return (
    <>
      <IconButton icon="expandAll" label="Expand all groups" tooltipSide="left" onClick={() => {
        setGroupsOpen(WORLD_GROUP_KEYS, true);
      }} />
      <IconButton icon="collapseAll" label="Collapse all groups" tooltipSide="left" onClick={() => {
        setGroupsOpen(WORLD_GROUP_KEYS, false);
      }} />
    </>
  );
}

/** Everything decoded from the save's header and metadata, in collapsible groups. */
export function WorldPanel({ world }: { readonly world?: WorldFieldsInput | null }): React.JSX.Element {
  const summary = useAppStore((state) => state.summary);
  const groupsOpen = useLayoutStore((state) => state.groups);
  const setGroupOpen = useLayoutStore((state) => state.setGroupOpen);
  // A new summary means a newly loaded world; the session is not reactive, the store is.
  const sessionWorld = useMemo(() => (summary === null ? null : loadedFields(summary.fileSize)), [summary]);
  const shown = world === undefined ? sessionWorld : world;
  const groups = useMemo(() => (shown === null ? [] : worldFieldGroups(shown)), [shown]);

  if (shown === null) return <p className="panel-empty">Open a world to see its properties.</p>;
  return (
    <div className="world-panel">
      {groups.map((group) => {
        const key = `world/${group.id}`;
        const groupBadge = badge(group);
        return (
          <Section
            key={group.id}
            level={3}
            title={group.title}
            {...(groupBadge === undefined ? {} : { badge: groupBadge })}
            open={groupsOpen[key] ?? true}
            onOpenChange={(open) => {
              setGroupOpen(key, open);
            }}
          >
            <PropertyGrid label={group.title} properties={group.fields.map(property)} />
          </Section>
        );
      })}
    </div>
  );
}
