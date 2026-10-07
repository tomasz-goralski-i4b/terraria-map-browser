import { RENDERER_PACKAGE } from "@studio/renderer";
import { Header } from "./components/Header.js";
import { MapView } from "./components/MapView.js";
import { Toolbar } from "./components/Toolbar.js";

export function App(): React.JSX.Element {
  return (
    <div className="app">
      <Header />
      <Toolbar />
      <MapView renderer={RENDERER_PACKAGE} />
    </div>
  );
}
