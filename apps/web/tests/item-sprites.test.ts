import { expect, test } from "vitest";
import { packSheets, terrariaItems } from "@studio/assets";
import { itemThumbnail } from "../src/world/items.js";

test("inventory crops use observed frame sizes and texture aliases, never the whole animated sheet", () => {
  const item = terrariaItems.items.find((entry) => entry.textureId !== null && entry.textureId !== entry.id && entry.frame !== null);
  if (item?.textureId === null || item?.textureId === undefined || item.frame === null) throw new Error("The catalog needs an aliased inventory frame");
  const frame = item.frame;
  const width = frame.x + frame.width;
  const height = frame.y + frame.height * 2;
  const rgba = new Uint8Array(width * height * 4);
  for (let y = frame.y; y < frame.y + frame.height; y++) for (let x = frame.x; x < frame.x + frame.width; x++) rgba.set([212, 165, 53, 255], (y * width + x) * 4);
  const atlas = packSheets([{ kind: "item", id: item.textureId, width, height, rgba }], { pageSize: 256 });
  const crop = itemThumbnail(atlas, item.id);
  expect(crop?.width).toBe(frame.width);
  expect(crop?.height).toBe(frame.height);
  expect([...crop?.pixels.slice(0, 4) ?? []]).toEqual([212, 165, 53, 255]);
  expect([...crop?.pixels.slice(-4) ?? []]).toEqual([212, 165, 53, 255]);
  expect(itemThumbnail(atlas, 9001)).toBeNull();
  expect(itemThumbnail(packSheets([], { pageSize: 256 }), item.id)).toBeNull();
});
