import { expect, test } from "vitest";

test("a browser module Worker imports the built codec and signals readiness", async () => {
  const worker = new Worker(new URL("./fixtures/codec-smoke.worker.ts", import.meta.url), {
    type: "module",
  });
  let timeout: number | undefined;

  try {
    const ready = await new Promise<unknown>((resolve, reject) => {
      timeout = window.setTimeout(() => { reject(new Error("Worker did not signal readiness within 5 seconds")); }, 5_000);
      worker.addEventListener("message", (event: MessageEvent<unknown>) => {
        resolve(event.data);
      }, { once: true });
      worker.addEventListener("error", (event) => {
        reject(new Error(event.message));
      }, { once: true });
      worker.addEventListener("messageerror", () => {
        reject(new Error("Worker readiness could not be deserialized"));
      }, { once: true });
    });
    expect(ready).toEqual({ status: "ready" });
  } finally {
    window.clearTimeout(timeout);
    worker.terminate();
  }
}, 10_000);
