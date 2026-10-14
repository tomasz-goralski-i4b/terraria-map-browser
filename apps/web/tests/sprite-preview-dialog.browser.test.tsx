// The sprite sheet dialog lists every drawn family of the local atlas: blocks, walls, items and liquids.
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import type { AtlasEntry, SpriteAtlas } from "@studio/assets";
import { SpritePreviewDialog } from "../src/panels/SpritePreviewDialog.js";
import { itemLabel } from "../src/world/items.js";
import "../src/styles.css";

const PAGE = 128;

function entry(kind: AtlasEntry["kind"], id: number, x: number, width: number, height: number, frame = 0): AtlasEntry {
  return { kind, id, page: 0, x, y: 2, width, height, frameWidth: frame, frameHeight: frame, gapX: frame === 0 ? 0 : 2, gapY: frame === 0 ? 0 : 2 };
}

/** Synthetic sheets: Tiles_0, Item_1 (Iron Pickaxe, 32 × 32), Item_4 and Liquid_0 (two 16 × 16 frames). */
function syntheticAtlas(): SpriteAtlas {
  const page = new Uint8Array(PAGE * PAGE * 4).fill(200);
  const entries = [entry("tile", 0, 2, 16, 16, 16), entry("item", 1, 20, 32, 32), entry("item", 4, 54, 20, 20), entry("liquid", 0, 76, 34, 16, 16)];
  return { pages: [page], index: { formatVersion: 7, pageSize: PAGE, padding: 2, pageCount: 1, metrics: {} as SpriteAtlas["index"]["metrics"], entries } };
}

function sheetNames(): string[] {
  return [...document.querySelectorAll(".sprite-list [role=option] .sprite-name")].map((element) => element.textContent);
}

test("the Items tab lists the item sheets by item name and shows the selected one", async () => {
  await render(<SpritePreviewDialog atlas={syntheticAtlas()} onClose={() => undefined} />);
  await page.getByRole("button", { name: "Items" }).click();
  await expect.poll(sheetNames).toEqual(["Iron Pickaxe", itemLabel(4)]);
  await expect.element(page.getByLabelText("Item_1 sprite sheet")).toBeVisible();
  await page.getByRole("searchbox", { name: "Filter sheets" }).fill("pickaxe");
  await expect.poll(sheetNames).toEqual(["Iron Pickaxe"]);
});

test("the Liquids tab names the liquid sheets and draws their frames", async () => {
  await render(<SpritePreviewDialog atlas={syntheticAtlas()} onClose={() => undefined} />);
  await page.getByRole("button", { name: "Liquids" }).click();
  await expect.poll(sheetNames).toEqual(["Water"]);
  await expect.element(page.getByLabelText("Liquid_0 sprite sheet")).toBeVisible();
});
