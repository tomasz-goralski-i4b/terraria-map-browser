import { server } from "vitest/browser";
import { afterEach, describe, expect, it } from "vitest";
import { readWorldTiles, WorldWorkerClient, WorldWorkerError } from "@studio/world-codec";
import { buildMetadata, METADATA_START, wrapMetadata } from "../src/metadata-fixture.js";

async function loadWorld(name: string): Promise<Uint8Array<ArrayBuffer>> {
  const base64 = await server.commands.readFile(`../test-fixtures/worlds/${name}`, "base64");
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

/** Index of the first differing element, or -1 (toEqual on whole planes is far too slow). */
function firstMismatch(got: ArrayLike<number | bigint>, want: ArrayLike<number | bigint>): number {
  for (let i = 0; i < want.length; i++) {
    if (got[i] !== want[i]) return i;
  }
  return -1;
}

const clients: WorldWorkerClient[] = [];
function newWorker(): Worker {
  return new Worker(new URL("../src/world-worker.ts", import.meta.url), { type: "module" });
}
function newClient(): WorldWorkerClient {
  const client = WorldWorkerClient.create(newWorker);
  clients.push(client);
  return client;
}

/** Compile-time guard: a client must own a Worker factory so that abort can stop a running decode. */
type HasPublicConstructor = typeof WorldWorkerClient extends abstract new (...args: never[]) => unknown ? true : false;
export const constructorIsPrivate: HasPublicConstructor = false;
afterEach(() => {
  for (const client of clients.splice(0)) client.dispose();
});

describe("world Worker", () => {
  it.each([279, 315, 325])("parse_File_ResolvesVanillaFormat%iInsideTheWorker", async (version) => {
    const layout = version === 279 ? "1.4.4" : version === 315 ? "1.4.5" : "1.4.5-lightning";
    const metadata = buildMetadata({ layout, width: 2, height: 4 });
    const tiles = Uint8Array.from([0x42, 2, 3, 0x48, 255, 3]);
    const bytes = wrapMetadata(metadata.bytes, tiles.length, version);
    bytes.set(tiles, METADATA_START + metadata.bytes.length);
    const world = await newClient().parse(new File([bytes], "SCCR1.wld"));
    expect(world.header.version).toBe(version);
    expect(world.metadata).toMatchObject({ name: "SCCR1", width: 2, height: 4 });
    expect(world.palette).toEqual([{ kind: "vanilla", id: 2 }]);
    expect(Array.from(world.planes.liquid)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
  });

  it("parse_TransferredArrayBuffer_ReturnsPlanesPaletteAndMetadata_AndDetachesSender", async () => {
    const bytes = await loadWorld("SCCO1.wld");
    const buffer = bytes.buffer.slice(0);
    const result = await newClient().parse(buffer);
    expect(buffer.byteLength).toBe(0);
    const { width, height } = result.metadata;
    expect(result.planes.block).toBeInstanceOf(Uint16Array);
    expect(result.planes.block.length).toBe(width * height);
    expect(result.planes.block.buffer.byteLength).toBe(width * height * 2);
    expect(result.palette.length).toBeGreaterThan(0);
    expect(result.planes.block.some((value) => value !== 0xffff)).toBe(true);
  });

  it("parse_File_ParsesInsideTheWorker", async () => {
    const bytes = await loadWorld("SCCO1.wld");
    const result = await newClient().parse(new File([bytes], "SCCO1.wld"));
    expect(result.planes.flags.length).toBe(result.metadata.width * result.metadata.height);
  });

  it("parse_MalformedFile_RejectsWithCodeOffsetAndRequestId", async () => {
    const bytes = await loadWorld("SCCO1.wld");
    const error = await newClient().parse(bytes.slice(0, 10).buffer).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorldWorkerError);
    const failure = error as WorldWorkerError;
    expect(failure.code).toBe("Truncated");
    expect(typeof failure.offset).toBe("number");
    expect(failure.requestId).toBeGreaterThan(0);
  });

  it("parse_AfterFailedRequest_StillParsesValidFile", async () => {
    const client = newClient();
    const bytes = await loadWorld("SCCO1.wld");
    await expect(client.parse(bytes.slice(0, 10).buffer)).rejects.toBeInstanceOf(WorldWorkerError);
    const result = await client.parse(bytes.buffer.slice(0));
    expect(result.palette.length).toBeGreaterThan(0);
  });

  it("parse_AbortedSignal_RejectsWithCancelled", async () => {
    const controller = new AbortController();
    const bytes = await loadWorld("SCCO1.wld");
    const pending = newClient().parse(bytes.buffer.slice(0), { signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorldWorkerError);
    expect((error as WorldWorkerError).code).toBe("Cancelled");
  });

  it("dispose_WithPendingRequest_RejectsItAsCancelled_AndLaterParseFails", async () => {
    const client = newClient();
    const bytes = await loadWorld("SCCO1.wld");
    const pending = client.parse(bytes.buffer.slice(0));
    client.dispose();
    expect(((await pending.catch((e: unknown) => e)) as WorldWorkerError).code).toBe("Cancelled");
    await expect(client.parse(bytes.buffer.slice(0))).rejects.toBeInstanceOf(Error);
  });

  it("parse_SmallWorld_KeepsMainThreadHeartbeatRunning", async () => {
    const bytes = await loadWorld("SCCO1.wld");
    let ticks = 0;
    let longest = 0;
    let last = performance.now();
    const timer = window.setInterval(() => {
      const now = performance.now();
      longest = Math.max(longest, now - last);
      last = now;
      ticks++;
    }, 10);
    try {
      await newClient().parse(bytes.buffer.slice(0));
    } finally {
      window.clearInterval(timer);
    }
    expect(ticks).toBeGreaterThan(0);
    expect(longest).toBeLessThan(500);
  });

  it("parse_SyntheticWorld_ReceivesAllPlanesMetadataAndPaletteEqualToDirectDecode", async () => {
    const bytes = await loadWorld("SCCO1.wld");
    const expected = readWorldTiles(bytes.slice());
    const actual = await newClient().parse(bytes.buffer.slice(0));
    const { planes: expectedPlanes, palette: expectedPalette, ...expectedRest } = expected;
    const { planes: actualPlanes, palette: actualPalette, ...actualRest } = actual;
    expect(actualRest).toEqual(expectedRest);
    expect(actualPalette).toEqual(expectedPalette);
    const names = Object.keys(expectedPlanes) as (keyof typeof expectedPlanes)[];
    expect(names).toHaveLength(10);
    expect(Object.keys(actualPlanes).sort()).toEqual([...names].sort());
    for (const name of names) {
      const want = expectedPlanes[name];
      const got = actualPlanes[name];
      expect(got.constructor).toBe(want.constructor);
      expect(got.length).toBe(want.length);
      expect(firstMismatch(got, want), `plane ${name} first mismatch`).toBe(-1);
    }
  });

  it("parse_Result_DetachesEveryUniqueWorkerSideOutputBufferAfterPosting", async () => {
    const worker = new Worker(new URL("./fixtures/transfer-probe.worker.ts", import.meta.url), { type: "module" });
    const client = WorldWorkerClient.create(() => worker);
    clients.push(client);
    const probe = new Promise<{ uniqueBuffers: number; detached: boolean[] }>((resolve) => {
      worker.addEventListener("message", (event: MessageEvent<{ type?: string; uniqueBuffers: number; detached: boolean[] }>) => {
        if (event.data.type === "probe") resolve(event.data);
      });
    });
    const bytes = await loadWorld("SCCO1.wld");
    const expected = readWorldTiles(bytes.slice());
    const result = await client.parse(bytes.buffer.slice(0));
    const report = await Promise.race([
      probe,
      new Promise<never>((_, reject) => window.setTimeout(() => { reject(new Error("no probe report")); }, 5_000)),
    ]);
    expect(report.uniqueBuffers).toBeGreaterThan(0);
    expect(report.detached.every(Boolean)).toBe(true);
    expect(firstMismatch(result.planes.block, expected.planes.block)).toBe(-1);
  });

  it("parse_DetachedInputBuffer_RejectsWithWorldWorkerError_ReleasesAbortListener_AndLaterParseWorks", async () => {
    const client = newClient();
    const bytes = await loadWorld("SCCO1.wld");
    const detached = bytes.buffer.slice(0);
    structuredClone(detached, { transfer: [detached] });
    expect(detached.byteLength).toBe(0);

    const signal = new AbortController().signal;
    let added = 0;
    let removed = 0;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = ((...args: Parameters<typeof add>) => { added++; add(...args); }) as typeof add;
    signal.removeEventListener = ((...args: Parameters<typeof remove>) => { removed++; remove(...args); }) as typeof remove;

    const error = await client.parse(detached, { signal }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WorldWorkerError);
    expect((error as WorldWorkerError).requestId).toBeGreaterThan(0);
    expect(added).toBeGreaterThan(0);
    expect(removed).toBe(added);

    const result = await client.parse(bytes.buffer.slice(0));
    expect(result.palette.length).toBeGreaterThan(0);
  });

  it("parse_AfterAbortedRequest_SameClientStillParses", async () => {
    const client = newClient();
    const bytes = await loadWorld("SCCO1.wld");
    const controller = new AbortController();
    const aborted = client.parse(bytes.buffer.slice(0), { signal: controller.signal });
    controller.abort();
    expect(((await aborted.catch((e: unknown) => e)) as WorldWorkerError).code).toBe("Cancelled");
    const result = await client.parse(bytes.buffer.slice(0));
    expect(result.palette.length).toBeGreaterThan(0);
  });

  describe("abort of an in-flight parse", () => {
    interface Tracked { readonly client: WorldWorkerClient; readonly created: Worker[]; readonly terminated: Worker[] }
    function trackedClient(): Tracked {
      const created: Worker[] = [];
      const terminated: Worker[] = [];
      const client = WorldWorkerClient.create(() => {
        const worker = new Worker(new URL("../src/world-worker.ts", import.meta.url), { type: "module" });
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => { terminated.push(worker); terminate(); };
        created.push(worker);
        return worker;
      });
      clients.push(client);
      return { client, created, terminated };
    }

    it("abort_WhileParsing_TerminatesTheBusyWorker_RejectsCancelled_AndReplacesIt", async () => {
      const { client, created, terminated } = trackedClient();
      const bytes = await loadWorld("SCCO1.wld");
      const controller = new AbortController();
      const aborted = client.parse(bytes.buffer.slice(0), { signal: controller.signal });
      controller.abort();
      const error = await aborted.catch((e: unknown) => e);
      expect(error).toBeInstanceOf(WorldWorkerError);
      expect((error as WorldWorkerError).code).toBe("Cancelled");
      expect(terminated).toEqual([created[0]]);

      const result = await client.parse(bytes.buffer.slice(0));
      expect(result.palette.length).toBeGreaterThan(0);
      expect(created).toHaveLength(2);
      expect(terminated).toEqual([created[0]]);
    });

    it("abort_WhileParsing_RejectsOtherPendingRequestsAsCancelled_AndLaterParseSucceeds", async () => {
      const { client } = trackedClient();
      const bytes = await loadWorld("SCCO1.wld");
      const controller = new AbortController();
      const aborted = client.parse(bytes.buffer.slice(0), { signal: controller.signal });
      const bystander = client.parse(bytes.buffer.slice(0));
      controller.abort();
      expect(((await aborted.catch((e: unknown) => e)) as WorldWorkerError).code).toBe("Cancelled");
      expect(((await bystander.catch((e: unknown) => e)) as WorldWorkerError).code).toBe("Cancelled");
      const result = await client.parse(bytes.buffer.slice(0));
      expect(result.palette.length).toBeGreaterThan(0);
    });

    it("abort_AfterCompletion_DoesNotTerminateTheWorker", async () => {
      const { client, created, terminated } = trackedClient();
      const bytes = await loadWorld("SCCO1.wld");
      const controller = new AbortController();
      await client.parse(bytes.buffer.slice(0), { signal: controller.signal });
      controller.abort();
      const result = await client.parse(bytes.buffer.slice(0));
      expect(result.palette.length).toBeGreaterThan(0);
      expect(created).toHaveLength(1);
      expect(terminated).toHaveLength(0);
    });

    it("dispose_AfterAbortReplacement_TerminatesTheReplacementWorker", async () => {
      const { client, created, terminated } = trackedClient();
      const bytes = await loadWorld("SCCO1.wld");
      const controller = new AbortController();
      const aborted = client.parse(bytes.buffer.slice(0), { signal: controller.signal });
      controller.abort();
      await aborted.catch(() => undefined);
      await client.parse(bytes.buffer.slice(0));
      client.dispose();
      expect(created).toHaveLength(2);
      expect(terminated).toEqual([created[0], created[1]]);
    });
  });
});
