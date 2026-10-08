// @module-tag perf -- UI flows starve on shared CI runners; skipped on pull requests (docs/tooling.md).
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../src/App.js";

test("the app shell offers Open .wld world and a disabled Connect Terraria assets", async () => {
  await render(<App />);
  await expect.element(page.getByRole("button", { name: "Open .wld world" })).toBeEnabled();
  await expect.element(page.getByRole("button", { name: "Connect Terraria assets" })).toHaveAttribute("aria-disabled", "true");
  await expect.element(page.getByRole("main", { name: "Map" })).toBeVisible();
});
