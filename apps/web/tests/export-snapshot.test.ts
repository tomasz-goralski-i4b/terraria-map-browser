import { expect, test } from "vitest";
import { collectTransferList, readWorldTiles, writeWorld } from "@studio/world-codec";
import { snapshotForExport } from "../src/world/export-snapshot.js";
import { writerSource } from "./support/export-source.js";

test("an export snapshot preserves source subviews and writes without detaching the live world", async () => {
  const source = writerSource();
  const padded = new Uint8Array(source.length + 23);
  padded.set(source, 11);
  const world = readWorldTiles(padded.subarray(11, 11 + source.length));
  const before = structuredClone(world);
  const snapshot = await snapshotForExport(world, new AbortController().signal);
  const transferred = structuredClone(snapshot, { transfer: collectTransferList(snapshot) });
  expect(new Uint8Array(writeWorld(transferred))).toEqual(source);
  expect(world).toEqual(before);
  expect(world.envelope.source.byteOffset).toBe(11);
  expect(transferred.envelope.source.byteOffset).toBe(11);
});

test("cancelling during snapshot preparation preserves the caller's current CWM", async () => {
  const world = readWorldTiles(writerSource());
  const before = structuredClone(world);
  const controller = new AbortController();
  const preparing = snapshotForExport(world, controller.signal);
  controller.abort();
  await expect(preparing).rejects.toMatchObject({ name: "AbortError" });
  expect(world).toEqual(before);
});
