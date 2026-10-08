// @module-tag perf -- UI flows starve on shared CI runners; skipped in CI (docs/tooling.md).
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../src/App.js";

test("the app shell offers Open .wld world and Connect Terraria assets", async () => {
  await render(<App />);
  await expect.element(page.getByRole("button", { name: "Open .wld world" })).toBeEnabled();
  await expect.element(page.getByRole("button", { name: "Connect Terraria assets" })).not.toHaveAttribute("aria-disabled");
  await expect.element(page.getByRole("main", { name: "Map" })).toBeVisible();
});
