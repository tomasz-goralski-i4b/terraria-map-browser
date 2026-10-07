import { useEffect } from "react";
import { RENDERER_PACKAGE } from "@studio/renderer";
import { Header } from "./components/Header.js";
import { MapView } from "./components/MapView.js";
import { Toolbar } from "./components/Toolbar.js";
import { resetDefaultWorldSession } from "./world/world-session.js";

export function App(): React.JSX.Element {
  // A freshly mounted app starts with no world: the session and store are module-level singletons.
  useEffect(() => {
    resetDefaultWorldSession();
  }, []);
  return (
    <div className="app">
      <Header />
      <Toolbar />
      <MapView renderer={RENDERER_PACKAGE} />
    </div>
  );
}
