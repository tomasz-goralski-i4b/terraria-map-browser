import { expect, test } from "vitest";
import { chestAnnotations, useChestNavigation } from "../src/world/chest-navigation.js";
import { matchesShortcut } from "../src/shell/commands.js";

test("each match has all four footprint edges and an overview marker", () => {
  const data = chestAnnotations([{ x: 12, y: 18, width: 2, height: 2 }, { x: 32, y: 18, width: 3, height: 2 }], null);
  expect(data.length).toBe(2 * 5 * 9);
  expect([...data.slice(0, 4)]).toEqual([12, 18, 14, 18]);
  expect([...data.slice(36, 45)]).toEqual([13, 19, 13, 19, 1, expect.any(Number), expect.any(Number), 6, 1]);
  expect([...data.slice(45, 49)]).toEqual([32, 18, 35, 18]);
  useChestNavigation.setState({ areas: [] });
});

test("F3 distinguishes forward from Shift+F3 backward", () => {
  const event = { key: "F3", ctrlKey: false, metaKey: false, altKey: false, shiftKey: true } as KeyboardEvent;
  expect(matchesShortcut(event, "F3")).toBe(false);
  expect(matchesShortcut(event, "Shift+F3")).toBe(true);
});
