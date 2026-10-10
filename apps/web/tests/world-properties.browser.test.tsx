import { afterEach, expect, test } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WorldPanel } from "../src/panels/WorldPanel.js";
import { getDefaultWorldSession, resetDefaultWorldSession } from "../src/world/world-session.js";
import { useAppStore } from "../src/store.js";
import { openSaveAs, useSaveStore } from "../src/world/save-world.js";
import "./support/commands.js";
import "../src/styles.css";

afterEach(() => { resetDefaultWorldSession(); });

async function openWorld(): Promise<void> {
  const binary = atob(await commands.readWorldFixture("SCCO1.wld"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  await getDefaultWorldSession().open(new File([bytes], "SCCO1.wld"));
}

test("world properties use checkboxes, finite selects, date controls and editable list rows", async () => {
  await openWorld();
  await render(<WorldPanel />);
  const drunk = page.getByRole("checkbox", { name: "Drunk world", exact: true });
  await drunk.click();
  expect(getDefaultWorldSession().getLoadedWorld()?.details.generation.specialSeeds.drunk).toBe(true);
  expect(useAppStore.getState().unsavedChanges).toBe(true);
  await expect.element(page.getByRole("checkbox", { name: "Raining", exact: true })).toBeVisible();
  const moon = page.getByRole("combobox", { name: "Moon type", exact: true });
  await moon.selectOptions("3");
  expect(getDefaultWorldSession().getLoadedWorld()?.details.generation.moonType).toBe(3);
  expect(document.querySelector('input[aria-label="Created"]')?.getAttribute("type")).toBe("datetime-local");
  expect(document.querySelector('input[aria-label="Last played"]')?.getAttribute("type")).toBe("datetime-local");
  await page.getByRole("button", { name: "Add Partying NPCs", exact: true }).click();
  await expect.element(page.getByRole("combobox", { name: "Partying NPCs 1", exact: true })).toBeVisible();
});

test("invalid integer stays visible, does not alter the world, and prevents saving", async () => {
  await openWorld();
  await render(<WorldPanel />);
  const id = page.getByRole("spinbutton", { name: "World ID", exact: true });
  const original = getDefaultWorldSession().getLoadedWorld()?.metadata.worldId;
  await id.fill("1.5");
  await userEvent.keyboard("{Enter}");
  await expect.element(page.getByRole("alert")).toBeVisible();
  expect(getDefaultWorldSession().getLoadedWorld()?.metadata.worldId).toBe(original);
  await openSaveAs();
  expect(useSaveStore.getState().open).toBe(false);
});
