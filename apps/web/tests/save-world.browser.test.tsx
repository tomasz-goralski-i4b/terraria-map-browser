// @module-tag perf -- UI flows and long-task bounds run locally (docs/tooling.md).
import { afterEach, expect, test, vi } from "vitest";
import { commands, page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { readWorldTiles, writeWorld } from "@studio/world-codec";
import { App } from "../src/App.js";
import { useAppStore } from "../src/store.js";
import { chooseSaveFolder, closeSaveAs, confirmSave, openSaveAs, useSaveStore } from "../src/world/save-world.js";
import { getDefaultWorldSession } from "../src/world/world-session.js";
import { writerSource } from "./support/export-source.js";
import { hoverSubmenu, menu } from "./support/shell.js";
import "./support/commands.js";
import "../src/styles.css";

afterEach(() => {
  closeSaveAs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function notifications(): ReturnType<typeof page.getByRole> {
  return page.getByRole("region", { name: "Notifications" });
}

const FORMATS = [269, 270, 271, 272, 273, 274, 275, 276, 277, 278, 279, 315, 316, 317, 318, 319, 325, 326];

interface Entry {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  isSameEntry(other: unknown): Promise<boolean>;
  createWritable: ReturnType<typeof vi.fn>;
}

/** A folder double: records what is written, refuses unknown names unless created, answers permission requests. */
function folderDouble(options: { readonly name?: string; readonly files?: readonly Entry[]; readonly write?: PermissionState } = {}) {
  const writes: ArrayBuffer[] = [];
  const close = vi.fn().mockResolvedValue(undefined);
  const abort = vi.fn().mockResolvedValue(undefined);
  const createWritable = vi.fn().mockResolvedValue({
    write: (bytes: ArrayBuffer) => {
      writes.push(bytes);
      return Promise.resolve();
    },
    close, abort,
  });
  const created = { isSameEntry: () => Promise.resolve(false), createWritable, getFile: () => Promise.resolve(new File([], "created.wld")) };
  const removeEntry = vi.fn().mockResolvedValue(undefined);
  const files = new Map((options.files ?? []).map((entry) => [entry.name, entry]));
  const getFileHandle = vi.fn((name: string, { create }: { create: boolean }) => {
    const existing = files.get(name);
    if (existing !== undefined) return Promise.resolve(existing);
    return create ? Promise.resolve(created) : Promise.reject(new DOMException("No such file", "NotFoundError"));
  });
  const granted = { read: "granted", readwrite: options.write ?? "granted" } as const;
  const queryPermission = vi.fn(({ mode }: { mode: "read" | "readwrite" }) => Promise.resolve<PermissionState>(mode === "read" ? "granted" : "prompt"));
  const requestPermission = vi.fn(({ mode }: { mode: "read" | "readwrite" }) => Promise.resolve<PermissionState>(granted[mode]));
  const folder = {
    kind: "directory", name: options.name ?? "Worlds", getFileHandle, queryPermission, requestPermission, removeEntry,
    values: async function* () {
      yield await Promise.resolve({ kind: "directory", name: "Backups" });
      for (const entry of files.values()) yield entry;
    },
  };
  return { folder, writes, close, abort, createWritable, getFileHandle, requestPermission, removeEntry };
}

function fileEntry(name: string, bytes: Uint8Array<ArrayBuffer>, modified = Date.now()): Entry {
  const entry: Entry = {
    kind: "file", name, getFile: () => Promise.resolve(new File([bytes], name, { lastModified: modified })),
    isSameEntry: (other) => Promise.resolve(other === entry), createWritable: vi.fn(),
  };
  return entry;
}

/** Opens a world through File ▸ Open World… (the system picker is a double) and waits for its World panel. */
async function openWorld(bytes: Uint8Array<ArrayBuffer>, name = "SCCO1.wld"): Promise<Entry> {
  const handle = fileEntry(name, bytes);
  vi.stubGlobal("showOpenFilePicker", vi.fn().mockResolvedValue([handle]));
  await menu("File", "Open World…");
  await expect.element(page.getByRole("region", { name: "World", exact: true })).toMatchTextContent("SCCR1");
  return handle;
}

function unsafeSavePicker(): ReturnType<typeof vi.fn> {
  const picker = vi.fn().mockRejectedValue(new Error("The truncating save picker must never run"));
  vi.stubGlobal("showSaveFilePicker", picker);
  return picker;
}

/** Save As into a folder chosen in the dialog, through the dialog's own functions. */
async function saveInto(folder: ReturnType<typeof folderDouble>): Promise<void> {
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(folder.folder));
  await openSaveAs();
  await chooseSaveFolder();
  await confirmSave();
}

test.each(FORMATS)("Save As writes format %i through the writer and keeps every world field", async (version) => {
  await render(<App />);
  // Four separate empty records per column: valid source encoding which the writer combines.
  const bytes = writerSource(2, 4, [0, 0, 0, 0, 0, 0, 0, 0], version);
  await openWorld(bytes);
  const unsafe = unsafeSavePicker();
  const saved = folderDouble();
  await saveInto(saved);
  expect(saved.writes).toHaveLength(1);
  const output = new Uint8Array(saved.writes[0] ?? new ArrayBuffer(0));
  expect(output).toEqual(new Uint8Array(writeWorld(readWorldTiles(bytes))));
  expect(readWorldTiles(output).planes).toEqual(readWorldTiles(bytes).planes);
  expect(readWorldTiles(output).header.version).toBe(version);
  expect(saved.close).toHaveBeenCalledOnce();
  expect(saved.getFileHandle).toHaveBeenCalledWith("SCCO1.wld", { create: false });
  expect(saved.getFileHandle).toHaveBeenCalledWith("SCCO1.wld", { create: true });
  expect(saved.requestPermission).toHaveBeenCalledWith({ mode: "readwrite" });
  expect(unsafe).not.toHaveBeenCalled();
  await expect.element(notifications().getByText("Saved SCCO1.wld")).toBeVisible();
});

test.each(FORMATS)("Save As writes the current CWM edits in format %i without detaching the loaded world", async (version) => {
  await render(<App />);
  await openWorld(writerSource(2, 4, undefined, version));
  const world = getDefaultWorldSession().getLoadedWorld();
  if (world === null) throw new Error("No loaded world");
  Object.assign(world, { palette: [{ kind: "vanilla", id: 1 }, { kind: "vanilla", id: 2 }] });
  world.planes.block[5] = 0;
  world.planes.wall[5] = 1;
  world.planes.shape[5] = 3;
  world.planes.paint[5] = 29;
  world.planes.wallPaint[5] = 12;
  world.planes.liquid[5] = 4;
  world.planes.liquidAmount[5] = 80;
  world.planes.flags[5] = 0x3ff;
  const before = structuredClone(world);
  const saved = folderDouble();
  await saveInto(saved);
  const restored = readWorldTiles(new Uint8Array(saved.writes[0] ?? new ArrayBuffer(0)));
  expect(restored.header).toEqual(world.header);
  expect(restored.metadata).toEqual(world.metadata);
  expect(restored.details).toEqual(world.details);
  expect(Object.values(restored.entities).map((section) => section.data)).toEqual(Object.values(world.entities).map((section) => section.data));
  expect(restored.envelope.opaqueSections.map(({ name, bytes }) => ({ name, bytes }))).toEqual(world.envelope.opaqueSections.map(({ name, bytes }) => ({ name, bytes })));
  expect(restored.planes).toEqual(world.planes);
  expect(restored.palette).toEqual(world.palette);
  expect(world).toEqual(before);
});

test("File ▸ Save As… names the file, shows the folder and what saving guarantees, and Save writes there", async () => {
  await render(<App />);
  await openWorld(writerSource());
  const saved = folderDouble({ name: "Backups" });
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(saved.folder));
  await menu("File", "Save As…");
  const dialog = page.getByRole("dialog", { name: "Save World As" });
  const name = dialog.getByRole("textbox", { name: "File name" });
  await expect.element(name).toHaveValue("SCCO1.wld");
  // The name is focused with only its base selected, so typing keeps the extension.
  await expect.element(name).toHaveFocus();
  const field = name.element() as HTMLInputElement;
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, "SCCO1".length]);
  await expect.element(dialog).toMatchTextContent("No folder chosen");
  await expect.element(dialog).toMatchTextContent("format 326, kept as it was opened");
  await expect.element(dialog).toMatchTextContent("The world you opened is never overwritten");
  await expect.element(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Choose Folder…" }).click();
  await expect.element(dialog.getByTestId("save-folder")).toHaveTextContent("Backups");
  await dialog.getByRole("textbox", { name: "File name" }).fill("My backup");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => saved.writes.length).toBe(1);
  expect(saved.getFileHandle).toHaveBeenCalledWith("My backup.wld", { create: true });
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(notifications().getByText("Saved My backup.wld")).toBeVisible();
  await expect.element(notifications()).toMatchTextContent("verified by reading it back");
});

test("with unsaved changes a reload asks first; saving clears them", async () => {
  await render(<App />);
  await openWorld(writerSource());
  const reload = (): boolean => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  };
  expect(reload()).toBe(false);
  useAppStore.getState().setUnsavedChanges(true);
  await expect.element(page.getByRole("img", { name: "Unsaved changes" })).toBeVisible();
  await expect.poll(reload).toBe(true);
  await saveInto(folderDouble());
  await expect.element(page.getByRole("img", { name: "Unsaved changes" })).not.toBeInTheDocument();
  await expect.poll(reload).toBe(false);
});

test("Ctrl+Shift+S opens Save As; Ctrl+S is kept from the browser while there is nothing to save", async () => {
  await render(<App />);
  await openWorld(writerSource());
  const save = new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true, cancelable: true });
  window.dispatchEvent(save);
  expect(save.defaultPrevented).toBe(true);
  expect(useSaveStore.getState().open).toBe(false);
  await userEvent.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
  await expect.element(page.getByRole("dialog", { name: "Save World As" })).toBeVisible();
});

test("the native Terraria world filter admits .wld without a generic binary MIME type", async () => {
  await render(<App />);
  const picker = vi.fn().mockRejectedValue(new DOMException("Picker closed", "AbortError"));
  vi.stubGlobal("showOpenFilePicker", picker);
  await menu("File", "Open World…");
  expect(picker).toHaveBeenCalledWith({ id: "terraria-worlds", startIn: "documents", multiple: false, excludeAcceptAllOption: true,
    types: [{ description: "Terraria world (.wld)", accept: { "application/x-terraria-world": [".wld"] } }],
  });
});

test("a writer rejection shows its reason in the dialog and never creates a writable file", async () => {
  await render(<App />);
  // Block 700 fits the source bitset, but exceeds format 279's vanilla range.
  await openWorld(writerSource(2, 4, [0x62, 0xbc, 0x02, 3, 0x40, 3], 279));
  const saved = folderDouble();
  await saveInto(saved);
  expect(saved.createWritable).not.toHaveBeenCalled();
  const dialog = page.getByRole("dialog", { name: "Save World As" });
  await expect.element(dialog.getByRole("alert")).toMatchTextContent("UnsupportedWrite");
});

test("without folder access Download hands over the same verified bytes", async () => {
  await render(<App />);
  const bytes = writerSource();
  await openWorld(bytes);
  vi.stubGlobal("showDirectoryPicker", undefined);
  const blobs: Blob[] = [];
  const createObjectURL = URL.createObjectURL.bind(URL);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob: Blob | MediaSource) => {
    if (blob instanceof Blob) blobs.push(blob);
    return createObjectURL(blob);
  });
  const clicks = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  await menu("File", "Save As…");
  const dialog = page.getByRole("dialog", { name: "Save World As" });
  await expect.element(dialog).toMatchTextContent("This browser cannot save into folders");
  await expect.element(dialog.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
  await dialog.getByRole("button", { name: "Download" }).click();
  await expect.poll(() => clicks.mock.calls.length).toBe(1);
  expect(new Uint8Array(await (blobs[0] ?? new Blob()).arrayBuffer())).toEqual(bytes);
  await expect.element(notifications().getByText("Downloaded SCCO1.wld")).toBeVisible();
});

test("an existing file is replaced only after Replace is confirmed", async () => {
  await render(<App />);
  await openWorld(writerSource());
  const other = fileEntry("SCCO1.wld", new Uint8Array(4));
  const saved = folderDouble({ files: [other] });
  other.createWritable = saved.createWritable;
  await saveInto(saved);
  expect(saved.createWritable).not.toHaveBeenCalled();
  const dialog = page.getByRole("dialog", { name: "Save World As" });
  await expect.element(dialog.getByRole("alert")).toMatchTextContent("“SCCO1.wld” already exists in “Worlds”. Replace it?");
  await dialog.getByRole("button", { name: "Replace" }).click();
  await expect.poll(() => saved.writes.length).toBe(1);
});

test("the opened world's own file is refused before a writable stream is created", async () => {
  const bytes = writerSource();
  const source = fileEntry("SCCO1.wld", bytes);
  const saved = folderDouble({ files: [source] });
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(saved.folder));
  await render(<App />);
  vi.stubGlobal("showOpenFilePicker", vi.fn().mockResolvedValue([source]));
  await menu("File", "Open World…");
  await expect.element(page.getByRole("region", { name: "World", exact: true })).toMatchTextContent("SCCR1");
  await openSaveAs();
  await chooseSaveFolder();
  useSaveStore.setState({ fileName: "SCCO1.wld" });
  await confirmSave();
  expect(source.createWritable).not.toHaveBeenCalled();
  expect(saved.createWritable).not.toHaveBeenCalled();
  await expect.element(page.getByRole("dialog", { name: "Save World As" }).getByRole("alert")).toMatchTextContent("is the world you opened");
});

test("a world dropped without a file handle never replaces an existing file", async () => {
  await render(<App />);
  await getDefaultWorldSession().open(new File([writerSource()], "SCCO1.wld"));
  await expect.element(page.getByRole("region", { name: "World", exact: true })).toMatchTextContent("SCCR1");
  const existing = fileEntry("SCCO1.wld", new Uint8Array(4));
  const saved = folderDouble({ files: [existing] });
  await saveInto(saved);
  expect(existing.createWritable).not.toHaveBeenCalled();
  expect(saved.createWritable).not.toHaveBeenCalled();
  await expect.element(page.getByRole("dialog", { name: "Save World As" }).getByRole("alert")).toMatchTextContent("may be the world you opened");
});

test("a source alias appearing between lookup and creation is refused without truncation", async () => {
  await render(<App />);
  await openWorld(writerSource());
  const saved = folderDouble();
  // Absent before encoding and after it; the alias appears just before creation.
  saved.getFileHandle.mockRejectedValueOnce(new DOMException("No such file", "NotFoundError"))
    .mockRejectedValueOnce(new DOMException("No such file", "NotFoundError"))
    .mockResolvedValueOnce({ isSameEntry: () => Promise.resolve(true), createWritable: saved.createWritable, getFile: () => Promise.resolve(new File([], "SCCO1.wld")) });
  await saveInto(saved);
  expect(saved.createWritable).not.toHaveBeenCalled();
  // The world's own file was returned by the creation: it is never removed.
  expect(saved.removeEntry).not.toHaveBeenCalled();
  await expect.element(page.getByRole("dialog", { name: "Save World As" }).getByRole("alert")).toMatchTextContent("is the world you opened");
});

test("a file that appears while encoding is replaced only after Replace is confirmed", async () => {
  await render(<App />);
  await openWorld(writerSource());
  const saved = folderDouble();
  const other = { ...fileEntry("SCCO1.wld", new Uint8Array(4)), createWritable: saved.createWritable };
  saved.getFileHandle.mockRejectedValueOnce(new DOMException("No such file", "NotFoundError")).mockResolvedValueOnce(other);
  await saveInto(saved);
  expect(saved.createWritable).not.toHaveBeenCalled();
  const dialog = page.getByRole("dialog", { name: "Save World As" });
  await expect.element(dialog.getByRole("alert")).toMatchTextContent("already exists in “Worlds”. Replace it?");
  saved.getFileHandle.mockResolvedValue(other);
  await dialog.getByRole("button", { name: "Replace" }).click();
  await expect.poll(() => saved.writes.length).toBe(1);
});

test("refused write permission saves nothing and says so", async () => {
  await render(<App />);
  await openWorld(writerSource());
  const saved = folderDouble({ write: "denied" });
  await saveInto(saved);
  expect(saved.getFileHandle).not.toHaveBeenCalled();
  expect(saved.createWritable).not.toHaveBeenCalled();
  await expect.element(page.getByRole("dialog", { name: "Save World As" }).getByRole("alert")).toMatchTextContent("Saving needs permission to change files in “Worlds”");
});

test("a write failure is shown, the partial file is discarded and a later save succeeds", async () => {
  await render(<App />);
  await openWorld(writerSource());
  const failing = folderDouble();
  const abort = vi.fn().mockResolvedValue(undefined);
  const close = vi.fn();
  failing.createWritable.mockResolvedValue({ write: () => Promise.reject(new Error("Disk is full")), close, abort });
  await saveInto(failing);
  const dialog = page.getByRole("dialog", { name: "Save World As" });
  await expect.element(dialog.getByRole("alert")).toMatchTextContent("Disk is full");
  expect(abort).toHaveBeenCalledOnce();
  expect(close).not.toHaveBeenCalled();
  // The empty file the failed save created is removed: no empty "world" is left in the folder.
  expect(failing.removeEntry).toHaveBeenCalledExactlyOnceWith("SCCO1.wld");
  const saved = folderDouble();
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(saved.folder));
  await chooseSaveFolder();
  await confirmSave();
  expect(saved.close).toHaveBeenCalledOnce();
  await expect.element(dialog).not.toBeInTheDocument();
});

test("a save Worker crash reports an error without creating a writable file", async () => {
  await render(<App />);
  await openWorld(writerSource());
  const saved = folderDouble();
  const terminate = vi.fn();
  class CrashingWorker {
    onerror: ((event: { message: string; preventDefault(): void }) => void) | null = null;
    terminate = terminate;
    postMessage(): void {
      queueMicrotask(() => {
        this.onerror?.({ message: "Save Worker stopped unexpectedly", preventDefault: () => undefined });
      });
    }
  }
  vi.stubGlobal("Worker", CrashingWorker);
  await saveInto(saved);
  await expect.element(page.getByRole("dialog", { name: "Save World As" }).getByRole("alert")).toMatchTextContent("Save Worker stopped unexpectedly");
  expect(terminate).toHaveBeenCalledOnce();
  expect(saved.createWritable).not.toHaveBeenCalled();
  expect(useSaveStore.getState().stage).toBe("idle");
});

test("closing Save As while encoding, or opening another world, writes nothing", async () => {
  await render(<App />);
  await openWorld(writerSource());
  const saved = folderDouble();
  class SilentWorker {
    onmessage = null;
    onerror = null;
    terminate = vi.fn();
    postMessage(): void {
      // Never answers: the save is still encoding when the dialog closes.
    }
  }
  vi.stubGlobal("Worker", SilentWorker);
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(saved.folder));
  await openSaveAs();
  await chooseSaveFolder();
  const saving = confirmSave();
  await expect.poll(() => useSaveStore.getState().stage).toBe("encoding");
  await page.getByRole("dialog", { name: "Save World As" }).getByRole("button", { name: "Cancel" }).click();
  await saving;
  expect(saved.getFileHandle).not.toHaveBeenCalledWith("SCCO1.wld", { create: true });
  expect(saved.createWritable).not.toHaveBeenCalled();

  await openSaveAs();
  await chooseSaveFolder();
  const again = confirmSave();
  await expect.poll(() => useSaveStore.getState().stage).toBe("encoding");
  await getDefaultWorldSession().open(new File([writerSource()], "CrimsonObservatory.wld"));
  await again;
  expect(useSaveStore.getState().open).toBe(false);
  expect(saved.createWritable).not.toHaveBeenCalled();
});

test("Open Folder… reads the folder only; its worlds are listed and Save As offers it, asking for write access on Save", async () => {
  const bytes = writerSource();
  const older = fileEntry("SCCO1.wld", bytes, Date.now() - 3 * 86_400_000);
  const newer = fileEntry("Crimson.wld", bytes, Date.now() - 60_000);
  const notes = { ...fileEntry("Worlds.txt", new Uint8Array(1)) };
  const saved = folderDouble({ name: "Terraria Worlds", files: [older, notes, newer] });
  const picker = vi.fn().mockResolvedValue(saved.folder);
  vi.stubGlobal("showDirectoryPicker", picker);
  await render(<App />);
  await page.getByRole("region", { name: "Start" }).getByRole("button", { name: "Open Worlds Folder…" }).click();
  expect(picker).toHaveBeenCalledWith({ id: "terraria-worlds", startIn: "documents", mode: "read" });
  const listed = page.getByRole("list", { name: "Worlds in Terraria Worlds" });
  await expect.poll(() => [...listed.element().querySelectorAll(".start-world-name")].map((name) => name.textContent)).toEqual(["Crimson", "SCCO1"]);
  await expect.element(notifications().getByText("2 worlds in “Terraria Worlds”")).toBeVisible();

  await menu("File");
  await hoverSubmenu("Worlds");
  const worlds = page.getByRole("menu", { name: "Worlds" });
  await expect.element(worlds.getByRole("menuitem", { name: "Worlds.txt" })).not.toBeInTheDocument();
  await worlds.getByRole("menuitem", { name: "SCCO1", exact: true }).click();
  await expect.element(page.getByRole("region", { name: "World", exact: true })).toMatchTextContent("SCCR1");
  expect(saved.requestPermission).not.toHaveBeenCalled();

  await menu("File", "Save As…");
  const dialog = page.getByRole("dialog", { name: "Save World As" });
  await expect.element(dialog.getByTestId("save-folder")).toHaveTextContent("Terraria Worlds");
  await expect.element(dialog.getByRole("textbox", { name: "File name" })).toHaveValue("SCCO1 (2).wld");
  await dialog.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => saved.writes.length).toBe(1);
  expect(saved.requestPermission).toHaveBeenCalledExactlyOnceWith({ mode: "readwrite" });
  expect(picker).toHaveBeenCalledOnce();
  expect(saved.getFileHandle).toHaveBeenCalledWith("SCCO1 (2).wld", { create: true });
});

test("File ▸ Worlds says what it needs before a folder is open", async () => {
  await render(<App />);
  await menu("File");
  const worlds = page.getByRole("menu").getByRole("menuitem", { name: "Worlds", exact: true });
  await expect.element(worlds).toHaveAttribute("aria-disabled", "true");
  await expect.element(worlds).toHaveAttribute("aria-description", "Open a folder first");
});

test("a later folder-world choice wins when an earlier file read completes first", async () => {
  let resolveEarlier: ((file: File) => void) | undefined;
  let resolveLater: ((file: File) => void) | undefined;
  const earlier = { ...fileEntry("SCCO1.wld", writerSource()), getFile: vi.fn(() => new Promise<File>((resolve) => { resolveEarlier = resolve; })) };
  const later = { ...fileEntry("Crimson.wld", writerSource()), getFile: vi.fn(() => new Promise<File>((resolve) => { resolveLater = resolve; })) };
  const folder = folderDouble({ files: [earlier, later] });
  // The listing reads sizes and dates; only the opening reads are held back.
  earlier.getFile.mockResolvedValueOnce(new File([], "SCCO1.wld"));
  later.getFile.mockResolvedValueOnce(new File([], "Crimson.wld"));
  vi.stubGlobal("showDirectoryPicker", vi.fn().mockResolvedValue(folder.folder));
  await render(<App />);
  await menu("File", "Open Folder…");
  const list = page.getByRole("list", { name: "Worlds in Worlds" });
  await list.getByRole("button", { name: /SCCO1/ }).click();
  await list.getByRole("button", { name: /Crimson/ }).click();
  resolveEarlier?.(new File([writerSource()], "SCCO1.wld"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(useAppStore.getState().phase).toBe("idle");
  resolveLater?.(new File([writerSource()], "Crimson.wld"));
  await expect.poll(() => getDefaultWorldSession().getOpenedFile()?.file.name).toBe("Crimson.wld");
});

test("File ▸ Open Recent reopens a world by its name; Close World returns to the start screen", async () => {
  await render(<App />);
  const handle = await openWorld(writerSource());
  await menu("File", "Close World");
  await expect.element(page.getByRole("region", { name: "Start" })).toBeVisible();
  await expect.element(page.getByRole("list", { name: "Recent worlds" })).toMatchTextContent("SCCR1");
  const reads = vi.spyOn(handle, "getFile");
  await menu("File");
  await hoverSubmenu("Open Recent");
  await page.getByRole("menu", { name: "Open Recent" }).getByRole("menuitem", { name: "SCCR1" }).click();
  await expect.element(page.getByRole("region", { name: "World", exact: true })).toMatchTextContent("SCCR1");
  expect(reads).toHaveBeenCalledOnce();
});

test("saving a generated Small world causes no main-thread task over 100 ms", async () => {
  const binary = atob(await commands.readWorldFixture("SCCO1.wld"));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  await render(<App />);
  await openWorld(bytes);
  // Let the initial renderer upload finish before measuring the save.
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const saved = folderDouble();
  const tasks: PerformanceEntry[] = [];
  const observer = new PerformanceObserver((list) => {
    tasks.push(...list.getEntries());
  });
  observer.observe({ type: "longtask" });
  const start = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await saveInto(saved);
  const end = performance.now();
  await new Promise((resolve) => setTimeout(resolve, 0));
  tasks.push(...observer.takeRecords());
  observer.disconnect();
  expect(Math.max(0, ...tasks.filter((entry) => entry.startTime >= start && entry.startTime < end).map((entry) => entry.duration))).toBeLessThanOrEqual(100);
  expect(new Uint8Array(saved.writes[0] ?? new ArrayBuffer(0))).toEqual(bytes);
});
