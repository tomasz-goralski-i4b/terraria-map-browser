import { useId, useRef } from "react";
import { ContentPanel } from "../panels/ContentPanel.js";
import { EntitiesPanel } from "../panels/placeholders.js";
import { InspectorPanel } from "../panels/InspectorPanel.js";
import { LayersPanel } from "../panels/LayersPanel.js";
import { SwatchesPanel } from "../panels/SwatchesPanel.js";
import type { Command } from "./commands.js";
import { WorldPanel, WorldPanelActions } from "../panels/WorldPanel.js";
import { Section } from "../ui/Section.js";
import { Splitter } from "../ui/Splitter.js";
import { DEFAULT_LAYOUT, DOCK_TABS, SECTION_IDS, SECTION_TAB, useLayoutStore, type DockTab, type SectionId } from "./layout-store.js";

interface SectionDefinition {
  readonly title: string;
  readonly body: (commands: readonly Command[]) => React.JSX.Element;
  /** Header controls, shown while the section is open. */
  readonly actions?: (commands: readonly Command[]) => React.JSX.Element;
}

const SECTIONS: Readonly<Record<SectionId, SectionDefinition>> = {
  world: { title: "World", body: () => <WorldPanel />, actions: (commands) => <WorldPanelActions commands={commands} /> },
  layers: { title: "Layers", body: (commands) => <LayersPanel commands={commands} /> },
  inspector: { title: "Inspector", body: () => <InspectorPanel /> },
  content: { title: "Content", body: () => <ContentPanel /> },
  entities: { title: "Entities", body: () => <EntitiesPanel /> },
  swatches: { title: "Swatches", body: () => <SwatchesPanel /> },
};

const TAB_LABELS: Readonly<Record<DockTab, string>> = { world: "World", view: "View", swatches: "Swatches" };

export const DOCK_ID = "dock";

function DockSection({ id, commands }: { readonly id: SectionId; readonly commands: readonly Command[] }): React.JSX.Element {
  const open = useLayoutStore((state) => state.sections[id]);
  const setSectionOpen = useLayoutStore((state) => state.setSectionOpen);
  const definition = SECTIONS[id];
  return (
    <Section
      title={definition.title}
      {...(open && definition.actions !== undefined ? { actions: definition.actions(commands) } : {})}
      open={open}
      onOpenChange={(next) => {
        setSectionOpen(id, next);
      }}
    >
      {definition.body(commands)}
    </Section>
  );
}

/**
 * The right dock (as in image editors): World (what the world is: properties, content, entities), View (what is
 * drawn: layers) and Swatches (what the brush paints with) as tabs, and the Inspector under them, visible with any.
 * Resizable; hidden entirely with `P`.
 */
export function Dock({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element | null {
  const id = useId();
  const hidden = useLayoutStore((state) => state.dockHidden);
  const width = useLayoutStore((state) => state.dockWidth);
  const setWidth = useLayoutStore((state) => state.setDockWidth);
  const tab = useLayoutStore((state) => state.dockTab);
  const setTab = useLayoutStore((state) => state.setDockTab);
  const inspectorOpen = useLayoutStore((state) => state.sections.inspector);
  const tabs = useRef(new Map<DockTab, HTMLButtonElement>());
  if (hidden) return null;
  const select = (next: DockTab): void => {
    setTab(next);
    tabs.current.get(next)?.focus();
  };
  return (
    <aside id={DOCK_ID} className="dock" aria-label="Panels">
      <Splitter
        label="Resize panels"
        value={width}
        min={DEFAULT_LAYOUT.minDockWidth}
        max={DEFAULT_LAYOUT.maxDockWidth}
        grows="left"
        controls={DOCK_ID}
        onChange={setWidth}
      />
      <div role="tablist" aria-label="Panel groups" className="dock-tabs">
        {DOCK_TABS.map((candidate, index) => (
          <button
            key={candidate}
            ref={(element) => {
              if (element === null) tabs.current.delete(candidate);
              else tabs.current.set(candidate, element);
            }}
            type="button"
            role="tab"
            id={`${id}-${candidate}`}
            className="dock-tab"
            aria-selected={tab === candidate}
            aria-controls={`${id}-panel`}
            tabIndex={tab === candidate ? 0 : -1}
            onClick={() => {
              setTab(candidate);
            }}
            onKeyDown={(event) => {
              let next: DockTab | undefined;
              if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                const step = event.key === "ArrowRight" ? 1 : -1;
                next = DOCK_TABS[(index + step + DOCK_TABS.length) % DOCK_TABS.length];
              } else if (event.key === "Home") next = DOCK_TABS[0];
              else if (event.key === "End") next = DOCK_TABS.at(-1);
              if (next !== undefined) {
                event.preventDefault();
                select(next);
              }
            }}
          >
            {TAB_LABELS[candidate]}
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="dock-scroll">
        {SECTION_IDS.filter((section) => section !== "inspector" && SECTION_TAB[section] === tab).map((section) => (
          <DockSection key={section} id={section} commands={commands} />
        ))}
      </div>
      <div className="dock-inspector" data-open={inspectorOpen}>
        <DockSection id="inspector" commands={commands} />
      </div>
    </aside>
  );
}
