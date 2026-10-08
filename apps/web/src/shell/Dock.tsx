import { ContentPanel } from "../panels/ContentPanel.js";
import { EntitiesPanel, InspectorPanel, LayersPanel } from "../panels/placeholders.js";
import { WorldPanel, WorldPanelActions } from "../panels/WorldPanel.js";
import { Section } from "../ui/Section.js";
import { Splitter } from "../ui/Splitter.js";
import { DEFAULT_LAYOUT, SECTION_IDS, useLayoutStore, type SectionId } from "./layout-store.js";

interface SectionDefinition {
  readonly title: string;
  readonly body: () => React.JSX.Element;
  /** Header controls, shown while the section is open. */
  readonly actions?: () => React.JSX.Element;
}

const SECTIONS: Readonly<Record<SectionId, SectionDefinition>> = {
  world: { title: "World", body: () => <WorldPanel />, actions: () => <WorldPanelActions /> },
  layers: { title: "Layers", body: () => <LayersPanel /> },
  inspector: { title: "Inspector", body: () => <InspectorPanel /> },
  content: { title: "Content", body: () => <ContentPanel /> },
  entities: { title: "Entities", body: () => <EntitiesPanel /> },
};

export const DOCK_ID = "dock";

/** The right dock: a resizable column of collapsible sections. Hidden entirely with `P`. */
export function Dock(): React.JSX.Element | null {
  const hidden = useLayoutStore((state) => state.dockHidden);
  const width = useLayoutStore((state) => state.dockWidth);
  const setWidth = useLayoutStore((state) => state.setDockWidth);
  const sections = useLayoutStore((state) => state.sections);
  const setSectionOpen = useLayoutStore((state) => state.setSectionOpen);
  if (hidden) return null;
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
      <div className="dock-scroll">
        {SECTION_IDS.map((id) => (
          <Section
            key={id}
            title={SECTIONS[id].title}
            {...(sections[id] && SECTIONS[id].actions !== undefined ? { actions: SECTIONS[id].actions() } : {})}
            open={sections[id]}
            onOpenChange={(open) => {
              setSectionOpen(id, open);
            }}
          >
            {SECTIONS[id].body()}
          </Section>
        ))}
      </div>
    </aside>
  );
}
