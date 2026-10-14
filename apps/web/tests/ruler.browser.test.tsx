// @module-tag perf -- rendered editor flows use software GL on shared runners.
import { beforeEach, expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { App } from "../src/App.js";
import { useAppStore } from "../src/store.js";
import { getMapController } from "../src/shell/view-store.js";
import { useRulerStore } from "../src/world/ruler-session.js";
import "../src/styles.css";
import "./support/commands.js";

beforeEach(async () => {
  await page.viewport(1280, 800);
  for (const key of Object.keys(localStorage)) if (key.startsWith("terraria-map-studio.measurements.v1.")) localStorage.removeItem(key);
});

async function openMap(): Promise<HTMLCanvasElement> {
  await render(<App layoutStorage={null} />);
  const binary = atob(await commands.readWorldFixture("SCCO1.wld"));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("World input is missing");
  await userEvent.upload(input, new File([bytes], "SCCO1.wld"));
  await vi.waitFor(() => { expect(getMapController()).not.toBeNull(); });
  await page.getByRole("toolbar", { name: "Tools" }).getByRole("button", { name: "Ruler", exact: true }).click();
  await vi.waitFor(() => { expect(document.querySelector('canvas[aria-label="World map"]')?.getAttribute("data-camera")).not.toBeNull(); });
  getMapController()?.jumpTo({ x: 1750, y: 300, zoom: 16 });
  getMapController()?.renderNow();
  const canvas = document.querySelector<HTMLCanvasElement>('canvas[aria-label="World map"]');
  if (canvas === null) throw new Error("World map is missing");
  return canvas;
}
function pointer(canvas: HTMLCanvasElement, type: string, x: number, y: number, shift = false): void {
  const rect = canvas.getBoundingClientRect();
  const density = canvas.width / canvas.clientWidth;
  canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 7, pointerType: "mouse", isPrimary: true,
    button: 0, buttons: type === "pointerup" ? 0 : 1, clientX: rect.left + x / density, clientY: rect.top + y / density, shiftKey: shift }));
}

test("drag measures boundary distances, Shift creates a rectangle, list selection centers the camera", async () => {
  const canvas = await openMap();
  expect(canvas.style.cursor).toBe("crosshair");
  pointer(canvas, "pointerdown", 64, 64); pointer(canvas, "pointermove", 224, 64);
  expect(canvas.style.cursor).toBe("crosshair");
  pointer(canvas, "pointerup", 224, 64);
  await expect.element(page.getByRole("button", { name: "Line 1 10 blocks", exact: true })).toBeVisible();
  pointer(canvas, "pointerdown", 320, 128); pointer(canvas, "pointermove", 480, 224, true); pointer(canvas, "pointerup", 480, 224, true);
  expect(useRulerStore.getState().items).toHaveLength(2);
  expect(useRulerStore.getState().items[1]).toMatchObject({ kind: "rectangle", start: { x: 1770, y: 308 }, end: { x: 1780, y: 314 } });
  expect(useAppStore.getState().unsavedChanges).toBe(false);
  const controller = getMapController();
  if (controller === null) throw new Error("Map controller is missing");
  const center = vi.spyOn(controller, "centerOn");
  await page.getByRole("button", { name: "Line 1 10 blocks", exact: true }).click();
  expect(center).toHaveBeenCalledWith(1759, 304);
  expect(useRulerStore.getState().selected).toBe(1);
});

test("CAD notes support handles, replacement, visibility, labels and measurement undo", async () => {
  const canvas = await openMap();
  pointer(canvas, "pointerdown", 64, 64); pointer(canvas, "pointermove", 224, 160); pointer(canvas, "pointerup", 224, 160);
  await vi.waitFor(() => { expect(document.querySelector(".measurement-label")?.textContent).toContain("30.96°"); });
  pointer(canvas, "pointerdown", 224, 160); pointer(canvas, "pointermove", 256, 160); pointer(canvas, "pointerup", 256, 160);
  expect(useRulerStore.getState().items[0]?.end.x).toBe(1766);
  await page.getByRole("button", { name: "Show Line 1", exact: true }).click();
  expect(useRulerStore.getState().items[0]?.visible).toBe(false);
  await page.getByRole("button", { name: "Show Line 1", exact: true }).click();
  await page.getByRole("button", { name: "Keep", exact: true }).click();
  pointer(canvas, "pointerdown", 320, 240); pointer(canvas, "pointermove", 480, 240); pointer(canvas, "pointerup", 480, 240);
  expect(useRulerStore.getState().items).toHaveLength(1);
  expect(useRulerStore.getState().items[0]?.id).toBe(2);
  await userEvent.keyboard("{Control>}z{/Control}");
  expect(useRulerStore.getState().items[0]?.id).toBe(1);
  await expect.element(page.getByRole("combobox", { name: "Measurement units" })).not.toBeInTheDocument();
  await page.screenshot({ path: ".tdd/ruler-dark.png" });
});

test("the presented terrain stays visible through live measurement, commit and hover frames", async () => {
  const canvas = await openMap();
  const sample = async (): Promise<number[]> => {
    const image = new Image();
    image.src = `data:image/png;base64,${await commands.captureMapScreenshot()}`;
    await image.decode();
    const surface = new OffscreenCanvas(image.width, image.height), context = surface.getContext("2d");
    if (context === null) throw new Error("Screenshot has no pixel context");
    context.drawImage(image, 0, 0);
    return [...context.getImageData(image.width - 30, image.height - 30, 1, 1).data];
  };
  const baseline = await sample();
  pointer(canvas, "pointerdown", 64, 64);
  for (const x of [160, 192, 224]) {
    pointer(canvas, "pointermove", x, 160);
    expect(await sample()).toEqual(baseline);
  }
  pointer(canvas, "pointerup", 224, 160);
  for (const x of [320, 352, 384]) {
    const rect = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 7, pointerType: "mouse", isPrimary: true, buttons: 0,
      clientX: rect.left + x, clientY: rect.top + 240 }));
    expect(await sample()).toEqual(baseline);
  }
});
