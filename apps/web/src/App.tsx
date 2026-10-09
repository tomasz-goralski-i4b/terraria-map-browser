import { useEffect, useState } from "react";
import { RENDERER_PACKAGE } from "@studio/renderer";
import { getDefaultAssetSession, useAssetStore } from "./assets/asset-session.js";
import { SpritePreviewDialog } from "./panels/SpritePreviewDialog.js";
import { MapView } from "./components/MapView.js";
import { SaveAsDialog } from "./components/SaveAsDialog.js";
import { useCommands, useGlobalShortcuts } from "./shell/commands.js";
import { CommandPalette, HelpOverlay } from "./shell/dialogs.js";
import { Dock } from "./shell/Dock.js";
import { hydrateLayout, useLayoutStore, type LayoutStorage } from "./shell/layout-store.js";
import { clearNotifications } from "./shell/notification-store.js";
import { Notifications } from "./shell/Notifications.js";
import { StatusBar } from "./shell/StatusBar.js";
import { ToolOptions } from "./shell/ToolOptions.js";
import { ToolRail } from "./shell/ToolRail.js";
import { TopBar } from "./shell/TopBar.js";
import { useViewStore } from "./shell/view-store.js";
import { useAppStore } from "./store.js";
import { resetWorldLibrary, startWorldLibrary } from "./world/world-library.js";
import { resetDefaultWorldSession } from "./world/world-session.js";

/** The sprite-sheet preview, while it is open and an atlas is loaded. */
function SpritePreview(): React.JSX.Element | null {
  const open = useViewStore((state) => state.spritePreviewOpen);
  const setOpen = useViewStore((state) => state.setSpritePreviewOpen);
  const ready = useAssetStore((state) => state.status.kind === "ready");
  const atlas = ready ? getDefaultAssetSession().getAtlas() : null;
  if (!open || atlas === null) return null;
  return <SpritePreviewDialog atlas={atlas} onClose={() => { setOpen(false); }} />;
}

/**
 * With unsaved changes, reloading or closing the tab asks first. Browsers show their own confirmation ("Leave site?
 * Changes you made may not be saved"); a page cannot word it.
 */
function useUnsavedChangesGuard(): void {
  const unsaved = useAppStore((state) => state.unsavedChanges);
  useEffect(() => {
    if (!unsaved) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [unsaved]);
}

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
    clearNotifications();
  }, []);
  // The worlds folder and recent worlds of earlier visits; opened worlds are added to Open Recent.
  useEffect(() => {
    resetWorldLibrary();
    return startWorldLibrary();
  }, []);
  // The Content folder of an earlier visit is reconnected without a prompt where the browser still allows it.
  useEffect(() => {
    void getDefaultAssetSession().restore();
  }, []);
  useTheme();
  useUnsavedChangesGuard();
  const commands = useCommands();
  useGlobalShortcuts(commands);
  const dockHidden = useLayoutStore((state) => state.dockHidden);
  const dockWidth = useLayoutStore((state) => state.dockWidth);

  return (
    <div className="app" data-dock={dockHidden ? "hidden" : "shown"} style={{ "--dock-width": `${String(dockWidth)}px` } as React.CSSProperties}>
      <TopBar commands={commands} />
      <ToolRail commands={commands} />
      <ToolOptions commands={commands} />
      <MapView renderer={RENDERER_PACKAGE} commands={commands} />
      <Dock commands={commands} />
      <StatusBar />
      <HelpOverlay commands={commands} />
      <CommandPalette commands={commands} />
      <SpritePreview />
      <Notifications />
      <SaveAsDialog />
    </div>
  );
}
