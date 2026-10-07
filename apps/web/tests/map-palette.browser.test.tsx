import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";
import { App } from "../src/App.js";
import { getDefaultMapPaletteImporter, MAP_PALETTE_STORAGE_KEY } from "../src/world/map-palette-importer.js";

const palette = {
  schemaVersion: 1, gameVersion: "1.4.5.8",
  tiles: [[[118, 88, 62]], [[108, 112, 120]]], walls: [[], [[82, 86, 92]]],
  liquids: [[32, 104, 210], [228, 68, 24], [222, 164, 36], [152, 84, 216]],
};

function choosePalette(json: string): void {
  const input = document.querySelector<HTMLInputElement>('input[aria-label="Map palette JSON"]');
  if (input === null) throw new Error("Missing palette file input");
  const transfer = new DataTransfer();
  transfer.items.add(new File([json], "CopperVale.terraria-map-palette.json", { type: "application/json" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

afterEach(() => { getDefaultMapPaletteImporter().clear(); });

test("imports the local palette, keeps invalid replacements out, and can return to placeholders", async () => {
  await render(<App />);
  choosePalette(JSON.stringify(palette));
  const region = page.getByRole("region", { name: "Local map palette (POC)" });
  await expect.element(region).toMatchTextContent("Terraria 1.4.5.8");
  expect(JSON.parse(localStorage.getItem(MAP_PALETTE_STORAGE_KEY) ?? "null")).toEqual(palette);
  choosePalette('{"schemaVersion":2}');
  await expect.element(region).toMatchTextContent("Could not import map palette");
  expect(getDefaultMapPaletteImporter().load()?.tiles[1]?.[0]).toEqual([108, 112, 120]);
  await page.getByRole("button", { name: "Use placeholder colours" }).click();
  await vi.waitFor(() => { expect(localStorage.getItem(MAP_PALETTE_STORAGE_KEY)).toBeNull(); });
  await expect.element(region).toMatchTextContent("Placeholder colours");
});
