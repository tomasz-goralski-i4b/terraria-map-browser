import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { StatusBar } from "../src/shell/StatusBar.js";
import { useViewStore } from "../src/shell/view-store.js";

afterEach(() => { useViewStore.setState({ hoverTile: null }); });

test("the status bar uses generated names for the hovered frame, wall and liquid", async () => {
  await render(<StatusBar world={{
    height: 1200, surfaceLevel: 300, rockLevel: 600,
    tileAt: () => ({
      block: { kind: "vanilla", id: 26 }, frameX: 54, frameY: 0, paint: 19,
      wall: { kind: "vanilla", id: 1 }, wallPaint: 7, liquid: { kind: "shimmer", amount: 128 },
      wires: 0, actuator: false,
    }),
  }} />);
  useViewStore.getState().setHoverTile({ x: 120, y: 400 });
  await expect.element(page.getByTestId("tile-under-cursor")).toHaveTextContent("Crimson Altar (Deep Cyan Paint) · Stone Wall (Cyan Paint) · Shimmer 128");
});
