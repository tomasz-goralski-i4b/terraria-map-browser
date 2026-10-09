import { describe, expect, it } from "vitest";
import { WorldWorkerClient, WorldWorkerError, type WorldWorkerRequest, type WorldWorkerResponse } from "../src/index.js";
import { writerWorld } from "./writer-support.js";

/** Answers every request with a response of the other kind, as a misbehaving Worker would. */
class CrossedWorker extends EventTarget {
  readonly answered: WorldWorkerRequest["type"][] = [];

  postMessage(request: WorldWorkerRequest): void {
    this.answered.push(request.type);
    const response: WorldWorkerResponse = request.type === "save"
      ? { type: "parsed", requestId: request.requestId, result: writerWorld() }
      : { type: "saved", requestId: request.requestId, output: new ArrayBuffer(4) };
    queueMicrotask(() => { this.dispatchEvent(new MessageEvent("message", { data: response })); });
  }

  terminate(): void { /* nothing runs in this fake */ }
}

describe("WorldWorkerClient response matching", () => {
  it("rejects a response whose type does not match the request with Internal", async () => {
    const worker = new CrossedWorker();
    const client = WorldWorkerClient.create(() => worker as unknown as Worker);
    for (const request of [() => client.save(writerWorld()), () => client.parse(new ArrayBuffer(8))]) {
      const error: unknown = await request().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(WorldWorkerError);
      expect(error).toMatchObject({ code: "Internal", message: "Unexpected Worker response" });
    }
    expect(worker.answered).toEqual(["save", "parse"]);
    client.dispose();
  });
});
