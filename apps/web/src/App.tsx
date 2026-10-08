import { useEffect, useState } from "react";
import { RENDERER_PACKAGE } from "@studio/renderer";
import { MapView } from "./components/MapView.js";
import { useCommands, useGlobalShortcuts } from "./shell/commands.js";
import { CommandPalette, HelpOverlay } from "./shell/dialogs.js";
import { Dock } from "./shell/Dock.js";
import { hydrateLayout, useLayoutStore, type LayoutStorage } from "./shell/layout-store.js";
import { StatusBar } from "./shell/StatusBar.js";
import { ToolOptions } from "./shell/ToolOptions.js";
import { ToolRail } from "./shell/ToolRail.js";
import { TopBar } from "./shell/TopBar.js";
import { resetDefaultWorldSession } from "./world/world-session.js";

/** The theme choice applies to the document root, so tokens resolve the same in dialogs and the page. */
function useTheme(): void {
  const theme = useLayoutStore((state) => state.theme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === "system") delete root.dataset["theme"];
    else root.dataset["theme"] = theme;
  }, [theme]);
}

export interface AppProps {
  /** Where the layout is kept; the browser's `localStorage` by default (tests pass their own). */
  readonly layoutStorage?: LayoutStorage | null;
}

export function App({ layoutStorage }: AppProps = {}): React.JSX.Element {
  // The stored layout is read before the first render, so panels never jump from defaults to the stored layout.
  useState(() => {
    if (layoutStorage === undefined) hydrateLayout();
    else hydrateLayout(layoutStorage);
    return null;
  });
  // A freshly mounted app starts with no world: the session and store are module-level singletons.
  useEffect(() => {
    resetDefaultWorldSession();
  }, []);
  useTheme();
  const commands = useCommands();
  useGlobalShortcuts(commands);
  const dockHidden = useLayoutStore((state) => state.dockHidden);
  const dockWidth = useLayoutStore((state) => state.dockWidth);

  return (
    <div className="app" data-dock={dockHidden ? "hidden" : "shown"} style={{ "--dock-width": `${String(dockWidth)}px` } as React.CSSProperties}>
      <TopBar commands={commands} />
      <ToolRail commands={commands} />
      <ToolOptions />
      <MapView renderer={RENDERER_PACKAGE} />
      <Dock commands={commands} />
      <StatusBar />
      <HelpOverlay commands={commands} />
      <CommandPalette commands={commands} />
    </div>
  );
}
