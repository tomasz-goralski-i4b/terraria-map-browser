import { expect, test } from "vitest";
import { matchesShortcut } from "../src/shell/commands.js";

/** The fields of a keydown that shortcut matching reads. */
function key(init: Partial<Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">>): KeyboardEvent {
  return { key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init } as KeyboardEvent;
}

test.each([
  ["Alt+1 on a US layout", key({ key: "1", code: "Digit1", altKey: true }), "Alt+1", true],
  ["Option+1 on macOS (the key is ¡)", key({ key: "¡", code: "Digit1", altKey: true }), "Alt+1", true],
  ["Alt+1 on a French layout (the key is &)", key({ key: "&", code: "Digit1", altKey: true }), "Alt+1", true],
  ["a bare 1 is not Alt+1", key({ key: "1", code: "Digit1" }), "Alt+1", false],
  ["Alt+2 is not Alt+1", key({ key: "2", code: "Digit2", altKey: true }), "Alt+1", false],
  ["1 for Actual size", key({ key: "1", code: "Digit1" }), "1", true],
  ["a bare digit", key({ key: "4", code: "Digit4" }), "4", true],
  ["? with Shift", key({ key: "?", code: "Slash", shiftKey: true }), "Shift+?", true],
  ["Ctrl+K", key({ key: "k", code: "KeyK", ctrlKey: true }), "Control+K", true],
  ["⌘K on macOS", key({ key: "k", code: "KeyK", metaKey: true }), "Control+K", true],
  ["a bare K is not Ctrl+K", key({ key: "k", code: "KeyK" }), "Control+K", false],
  ["Shift+H is not H", key({ key: "H", code: "KeyH", shiftKey: true }), "H", false],
  ["H", key({ key: "h", code: "KeyH" }), "H", true],
  ["Escape", key({ key: "Escape", code: "Escape" }), "Escape", true],
  ["Alt+Escape is not Escape", key({ key: "Escape", code: "Escape", altKey: true }), "Escape", false],
] as const)("%s", (_name, event, shortcut, expected) => {
  expect(matchesShortcut(event, shortcut)).toBe(expected);
});
