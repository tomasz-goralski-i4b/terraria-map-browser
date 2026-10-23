import { afterEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { StartScreen } from "../src/components/StartScreen.js";
import type { Command } from "../src/shell/commands.js";
import { useWorldLibrary } from "../src/world/world-library.js";
import "../src/styles.css";

const worldNames = [
  "Builder's Haven", "Crystal Caverns", "Moonlit Coast", "Jungle Observatory",
  "Skybridge Workshop", "Sunken Archives", "Granite Highlands", "Amber Valley",
];

const openCommands: readonly Command[] = [
  { id: "file.open", group: "File", label: "Open World…", shortcut: "Control+O", enabled: true, run: () => undefined },
  { id: "file.openFolder", group: "File", label: "Open Worlds Folder…", enabled: true, run: () => undefined },
  { id: "file.assets", group: "Assets", label: "Connect Terraria assets…", enabled: true, run: () => undefined },
];

afterEach(() => {
  useWorldLibrary.setState({ folder: { kind: "none" }, recent: [] });
  delete document.documentElement.dataset["theme"];
});

test.each(["dark", "light"])("a populated world chooser fits beside its art in the %s desktop theme", async (theme) => {
  await page.viewport(1280, 720);
  document.documentElement.dataset["theme"] = theme;
  const openedAt = Date.now() - 86_400_000;
  useWorldLibrary.setState({
    folder: {
      kind: "ready", name: "Worlds",
      worlds: worldNames.map((name, index) => ({ fileName: `${name}.wld`, size: 2_830_000 + index * 4096, modified: openedAt })),
    },
    recent: worldNames.map((worldName) => ({ worldName, fileName: `${worldName}.wld`, openedAt })),
  });
  await render(
    <div className="app">
      <div className="workbench"><main className="map-view" aria-label="Map"><StartScreen commands={openCommands} /></main></div>
    </div>,
  );
  const start = document.querySelector<HTMLElement>(".start");
  const art = document.querySelector<HTMLImageElement>(".start-art");
  const rightArt = document.querySelector<HTMLImageElement>(".start-art-right");
  const folder = page.getByRole("list", { name: "Worlds in Worlds" }).element();
  const recent = page.getByRole("list", { name: "Recent worlds" }).element();
  if (start === null || art === null || rightArt === null) throw new Error("World chooser and both illustrations did not mount");
  await art.decode();
  await rightArt.decode();
  const artBounds = art.getBoundingClientRect();
  const folderBounds = folder.getBoundingClientRect();
  const recentBounds = recent.getBoundingClientRect();
  const content = start.querySelector<HTMLElement>(".start-content");
  const map = start.parentElement;
  if (content === null || map === null) throw new Error("World chooser has no layout container");
  const contentBounds = content.getBoundingClientRect();
  const mapBounds = map.getBoundingClientRect();
  expect(Math.abs(contentBounds.left + contentBounds.width / 2 - mapBounds.left - mapBounds.width / 2)).toBeLessThan(2);
  expect(artBounds.right).toBeLessThanOrEqual(folderBounds.left);
  expect(rightArt.getBoundingClientRect().left).toBeGreaterThanOrEqual(contentBounds.right);
  expect(rightArt.naturalHeight).toBeGreaterThan(rightArt.naturalWidth);
  expect(artBounds.height).toBeGreaterThan(artBounds.width);
  expect(recentBounds.left).toBeGreaterThanOrEqual(folderBounds.right);
  expect(Math.abs(folderBounds.top - recentBounds.top)).toBeLessThan(2);
  expect(start.scrollHeight).toBeLessThanOrEqual(start.clientHeight + 1);
  expect(start.scrollWidth).toBeLessThanOrEqual(start.clientWidth + 1);
  for (const list of [folder, recent]) {
    expect(list.querySelectorAll("button")).toHaveLength(8);
    const last = list.lastElementChild?.getBoundingClientRect();
    expect(last?.bottom).toBeLessThanOrEqual(start.getBoundingClientRect().bottom);
  }
});
