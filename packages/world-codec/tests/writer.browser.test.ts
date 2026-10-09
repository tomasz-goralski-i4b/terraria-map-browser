import { afterEach, describe, expect, it } from "vitest";
import { readWorldTiles, WorldWorkerClient, WorldWorkerError } from "../src/index.js";
import { writerWorld } from "./writer-support.js";

const clients: WorldWorkerClient[] = [];
function client(probe = false): { client: WorldWorkerClient; worker: Worker } {
  const worker = new Worker(probe ? new URL("./fixtures/save-probe.worker.ts", import.meta.url)
    : new URL("../src/world-worker.ts", import.meta.url), { type: "module" });
  let first = true;
  const created = WorldWorkerClient.create(() => {
    if (first) { first = false; return worker; }
    return new Worker(new URL("../src/world-worker.ts", import.meta.url), { type: "module" });
  });
  clients.push(created);
  return { client: created, worker };
}
afterEach(() => { clients.splice(0).forEach((created) => { created.dispose(); }); });

describe("Worker save", () => {
  it("transfers a new output, detaches it in the Worker and keeps caller buffers unchanged", async () => {
    const world = { ...writerWorld(), palette: [{ kind: "vanilla", id: 1 }] as const };
    world.planes.block[2] = 0;
    const before = structuredClone(world);
    const { client: created, worker } = client(true);
    const report = new Promise<{ detached: boolean; transfers: number }>((resolve) => {
      worker.addEventListener("message", (event: MessageEvent<{ type: string; detached: boolean; transfers: number }>) => {
        if (event.data.type === "save-probe") resolve(event.data);
      });
    });
    const output = await created.save(world);
    expect(output).toBeInstanceOf(ArrayBuffer);
    expect(output).not.toBe(world.envelope.source.buffer);
    expect(await report).toEqual({ type: "save-probe", detached: true, transfers: 1 });
    expect(world).toEqual(before);
    expect(readWorldTiles(new Uint8Array(output)).planes.block).toEqual(world.planes.block);
    const again = await created.save(world);
    expect(new Uint8Array(again)).toEqual(new Uint8Array(output));
  });

  it("reports unsupported writes and still accepts a later save and parse", async () => {
    const { client: created } = client();
    const world = writerWorld();
    Object.assign(world.metadata, { name: "Crimson Observatory" });
    const error: unknown = await created.save(world).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(WorldWorkerError);
    expect(error).toMatchObject({ code: "UnsupportedWrite" });
    const output = await created.save(writerWorld());
    expect((await created.parse(output)).metadata.name).toBe("SCCR1");
  });

  it("rejects an aborted or disposed save with Cancelled", async () => {
    const { client: created } = client();
    const controller = new AbortController();
    controller.abort();
    await expect(created.save(writerWorld(), { signal: controller.signal })).rejects.toMatchObject({ code: "Cancelled" });
    created.dispose();
    await expect(created.save(writerWorld())).rejects.toMatchObject({ code: "Cancelled" });
  });

  it("cancels an in-flight save, preserves caller data and saves through a replacement Worker", async () => {
    const { client: created } = client();
    const world = writerWorld();
    const before = structuredClone(world);
    const controller = new AbortController();
    const pending = created.save(world, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "Cancelled" });
    expect(world).toEqual(before);
    expect(new Uint8Array(await created.save(world))).toEqual(world.envelope.source);
  });
});
