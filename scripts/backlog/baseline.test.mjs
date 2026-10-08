import assert from "node:assert/strict";
import { test } from "node:test";
import { missedByBaseline } from "./baseline.mjs";

const state = (...baselines) => ({
  version: 1,
  states: Object.fromEntries(baselines.map((at, i) => [`a${i}`, { baselineAt: at, lastSuccessAt: at }])),
});

test("a label added while the cockpit was down predates every baseline, so it was missed", () => {
  const readyAt = new Date("2026-10-07T23:03:24Z");
  const missed = missedByBaseline(readyAt, state("2026-10-08T06:15:32.690Z", "2026-10-08T06:15:37.217Z"));
  assert.deepEqual(missed, new Date("2026-10-08T06:15:32.690Z"));
});

test("a label added after the automations re-baselined was seen", () => {
  const readyAt = new Date("2026-10-08T06:20:00Z");
  assert.equal(missedByBaseline(readyAt, state("2026-10-08T06:15:32.690Z", "2026-10-08T06:15:37.217Z")), null);
});

test("a label added between two automations' baselines may have been seen by the earlier one", () => {
  const readyAt = new Date("2026-10-08T06:15:35Z");
  assert.equal(missedByBaseline(readyAt, state("2026-10-08T06:15:32.690Z", "2026-10-08T06:15:37.217Z")), null);
});

test("without a readable state or label time nothing is reported as missed", () => {
  assert.equal(missedByBaseline(null, state("2026-10-08T06:15:32.690Z")), null);
  assert.equal(missedByBaseline(new Date("2026-10-07T23:03:24Z"), null), null);
  assert.equal(missedByBaseline(new Date("2026-10-07T23:03:24Z"), { states: {} }), null);
  assert.equal(missedByBaseline(new Date("2026-10-07T23:03:24Z"), { states: { a: {} } }), null);
});
