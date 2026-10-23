import { expect } from "vitest";
import { page, userEvent } from "vitest/browser";

/**
 * Opens a menu bar menu and walks its submenus: `menu("File", "Worlds", "SCCO1")` opens File, opens the Worlds submenu
 * and activates SCCO1. Every step is a click, as a pointer user would do it.
 */
export async function menu(title: string, ...path: string[]): Promise<void> {
  await page.getByRole("menubar").getByRole("menuitem", { name: title, exact: true }).click();
  for (const name of path) {
    const item = page.getByRole("menu").getByRole("menuitem", { name, exact: true }).last();
    await expect.element(item).toBeVisible();
    await item.click();
  }
}

/** Hovers a submenu item of the open menu and waits until its flyout shows. */
export async function hoverSubmenu(name: string): Promise<void> {
  const item = page.getByRole("menu").getByRole("menuitem", { name, exact: true });
  await item.hover();
  await expect.element(page.getByRole("menu", { name, exact: true })).toBeVisible();
}

/**
 * Shows a panel from the activity bar, as a user would: clicks its icon unless it is already shown in front (a click
 * then would fold it away).
 */
export async function openPanel(name: string): Promise<void> {
  const icon = page.getByRole("navigation", { name: "Panels" }).getByRole("button", { name, exact: true });
  if (icon.element().getAttribute("aria-pressed") !== "true") await icon.click();
  await expect.element(icon).toHaveAttribute("aria-pressed", "true");
}

/** The panels that held the old dock tabs' sections: World, View (now the Layers panel) and Swatches. */
export async function dockTab(name: "World" | "View" | "Swatches"): Promise<void> {
  await openPanel(name === "View" ? "Layers" : name);
}

export async function pressEscape(): Promise<void> {
  await userEvent.keyboard("{Escape}");
}
