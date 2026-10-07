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

async function worldFile(name: string): Promise<File> {
  return new File([await fixtureBytes(name)], name);
}

test("opening SCCO1.wld through the file input shows its name and dimensions", async () => {
  await render(<App />);
  chooseFile(await worldFile("SCCO1.wld"));
  const summary = page.getByRole("region", { name: "World summary" });
  await expect.element(summary).toMatchTextContent("SCCR1");
  await expect.element(summary).toMatchTextContent("4200 × 1200");
  await expect.element(summary).toMatchTextContent("948580918");
  await expect.element(summary).toMatchTextContent("326");
  await expect.element(summary).toMatchTextContent("classic");
  await expect.element(summary).toMatchTextContent("corruption");
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
  await expect.element(page.getByRole("region", { name: "World summary" })).toMatchTextContent("4200 × 1200");
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});

test("opening a non-.wld file shows the codec's error and keeps the previously loaded world", async () => {
  const garbage = new TextEncoder().encode("this is definitely not a Terraria world file, just text".repeat(20));
  const expected = codecError(garbage);
  await render(<App />);
  chooseFile(await worldFile("SCCO1.wld"));
  await expect.element(page.getByRole("region", { name: "World summary" })).toMatchTextContent("SCCR1");

  chooseFile(new File([garbage], "notes.txt"));
  await expect.element(page.getByRole("alert")).toMatchTextContent(expected.kind);
  await expect.element(page.getByRole("alert")).toMatchTextContent(`offset ${String(expected.offset)}`);
  await expect.element(page.getByRole("region", { name: "World summary" })).toMatchTextContent("SCCR1");
});

test("the main thread keeps ticking while a Small fixture is parsed", async () => {
  await render(<App />);
  const file = await worldFile("SCCO1.wld");
  let last = performance.now();
  let maxGap = 0;
  let ticks = 0;
  const timer = window.setInterval(() => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    ticks++;
  }, 10);
  try {
    last = performance.now();
    chooseFile(file);
    await expect.element(page.getByRole("region", { name: "World summary" })).toMatchTextContent("4200 × 1200");
  } finally {
    window.clearInterval(timer);
  }
  expect(ticks).toBeGreaterThan(3);
  expect(maxGap).toBeLessThan(250);
});

test("cancel during loading returns to the previous state", async () => {
  await render(<App />);
  chooseFile(await worldFile("SCCO1.wld"));
  await expect.element(page.getByRole("region", { name: "World summary" })).toMatchTextContent("SCCR1");

  chooseFile(await worldFile("SCCR2.wld"));
  const cancel = page.getByRole("button", { name: "Cancel" });
  await expect.element(cancel).toBeVisible();
  await cancel.click();
  await expect.element(page.getByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
  await expect.element(page.getByRole("region", { name: "World summary" })).toMatchTextContent("SCCR1");
  await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
});

test("dropping a file onto the map area behaves like the file input", async () => {
  await render(<App />);
  dropFile(await worldFile("SCCO1.wld"));
  const summary = page.getByRole("region", { name: "World summary" });
  await expect.element(summary).toMatchTextContent("SCCR1");
  await expect.element(summary).toMatchTextContent("4200 × 1200");

  dropFile(new File([new TextEncoder().encode("nope".repeat(100))], "x.txt"));
  await expect.element(page.getByRole("alert")).toBeVisible();
  await expect.element(summary).toMatchTextContent("SCCR1");
});
