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

test("the status bar names the chest under the pointer and how many slots it fills", async () => {
  const chest = { x: 10, y: 20, name: "Ores", slotCount: 40, items: [{ slot: 0, itemId: 12, stack: 30, prefix: 0 }, { slot: 5, itemId: 13, stack: 2, prefix: 0 }] };
  await render(<StatusBar world={{
    height: 1200, surfaceLevel: 300, rockLevel: 600,
    tileAt: () => ({ block: { kind: "vanilla", id: 21 }, frameX: 0, frameY: 0, wires: 0, actuator: false }),
    chestAt: (x, y) => (x === 11 && y === 21 ? chest : x === 30 ? { ...chest, name: "", items: [] } : null),
  }} />);
  useViewStore.getState().setHoverTile({ x: 11, y: 21 });
  await expect.element(page.getByTestId("chest-under-cursor")).toHaveTextContent("Chest: Ores · 2 of 40 slots");
  useViewStore.getState().setHoverTile({ x: 30, y: 21 });
  await expect.element(page.getByTestId("chest-under-cursor")).toHaveTextContent("Chest · 0 of 40 slots");
  useViewStore.getState().setHoverTile({ x: 12, y: 21 });
  await expect.element(page.getByTestId("chest-under-cursor")).toHaveTextContent("");
});
