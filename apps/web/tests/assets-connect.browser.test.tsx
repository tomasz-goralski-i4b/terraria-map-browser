// @module-tag perf -- UI flows starve on shared CI runners; skipped in CI (docs/tooling.md).
import { afterEach, beforeEach, expect, test } from "vitest";
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { buildTexturePayload, patternRgba, wrapUncompressed } from "@studio/assets/testing";
import { App } from "../src/App.js";
import {
  createAssetSession,
  createWorkerAtlasBuilder,
  setDefaultAssetSession,
  useAssetStore,
  type ContentFolder,
  type RememberedContent,
} from "../src/assets/asset-session.js";
import { hydrateLayout } from "../src/shell/layout-store.js";
import "../src/styles.css";

const created: string[] = [];

beforeEach(async () => {
  hydrateLayout(null);
  await page.viewport(1280, 800);
});

afterEach(async () => {
  setDefaultAssetSession(undefined);
  useAssetStore.setState({ status: { kind: "none" }, notice: null });
  const root = await navigator.storage.getDirectory();
  for (const name of created.splice(0)) await root.removeEntry(name, { recursive: true }).catch(() => undefined);
});

/** An uncompressed XNB texture from the assets package's test builders, so the test needs no game files. */
function syntheticXnb(width: number, height: number): Uint8Array {
  return wrapUncompressed(buildTexturePayload(width, height, patternRgba(width, height)));
}

/** A `Content/Images` folder in OPFS with tile sheets, one wall sheet and one file that is not a texture. */
async function syntheticContent(tiles: number): Promise<FileSystemDirectoryHandle> {
  const root = await navigator.storage.getDirectory();
  const name = `assets-connect-${String(Date.now())}-${String(Math.random()).slice(2)}`;
  created.push(name);
  const content = await root.getDirectoryHandle(name, { create: true });
  const images = await content.getDirectoryHandle("Images", { create: true });
  const write = async (file: string, bytes: Uint8Array): Promise<void> => {
    const writable = await (await images.getFileHandle(file, { create: true })).createWritable();
    await writable.write(bytes.slice());
    await writable.close();
  };
  for (let id = 0; id < tiles; id++) await write(`Tiles_${String(id)}.xnb`, syntheticXnb(36, 36));
  await write("Wall_1.xnb", syntheticXnb(68, 68));
  await write("Tiles_999.xnb", new Uint8Array([1, 2, 3]));
  return content;
}

const nothingRemembered: RememberedContent = { load: () => Promise.resolve(null), save: () => Promise.resolve(), forget: () => Promise.resolve() };

function useSession(content: FileSystemDirectoryHandle): void {
  const cacheName = `${content.name}-cache`;
  created.push(cacheName);
  setDefaultAssetSession(createAssetSession({
    builder: createWorkerAtlasBuilder(() => new Worker(new URL("../src/assets/atlas.worker.ts", import.meta.url), { type: "module" }), cacheName),
    remembered: nothingRemembered,
    pickDirectory: () => Promise.resolve(content as ContentFolder),
    openFolderInput: () => undefined,
  }));
}

test("connecting a Content folder builds the atlas in the Worker and reports it, with the unreadable sheet, on the Sprites row", async () => {
  useSession(await syntheticContent(3));
  await render(<App />);
  await expect.element(page.getByRole("button", { name: "Show Sprites" })).toBeDisabled();
  await expect.element(page.getByText("Not connected")).toBeVisible();

  await page.getByRole("button", { name: "Connect Terraria assets" }).click();
  await expect.element(page.getByRole("button", { name: "Terraria assets connected" })).toHaveAttribute("aria-disabled", "true");
  await expect.element(page.getByRole("button", { name: "Show Sprites" })).toBeEnabled();
  await expect.element(page.getByRole("img", { name: "1 sheets could not be read" })).toBeVisible();
  const status = useAssetStore.getState().status;
  expect(status).toMatchObject({ kind: "ready", tileSheets: 3, wallSheets: 1, pages: 1 });
  expect(status.kind === "ready" ? status.missing.map((sheet) => sheet.name) : []).toEqual(["Tiles_999.xnb"]);
}, 30_000);

test("the atlas build shows its progress on the Sprites row and can be cancelled from its menu while the map stays usable", async () => {
  // A build that runs until it is cancelled (the Worker's own cancel is covered by the assets package's tests).
  setDefaultAssetSession(createAssetSession({
    builder: {
      build: (_source, { onProgress, signal }) => new Promise((_resolve, reject) => {
        onProgress({ phase: "decode", done: 40, total: 100 });
        signal.addEventListener("abort", () => { reject(new DOMException("cancelled", "AbortError")); });
      }),
      loadCached: () => Promise.resolve(null),
      clearCache: () => Promise.resolve(),
    },
    remembered: nothingRemembered,
    pickDirectory: () => Promise.resolve({ name: "Content" } as ContentFolder),
    openFolderInput: () => undefined,
  }));
  await render(<App />);
  await page.getByRole("button", { name: "Connect Terraria assets" }).click();
  await expect.element(page.getByRole("progressbar", { name: "Building the sprite atlas" })).toBeVisible();
  await expect.element(page.getByRole("button", { name: "Open .wld world" })).toBeEnabled();

  await page.getByRole("button", { name: "Terraria assets", exact: true }).click();
  await page.getByRole("menuitem", { name: "Cancel building" }).click();
  await expect.element(page.getByText("Not connected")).toBeVisible();
  expect(useAssetStore.getState().status).toEqual({ kind: "none" });
}, 30_000);
