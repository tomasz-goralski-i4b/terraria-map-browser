import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";

// Include the standalone Node script's integration checks in the repository's normal Vitest/verify gate.
test("the loopback source server passes its HTTP, listing and path-boundary checks", async () => {
  await promisify(execFile)(process.execPath, ["--test", resolve(import.meta.dirname, "../../../scripts/dev/serve-local.test.mjs")]);
});
