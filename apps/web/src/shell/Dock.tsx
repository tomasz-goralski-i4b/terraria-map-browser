import { useId, useLayoutEffect, useRef, useState } from "react";
import { ContentPanel } from "../panels/ContentPanel.js";
import { EntitiesPanel } from "../panels/EntitiesPanel.js";
import { SearchPanel } from "../panels/search/SearchPanel.js";
import { InspectorPanel } from "../panels/InspectorPanel.js";
import { LayersPanel } from "../panels/LayersPanel.js";
import { GridPanel } from "../panels/GridPanel.js";
import { MeasurementsPanel } from "../panels/MeasurementsPanel.js";
import { SwatchesPanel } from "../panels/SwatchesPanel.js";
import { BookmarksPanel, HistoryPanel, ObjectsPanel, SchematicsPanel, StatisticsPanel } from "../panels/planned.js";
import { Icon, type IconName } from "../ui/Icon.js";
import type { Command } from "./commands.js";
import { WorldPanel, WorldPanelActions } from "../panels/WorldPanel.js";
import { Section } from "../ui/Section.js";
import { Splitter } from "../ui/Splitter.js";
import {
  BOTTOM_TABS, DEFAULT_LAYOUT, DOCK_TABS, SECTION_IDS, SECTION_TAB, SECTION_TITLES, useLayoutStore, type BottomTab, type DockTab, type SectionId,
} from "./layout-store.js";

interface SectionDefinition {
  readonly body: (commands: readonly Command[]) => React.JSX.Element;
  /** Header controls, shown while the section is open. */
  readonly actions?: (commands: readonly Command[]) => React.JSX.Element;
}

const SECTIONS: Readonly<Record<SectionId, SectionDefinition>> = {
  world: { body: () => <WorldPanel />, actions: (commands) => <WorldPanelActions commands={commands} /> },
  layers: { body: (commands) => <LayersPanel commands={commands} /> },
  grid: { body: () => <GridPanel /> },
  measurements: { body: () => <MeasurementsPanel /> },
  inspector: { body: () => <InspectorPanel /> },
  history: { body: () => <HistoryPanel /> },
  content: { body: () => <ContentPanel /> },
  entities: { body: () => <EntitiesPanel /> },
  search: { body: () => <SearchPanel /> },
  bookmarks: { body: (commands) => <BookmarksPanel commands={commands} /> },
  statistics: { body: (commands) => <StatisticsPanel commands={commands} /> },
  swatches: { body: () => <SwatchesPanel /> },
  objects: { body: (commands) => <ObjectsPanel commands={commands} /> },
  schematics: { body: (commands) => <SchematicsPanel commands={commands} /> },
};

const TABS: Readonly<Record<DockTab, { readonly label: string; readonly icon: IconName }>> = {
  world: { label: "World", icon: "world" },
  view: { label: "View", icon: "eye" },
  paint: { label: "Paint", icon: "palette" },
  library: { label: "Library", icon: "library" },
};
/** Below this dock width (the default) the tabs show their icons only (their names stay as accessible names and tooltips). */
const TAB_TEXT_MIN_WIDTH = 320;

export const DOCK_ID = "dock";
/** The smallest Inspector and the room the tabs keep above it when the Inspector is dragged taller. */
const INSPECTOR_MIN_HEIGHT = 96;
const TABS_MIN_HEIGHT = 140;

/** An element's height in CSS pixels, kept current by a ResizeObserver (0 before it is laid out). */
function useHeight(ref: React.RefObject<HTMLElement | null>, hidden: boolean): number {
  const [height, setHeight] = useState(0);
  // Measured before paint, so a drag right after mounting starts from the real height and limit, then kept current.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || hidden) return undefined;
    const measure = (): void => { setHeight(element.getBoundingClientRect().height); };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => { observer.disconnect(); };
  }, [ref, hidden]);
  return height;
}

function DockSection({ id, commands }: { readonly id: SectionId; readonly commands: readonly Command[] }): React.JSX.Element {
  const open = useLayoutStore((state) => state.sections[id]);
  const setSectionOpen = useLayoutStore((state) => state.setSectionOpen);
  const definition = SECTIONS[id];
  return (
    <Section
      title={SECTION_TITLES[id]}
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
  const bottomTab = useLayoutStore((state) => state.bottomTab);
  const setBottomTab = useLayoutStore((state) => state.setBottomTab);
  const setSectionOpen = useLayoutStore((state) => state.setSectionOpen);
  const inspectorOpen = useLayoutStore((state) => state.sections[state.bottomTab]);
  const inspectorHeight = useLayoutStore((state) => state.inspectorHeight);
  const setInspectorHeight = useLayoutStore((state) => state.setInspectorHeight);
  const dock = useRef<HTMLElement>(null);
  const inspector = useRef<HTMLDivElement>(null);
  const dockHeight = useHeight(dock, hidden);
  const fittedHeight = useHeight(inspector, hidden);
  const tabs = useRef(new Map<DockTab, HTMLButtonElement>());
  if (hidden) return null;
  const select = (next: DockTab): void => {
    setTab(next);
    tabs.current.get(next)?.focus();
  };
  return (
    <aside ref={dock} id={DOCK_ID} className="dock" aria-label="Panels">
      <Splitter
        label="Resize panels"
        value={width}
        min={DEFAULT_LAYOUT.minDockWidth}
        max={DEFAULT_LAYOUT.maxDockWidth}
        grows="left"
        controls={DOCK_ID}
        onChange={setWidth}
      />
      <div role="tablist" aria-label="Panel groups" className="dock-tabs" data-compact={width < TAB_TEXT_MIN_WIDTH || undefined}>
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
            aria-label={TABS[candidate].label}
            {...(width < TAB_TEXT_MIN_WIDTH ? { "data-tooltip": TABS[candidate].label, "data-tooltip-side": "bottom" } : {})}
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
            <Icon name={TABS[candidate].icon} />
            <span className="dock-tab-label">{TABS[candidate].label}</span>
          </button>
        ))}
      </div>
      <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} className="dock-scroll">
        {SECTION_IDS.filter((section) => section !== "inspector" && section !== "history" && SECTION_TAB[section] === tab).map((section) => (
          <DockSection key={section} id={section} commands={commands} />
        ))}
      </div>
      {inspectorOpen && (
        // Until it is dragged the Inspector fits its content; the splitter starts from the height it has.
        <Splitter
          label="Resize Inspector"
          value={inspectorHeight ?? (fittedHeight || INSPECTOR_MIN_HEIGHT)}
          min={INSPECTOR_MIN_HEIGHT}
          max={Math.max(INSPECTOR_MIN_HEIGHT, dockHeight - TABS_MIN_HEIGHT)}
          grows="up"
          controls={`${id}-inspector`}
          onChange={setInspectorHeight}
        />
      )}
      <div
        ref={inspector} id={`${id}-inspector`} className="dock-inspector" data-open={inspectorOpen} data-sized={inspectorOpen && inspectorHeight !== null}
        style={inspectorOpen && inspectorHeight !== null ? { height: inspectorHeight } : undefined}
      >
        <div role="tablist" aria-label="Details" className="dock-bottom-tabs">
          {BOTTOM_TABS.map((candidate: BottomTab) => (
            <button
              key={candidate} type="button" role="tab" className="dock-bottom-tab" aria-selected={bottomTab === candidate} tabIndex={bottomTab === candidate ? 0 : -1}
              aria-expanded={bottomTab === candidate ? inspectorOpen : undefined}
              onClick={() => {
                // The strip is the pane's header: the shown tab folds the pane, another one opens it.
                setSectionOpen(candidate, bottomTab === candidate ? !inspectorOpen : true);
                setBottomTab(candidate);
              }}
              onKeyDown={(event) => {
                if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
                event.preventDefault();
                const next = BOTTOM_TABS[(BOTTOM_TABS.indexOf(candidate) + 1) % BOTTOM_TABS.length] ?? candidate;
                setBottomTab(next);
                event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`[data-tab="${next}"]`)?.focus();
              }}
              data-tab={candidate}
            >{SECTION_TITLES[candidate]}</button>
          ))}
          <Icon name="chevron" className="dock-bottom-chevron" />
        </div>
        {inspectorOpen && <div className="dock-bottom-body">{SECTIONS[bottomTab].body(commands)}</div>}
      </div>
    </aside>
  );
}
