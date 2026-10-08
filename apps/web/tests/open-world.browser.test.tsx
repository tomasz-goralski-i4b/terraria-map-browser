// @module-tag perf -- UI flows starve on shared CI runners; skipped in CI (docs/tooling.md).
import { expect, test } from "vitest";
import { commands, page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { WorldFormatError, readWorldTiles } from "@studio/world-codec";
import { App } from "../src/App.js";
import "./support/commands.js";

async function fixtureBytes(file: string): Promise<Uint8Array<ArrayBuffer>> {
  const base64 = await commands.readWorldFixture(file);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** The error the codec itself reports for these bytes, so the UI is compared against the codec, not a literal. */
function codecError(bytes: Uint8Array): WorldFormatError {
  try {
    readWorldTiles(bytes);
  } catch (error) {
    if (error instanceof WorldFormatError) return error;
    throw error;
  }
  throw new Error("expected the codec to reject these bytes");
}

function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file input in the app");
  return input;
}

function chooseFile(file: File): void {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const input = fileInput();
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function dropFile(file: File): void {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  const map = document.querySelector("main");
  if (map === null) throw new Error("no map area");
  map.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  map.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
}

function findCancel(): HTMLButtonElement | undefined {
  return [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Cancel");
}

function clickCancelWhenShown(): Promise<void> {
  return new Promise((resolve) => {
    const observer = new MutationObserver(() => {
      const cancel = findCancel();
      if (cancel === undefined) return;
      observer.disconnect();
      cancel.click();
      resolve();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  });
}

/** The World section of the dock, which shows the loaded world's metadata. */
function worldPanel(): ReturnType<typeof page.getByRole> {
  return page.getByRole("region", { name: "World", exact: true });
}

async function worldFile(name: string): Promise<File> {
  return new File([await fixtureBytes(name)], name);
}

test("opening SCCO1.wld through the file input shows its name and dimensions", async () => {
  await render(<App />);
  chooseFile(await worldFile("SCCO1.wld"));
  const summary = worldPanel();
  await expect.element(summary).toMatchTextContent("SCCR1");
  await expect.element(summary).toMatchTextContent("4200 × 1200");
  await expect.element(summary).toMatchTextContent("948580918");
  await expect.element(summary).toMatchTextContent("326");
  await expect.element(summary).toMatchTextContent("Classic");
  await expect.element(summary).toMatchTextContent("Corruption");
});

test("opening a truncated file shows the codec's code and offset and the app stays usable", async () => {
  const valid = await fixtureBytes("SCCO1.wld");
  const truncated = valid.slice(0, 200);
  const expected = codecError(truncated);
  await render(<App />);
  chooseFile(new File([truncated], "cut.wld"));
  const alert = page.getByRole("alert");
  await expect.element(alert).toMatchTextContent(expected.kind);
  await expect.element(alert).toMatchTextContent(`offset ${String(expected.offset)}`);

  chooseFile(new File([valid], "SCCO1.wld"));
  await expect.element(worldPanel()).toMatchTextContent("4200 × 1200");
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});

test("opening a non-.wld file shows the codec's error and keeps the previously loaded world", async () => {
  const garbage = new TextEncoder().encode("this is definitely not a Terraria world file, just text".repeat(20));
  const expected = codecError(garbage);
  await render(<App />);
  chooseFile(await worldFile("SCCO1.wld"));
  await expect.element(worldPanel()).toMatchTextContent("SCCR1");

  chooseFile(new File([garbage], "notes.txt"));
  await expect.element(page.getByRole("alert")).toMatchTextContent(expected.kind);
  await expect.element(page.getByRole("alert")).toMatchTextContent(`offset ${String(expected.offset)}`);
  await expect.element(worldPanel()).toMatchTextContent("SCCR1");
});

/**
 * Continues in a new task. A long task is reported with the time its whole task started, so work measured from a
 * timestamp must start in a later task than the one that took it.
 */
function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Records main-thread long tasks (50 ms or more, Long Tasks API) from now on. */
function watchLongTasks(): { readonly longest: (from: number, to: number) => Promise<number> } {
  const tasks: PerformanceEntry[] = [];
  const observer = new PerformanceObserver((list) => { tasks.push(...list.getEntries()); });
  observer.observe({ type: "longtask" });
  return {
    /** Duration of the longest task that started in [from, to), or 0 when none was long. */
    longest: async (from, to) => {
      // A task is reported once it has ended.
      await nextTask();
      tasks.push(...observer.takeRecords());
      return Math.max(0, ...tasks.filter((task) => task.startTime >= from && task.startTime < to).map((task) => task.duration));
    },
  };
}

test("the main thread is never blocked while a Small fixture is parsed", async () => {
  // Long tasks are measured rather than the delivery of a timer: on a CI runner shared with SwiftShader pages, timers
  // and frames can be starved for hundreds of milliseconds while this page's main thread is idle.
  expect(PerformanceObserver.supportedEntryTypes).toContain("longtask");
  await render(<App />);
  const bytes = await fixtureBytes("SCCO1.wld");
  const longTasks = watchLongTasks();
  // The window ends when the summary is committed: the map's first frame (shader compile, chunk uploads) follows it
  // on the main thread by design and is not parsing; on a loaded CI runner with software GL it alone can exceed the bound.
  let end = Infinity;
  const observer = new MutationObserver(() => {
    if (document.querySelector(".world-panel") === null) return;
    end = performance.now();
    observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  const start = performance.now();
  await nextTask();
  try {
    chooseFile(new File([bytes], "SCCO1.wld"));
    await expect.element(worldPanel()).toMatchTextContent("4200 × 1200");
  } finally {
    observer.disconnect();
  }
  expect(end).toBeLessThan(Infinity);
  const blocked = await longTasks.longest(start, end);
  expect(blocked).toBeLessThan(250);

  // Parsing the same file on the main thread, on this machine and under the same load, blocks it for more than twice
  // as long as any task of the open did: the parse ran in the Worker. (Parsed on the main thread, the open's longest
  // task is the parse itself, as long as this one or longer.)
  const parseStart = performance.now();
  await nextTask();
  readWorldTiles(bytes);
  const mainThreadParse = await longTasks.longest(parseStart, Infinity);
  expect(mainThreadParse).toBeGreaterThan(0);
  expect(blocked).toBeLessThan(mainThreadParse / 2);
});

test("cancel during loading returns to the previous state", async () => {
  await render(<App />);
  chooseFile(await worldFile("SCCO1.wld"));
  await expect.element(worldPanel()).toMatchTextContent("SCCR1");

  // A Small parse can finish before a driver click lands, so Cancel is clicked in the same task React renders it.
  const cancelled = clickCancelWhenShown();
  chooseFile(await worldFile("SCCR2.wld"));
  await cancelled;
  await expect.element(page.getByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  await expect.element(worldPanel()).toMatchTextContent("SCCR1");
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});

test("dropping a file onto the map area behaves like the file input", async () => {
  await render(<App />);
  dropFile(await worldFile("SCCO1.wld"));
  const summary = worldPanel();
  await expect.element(summary).toMatchTextContent("SCCR1");
  await expect.element(summary).toMatchTextContent("4200 × 1200");

  dropFile(new File([new TextEncoder().encode("nope".repeat(100))], "x.txt"));
  await expect.element(page.getByRole("alert")).toBeVisible();
  await expect.element(summary).toMatchTextContent("SCCR1");
});
