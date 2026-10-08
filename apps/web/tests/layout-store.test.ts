import { afterEach, beforeEach, expect, test } from "vitest";
import { DEFAULT_LAYOUT, LAYOUT_STORAGE_KEY, type LayoutStorage, hydrateLayout, resetLayout, useLayoutStore } from "../src/shell/layout-store.js";

class MemoryStorage implements LayoutStorage {
  readonly items = new Map<string, string>();
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
  removeItem(key: string): void {
    this.items.delete(key);
  }
}

const throwing: LayoutStorage = {
  getItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
  removeItem: () => {
    throw new DOMException("blocked", "SecurityError");
  },
};

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  hydrateLayout(storage);
});

afterEach(() => {
  hydrateLayout(new MemoryStorage());
});

test("a fresh browser starts with the default layout", () => {
  const state = useLayoutStore.getState();
  expect(state.dockHidden).toBe(DEFAULT_LAYOUT.dockHidden);
  expect(state.dockWidth).toBe(DEFAULT_LAYOUT.dockWidth);
  expect(state.sections).toEqual(DEFAULT_LAYOUT.sections);
});

test("section, dock and column changes survive a reload", () => {
  const actions = useLayoutStore.getState();
  actions.setSectionOpen("world", false);
  actions.setGroupOpen("world/progression", false);
  actions.setDockWidth(400);
  actions.setDockHidden(true);
  actions.setColumn("content", "share", { hidden: true, width: 90 });

  hydrateLayout(storage);
  const state = useLayoutStore.getState();
  expect(state.sections.world).toBe(false);
  expect(state.groups["world/progression"]).toBe(false);
  expect(state.dockWidth).toBe(400);
  expect(state.dockHidden).toBe(true);
  expect(state.columns["content"]?.["share"]).toEqual({ hidden: true, width: 90 });
});

test("several groups open or close at once", () => {
  useLayoutStore.getState().setGroupOpen("world/size", false);
  useLayoutStore.getState().setGroupsOpen(["world/identity", "world/size"], false);
  expect(useLayoutStore.getState().groups).toMatchObject({ "world/identity": false, "world/size": false });
  useLayoutStore.getState().setGroupsOpen(["world/identity", "world/size"], true);
  expect(useLayoutStore.getState().groups).toMatchObject({ "world/identity": true, "world/size": true });
});

test("the dock width stays between its minimum and maximum", () => {
  useLayoutStore.getState().setDockWidth(10);
  expect(useLayoutStore.getState().dockWidth).toBe(DEFAULT_LAYOUT.minDockWidth);
  useLayoutStore.getState().setDockWidth(10_000);
  expect(useLayoutStore.getState().dockWidth).toBe(DEFAULT_LAYOUT.maxDockWidth);
});

test("a throwing storage leaves the defaults and never throws", () => {
  expect(() => {
    hydrateLayout(throwing);
  }).not.toThrow();
  expect(useLayoutStore.getState().dockWidth).toBe(DEFAULT_LAYOUT.dockWidth);
  expect(() => {
    useLayoutStore.getState().setDockHidden(true);
  }).not.toThrow();
  expect(useLayoutStore.getState().dockHidden).toBe(true);
});

test("a corrupt or foreign stored value is ignored field by field", () => {
  storage.setItem(LAYOUT_STORAGE_KEY, "{not json");
  hydrateLayout(storage);
  expect(useLayoutStore.getState().dockWidth).toBe(DEFAULT_LAYOUT.dockWidth);

  storage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify({ dockWidth: "wide", dockHidden: true, sections: { world: "no", layers: false } }));
  hydrateLayout(storage);
  const state = useLayoutStore.getState();
  expect(state.dockWidth).toBe(DEFAULT_LAYOUT.dockWidth);
  expect(state.dockHidden).toBe(true);
  expect(state.sections.world).toBe(DEFAULT_LAYOUT.sections.world);
  expect(state.sections.layers).toBe(false);
});

test("Reset layout restores the defaults and forgets the stored layout", () => {
  useLayoutStore.getState().setDockWidth(500);
  useLayoutStore.getState().setSectionOpen("content", false);
  resetLayout();
  expect(useLayoutStore.getState().dockWidth).toBe(DEFAULT_LAYOUT.dockWidth);
  expect(useLayoutStore.getState().sections.content).toBe(DEFAULT_LAYOUT.sections.content);
  hydrateLayout(storage);
  expect(useLayoutStore.getState().dockWidth).toBe(DEFAULT_LAYOUT.dockWidth);
});
