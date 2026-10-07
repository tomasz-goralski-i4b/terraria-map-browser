import { expect, test } from "vitest";
import { useAppStore } from "../src/store.js";

test("the store holds UI state and updates it", () => {
  expect(useAppStore.getState().status).toBe("Ready");
  useAppStore.getState().setStatus("Loading");
  expect(useAppStore.getState().status).toBe("Loading");
  useAppStore.getState().setStatus("Ready");
});
