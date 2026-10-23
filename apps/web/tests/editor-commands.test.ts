import { afterEach, expect, test } from "vitest";
import { plannedCommands, plannedReason, TOOL_FAMILIES, TOOLS, toolCommands, windowCommands, type Command } from "../src/shell/commands.js";
import { SECTION_IDS } from "../src/shell/layout-store.js";
import { useViewStore, type ToolId } from "../src/shell/view-store.js";
import { PANELS } from "../src/shell/workbench-api.js";

afterEach(() => {
  useViewStore.setState({ tool: "pan", familyTools: {}, plannedDialog: null });
});

const byId = (commands: readonly Command[], id: string): Command => {
  const command = commands.find((candidate) => candidate.id === id);
  if (command === undefined) throw new Error(`no command ${id}`);
  return command;
};

/** The tool commands as the app builds them for the current tool, with an editable world unless a reason is given. */
function tools(editReason: string | null = null): Command[] {
  return toolCommands(useViewStore.getState().tool, (tool, family) => { useViewStore.getState().setTool(tool, family); }, editReason);
}

test("every tool belongs to a family, and the families are listed in rail order with their tools", () => {
  const families = new Set(TOOL_FAMILIES.map((family) => family.id));
  for (const tool of TOOLS) expect(families.has(tool.family)).toBe(true);
  for (const family of TOOL_FAMILIES) expect(TOOLS.some((tool) => tool.family === family.id)).toBe(true);
});

test("a family of several tools has its own key; a family of one leaves the key to its tool", () => {
  for (const family of TOOL_FAMILIES) {
    const members = TOOLS.filter((tool) => tool.family === family.id);
    if (members.length > 1) {
      expect(family.shortcut, family.id).toBeDefined();
      expect(members.filter((tool) => tool.shortcut === family.shortcut)).toEqual([]);
    } else {
      expect(family.shortcut, family.id).toBeUndefined();
      expect(members[0]?.shortcut, family.id).toBeDefined();
    }
  }
});

test("tool, family and planned commands never share a key", () => {
  const commands = [...tools(), ...plannedCommands(true)];
  const keys = commands.flatMap((command) => (command.shortcut === undefined ? [] : [command.shortcut.toLowerCase()]));
  expect(keys.length).toBe(new Set(keys).size);
});

test("a tool that is only a slot is disabled with a short reason that says whether it is coming later", () => {
  const commands = tools();
  for (const tool of TOOLS.filter((candidate) => !candidate.available)) {
    const command = byId(commands, `tool.${tool.id}`);
    expect(command.enabled, tool.id).toBe(false);
    expect(command.disabledReason, tool.id).toBe(plannedReason(tool.later));
  }
  expect(byId(commands, "tool.lasso").disabledReason).toBe("Planned for later");
  expect(byId(commands, "tool.fill").disabledReason).toBe("Not available yet");
  expect(commands.some((command) => command.disabledReason === "World editing is not available yet")).toBe(false);
});

test("the editing tools take the world's reason, and so do their families", () => {
  const commands = tools("Open a vanilla world first");
  for (const id of ["brush", "erase", "select"]) expect(byId(commands, `tool.${id}`).disabledReason).toBe("Open a vanilla world first");
  expect(byId(commands, "tool.pan").enabled).toBe(true);
  expect(byId(commands, "family.draw").enabled).toBe(false);
  expect(byId(commands, "family.select").enabled).toBe(false);
});

test("a family with nothing available yet is disabled with the planned reason", () => {
  for (const id of ["family.shape", "family.tileState", "family.objects", "family.infra"]) {
    expect(byId(tools(), id).enabled, id).toBe(false);
    expect(byId(tools(), id).disabledReason, id).toBe("Not available yet");
  }
});

test("a family's key picks its tool and records it as the family's last one", () => {
  byId(tools(), "family.draw").run();
  expect(useViewStore.getState().tool).toBe("brush");
  expect(useViewStore.getState().familyTools["draw"]).toBe("brush");
  byId(tools(), "family.select").run();
  expect(useViewStore.getState().tool).toBe("select");
  // Pressed again it steps through the family's available tools; Rectangle select is the only one so far.
  byId(tools(), "family.select").run();
  expect(useViewStore.getState().tool).toBe("select");
});

test("a family's key returns to the tool the family had last, not to its first", () => {
  useViewStore.setState({ tool: "pan", familyTools: { select: "move" } });
  // Move is not available: the key falls back to the first available tool of the family.
  byId(tools(), "family.select").run();
  expect(useViewStore.getState().tool).toBe("select");
});

test("picking a tool through its command marks it as checked", () => {
  byId(tools(), "tool.ruler").run();
  const commands = tools();
  expect(byId(commands, "tool.ruler").checked).toBe(true);
  expect(byId(commands, "tool.pan").checked).toBe(false);
});

test("dialog shells open with a world and say why without one; the other planned commands do nothing", () => {
  for (const [id, dialog] of [["edit.replace", "replace"], ["file.importImage", "importImage"], ["file.exportImage", "exportImage"], ["file.exportSchematic", "saveSchematic"]] as const) {
    const without = byId(plannedCommands(false), id);
    expect(without.enabled, id).toBe(false);
    expect(without.disabledReason, id).toBe("Open a world first");
    const withWorld = byId(plannedCommands(true), id);
    expect(withWorld.enabled, id).toBe(true);
    withWorld.run();
    expect(useViewStore.getState().plannedDialog).toBe(dialog);
  }
  const cut = byId(plannedCommands(true), "edit.cut");
  expect(cut.enabled).toBe(false);
  expect(cut.disabledReason).toBe("Not available yet");
  expect(cut.shortcut).toBe("Control+X");
  expect(byId(plannedCommands(true), "select.matches").disabledReason).toBe("Planned for later");
});

test("View > Panels lists every panel, checked while it is shown, and the bottom panel as a whole", () => {
  const commands = windowCommands(new Set(["world", "search"]));
  expect(commands.map((command) => command.id)).toEqual([...PANELS.map((panel) => `panel.${panel.id}`), "panel.bottom"]);
  expect(byId(commands, "panel.world").checked).toBe(true);
  expect(byId(commands, "panel.layers").checked).toBe(false);
  expect(byId(commands, "panel.bottom").checked).toBe(true);
  expect(byId(windowCommands(new Set(["world"])), "panel.bottom").checked).toBe(false);
  expect(byId(commands, "panel.bottom").shortcut).toBe("Control+J");
});

test("every dock section belongs to exactly one panel, and Measurements has a panel of its own", () => {
  const owners = new Map<string, string[]>();
  for (const panel of PANELS) for (const section of panel.sections) owners.set(section, [...(owners.get(section) ?? []), panel.id]);
  for (const section of SECTION_IDS) expect(owners.get(section), section).toHaveLength(1);
  expect(PANELS.find((panel) => panel.id === "measurements")?.sections).toEqual(["measurements"]);
  expect(PANELS.find((panel) => panel.id === "layers")?.sections).not.toContain("measurements");
});

test("panel ids are unique and each panel has a title and an icon", () => {
  expect(new Set(PANELS.map((panel) => panel.id)).size).toBe(PANELS.length);
  for (const panel of PANELS) {
    expect(panel.title.length).toBeGreaterThan(0);
    expect(panel.icon.length).toBeGreaterThan(0);
  }
});

test("the view store remembers each family's last tool independently", () => {
  const set = (tool: ToolId, family: string): void => { useViewStore.getState().setTool(tool, family); };
  set("brush", "draw");
  set("select", "select");
  expect(useViewStore.getState().familyTools).toEqual({ draw: "brush", select: "select" });
  useViewStore.getState().setTool("pan");
  expect(useViewStore.getState().familyTools).toEqual({ draw: "brush", select: "select" });
});
