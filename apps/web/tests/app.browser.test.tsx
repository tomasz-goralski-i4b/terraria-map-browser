// @module-tag perf -- UI flows starve on shared CI runners; skipped in CI (docs/tooling.md).
import { expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../src/App.js";

test("the app shell offers the menu bar, Open World… on the start screen and Connect Terraria assets", async () => {
  await render(<App />);
  const menubar = page.getByRole("menubar", { name: "Main menu" });
  for (const title of ["File", "View", "Assets", "Help"]) {
    await expect.element(menubar.getByRole("menuitem", { name: title, exact: true })).toBeVisible();
  }
  await expect.element(page.getByRole("region", { name: "Start" }).getByRole("button", { name: "Open World…" })).toBeEnabled();
  await expect.element(page.getByRole("button", { name: "Connect Terraria assets" })).not.toHaveAttribute("aria-disabled");
  await expect.element(page.getByRole("main", { name: "Map" })).toBeVisible();
});
